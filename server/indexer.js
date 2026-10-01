require("dotenv").config();
const {Pool}=require("pg");
const {JsonRpcProvider,Interface,isAddress,getAddress}=require("ethers");
const {PROTOCOL_ABI}=require("./blockchain");

const CONTRACT=process.env.BNB_CONTRACT_ADDRESS;
const RPC=process.env.BSC_TESTNET_RPC_URL||"https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const CONFIRMATIONS=Number(process.env.INDEXER_CONFIRMATIONS||3);
const MAX_RANGE=Number(process.env.INDEXER_MAX_BLOCK_RANGE||1000);
const INITIAL_LOOKBACK=Number(process.env.INDEXER_INITIAL_LOOKBACK||5000);
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false}});
const rpc=new JsonRpcProvider(RPC());
const iface=new Interface(PROTOCOL_ABI);

function jsonSafe(value){
  if(typeof value==="bigint") return value.toString();
  if(Array.isArray(value)) return value.map(jsonSafe);
  if(value&&typeof value==="object"){const out={};for(const [k,v] of Object.entries(value)){if(!/^\\d+$/.test(k)) out[k]=jsonSafe(v);}return out;}
  return value;
}
function requireConfig(){
  if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if(!CONTRACT||!isAddress(CONTRACT)) throw new Error("BNB_CONTRACT_ADDRESS is not configured with a valid address");
}
async function ensureSchema(){
  await pool.query(`create table if not exists indexer_state(
    chain_id bigint primary key, contract_address varchar(42),
    last_processed_block bigint not null default 0, updated_at timestamptz not null default now()
  );
  create table if not exists chain_events(
    id uuid primary key default gen_random_uuid(), chain_id bigint not null,
    contract_address varchar(42), block_number bigint not null, block_hash varchar(66),
    tx_hash varchar(66) not null, log_index integer not null, event_name varchar(96) not null,
    args jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
    unique(chain_id,tx_hash,log_index)
  );
  create index if not exists idx_chain_events_block on chain_events(chain_id,block_number);
  create table if not exists reconciliation_runs(
    id uuid primary key default gen_random_uuid(), chain_id bigint not null,
    contract_address varchar(42), from_block bigint, to_block bigint,
    started_at timestamptz not null default now(), finished_at timestamptz,
    status varchar(32) not null, details jsonb not null default '{}'::jsonb
  );`);
}
async function loadCursor(chainId,contractAddress,latestSafe){
  const r=await pool.query("select last_processed_block,contract_address from indexer_state where chain_id=$1",[chainId]);
  if(!r.rowCount){
    const configured=process.env.INDEXER_START_BLOCK?Number(process.env.INDEXER_START_BLOCK):Math.max(0,latestSafe-INITIAL_LOOKBACK);
    return configured;
  }
  if(r.rows[0].contract_address&&r.rows[0].contract_address.toLowerCase()!==contractAddress.toLowerCase()){
    throw new Error("indexer_state contract address does not match BNB_CONTRACT_ADDRESS");
  }
  return Number(r.rows[0].last_processed_block);
}
async function saveCursor(chainId,contractAddress,block){
  await pool.query(`insert into indexer_state(chain_id,contract_address,last_processed_block,updated_at)
    values($1,$2,$3,now())
    on conflict(chain_id) do update set contract_address=excluded.contract_address,last_processed_block=excluded.last_processed_block,updated_at=now()`,
    [chainId,contractAddress,block]);
}
async function indexRange(chainId,contractAddress,fromBlock,toBlock){
  const logs=await rpc.getLogs({address:contractAddress,fromBlock,toBlock});
  let inserted=0;
  for(const log of logs){
    let parsed;
    try{parsed=iface.parseLog({topics:log.topics,data:log.data});}catch(_){continue;}
    if(!parsed) continue;
    const args={};
    for(let i=0;i<parsed.fragment.inputs.length;i++){
      const input=parsed.fragment.inputs[i];
      args[input.name||String(i)]=jsonSafe(parsed.args[i]);
    }
    const r=await pool.query(`insert into chain_events(
      chain_id,contract_address,block_number,block_hash,tx_hash,log_index,event_name,args)
      values($1,$2,$3,$4,$5,$6,$7,$8)
      on conflict(chain_id,tx_hash,log_index) do nothing`,
      [chainId,contractAddress,log.blockNumber,log.blockHash,log.transactionHash,log.index,parsed.name,JSON.stringify(args)]);
    inserted+=r.rowCount;
  }
  return {logs:logs.length,inserted};
}
async function run(){
  requireConfig();
  await ensureSchema();
  const net=await rpc.getNetwork();
  const chainId=Number(net.chainId);
  const latest=await rpc.getBlockNumber();
  const safeLatest=Math.max(0,latest-CONFIRMATIONS);
  const contractAddress=getAddress(CONTRACT);
  let cursor=await loadCursor(chainId,contractAddress,safeLatest);
  if(cursor>safeLatest) return {chainId,latestBlock:latest,safeBlock:safeLatest,fromBlock:cursor+1,toBlock:safeLatest,processed:0,message:"nothing to index"};
  const from=cursor+1;
  const to=Math.min(safeLatest,from+MAX_RANGE-1);
  const runResult=await pool.query(`insert into reconciliation_runs(chain_id,contract_address,from_block,to_block,status,details)
    values($1,$2,$3,$4,'running',$5) returning id`,
    [chainId,contractAddress,from,to,JSON.stringify({mode:"event-index",confirmations:CONFIRMATIONS})]);
  const runId=runResult.rows[0].id;
  try{
    const result=await indexRange(chainId,contractAddress,from,to);
    await saveCursor(chainId,contractAddress,to);
    await pool.query("update reconciliation_runs set status='completed',finished_at=now(),details=$2 where id=$1",
      [runId,JSON.stringify({...result,mode:"event-index",fromBlock:from,toBlock:to,latestBlock:latest,safeBlock:safeLatest})]);
    return {chainId,latestBlock:latest,safeBlock:safeLatest,fromBlock:from,toBlock:to,...result};
  }catch(error){
    await pool.query("update reconciliation_runs set status='failed',finished_at=now(),details=$2 where id=$1",
      [runId,JSON.stringify({error:error.message})]).catch(()=>{});
    throw error;
  }
}
run().then(result=>{console.log(JSON.stringify({service:"liholiswano-indexer",...result}));return pool.end();})
  .catch(error=>{console.error(error);pool.end().finally(()=>process.exit(1));});
