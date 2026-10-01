require("dotenv").config();
const {Pool}=require("pg");
const {JsonRpcProvider,Interface,isAddress,getAddress}=require("ethers");
const {PROTOCOL_ABI}=require("./blockchain");

const CONTRACT=process.env.BNB_CONTRACT_ADDRESS;
const RPC=process.env.BSC_TESTNET_RPC_URL||"https://data-seed-prebsc-1-s1.bnbchain.org:8545";
const CONFIRMATIONS=Number(process.env.INDEXER_CONFIRMATIONS||3);
const MAX_RANGE=Number(process.env.INDEXER_MAX_BLOCK_RANGE||1000);
const INITIAL_LOOKBACK=Number(process.env.INDEXER_INITIAL_LOOKBACK||5000);
const START_BLOCK=process.env.INDEXER_START_BLOCK==null?null:Number(process.env.INDEXER_START_BLOCK);
if(!Number.isInteger(CONFIRMATIONS)||CONFIRMATIONS<0) throw new Error("INDEXER_CONFIRMATIONS must be a non-negative integer");
if(!Number.isInteger(MAX_RANGE)||MAX_RANGE<1) throw new Error("INDEXER_MAX_BLOCK_RANGE must be a positive integer");
if(START_BLOCK!==null&&(!Number.isSafeInteger(START_BLOCK)||START_BLOCK<0)) throw new Error("INDEXER_START_BLOCK must be a non-negative integer");

const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false}});
const rpc=new JsonRpcProvider(RPC());
const iface=new Interface(PROTOCOL_ABI);

function jsonSafe(value){
  if(typeof value==="bigint") return value.toString();
  if(Array.isArray(value)) return value.map(jsonSafe);
  if(value&&typeof value==="object"){const out={};for(const [k,v] of Object.entries(value)){if(!/^\d+$/.test(k)) out[k]=jsonSafe(v);}return out;}
  return value;
}
function requireConfig(){
  if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  if(!CONTRACT||!isAddress(CONTRACT)) throw new Error("BNB_CONTRACT_ADDRESS is not configured with a valid address");
}
async function ensureSchema(){
  await pool.query(`
    create extension if not exists pgcrypto;
    create table if not exists indexer_state(
      chain_id bigint primary key, contract_address varchar(42),
      last_processed_block bigint not null default 0,
      last_block_hash varchar(66),
      updated_at timestamptz not null default now()
    );
    alter table indexer_state add column if not exists last_block_hash varchar(66);
    create table if not exists chain_events(
      id uuid primary key default gen_random_uuid(), chain_id bigint not null,
      contract_address varchar(42), block_number bigint not null, block_hash varchar(66),
      tx_hash varchar(66) not null, log_index integer not null, event_name varchar(96) not null,
      args jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
      unique(chain_id,tx_hash,log_index)
    );
    create index if not exists idx_chain_events_block on chain_events(chain_id,block_number);
    create index if not exists idx_chain_events_name on chain_events(chain_id,event_name);
    create table if not exists reconciliation_runs(
      id uuid primary key default gen_random_uuid(), chain_id bigint not null,
      contract_address varchar(42), from_block bigint, to_block bigint,
      started_at timestamptz not null default now(), finished_at timestamptz,
      status varchar(32) not null, details jsonb not null default '{}'::jsonb
    );
    alter table reconciliation_runs add column if not exists contract_address varchar(42);
    alter table reconciliation_runs add column if not exists from_block bigint;
    alter table reconciliation_runs add column if not exists to_block bigint;
    alter table reconciliation_runs add column if not exists finished_at timestamptz;
    alter table reconciliation_runs add column if not exists details jsonb not null default '{}'::jsonb;
    alter table reconciliation_runs add column if not exists started_at timestamptz not null default now();
    alter table reconciliation_runs add column if not exists status varchar(32) not null default 'running';
    do $$
    begin
      if exists(select 1 from information_schema.columns where table_name='reconciliation_runs' and column_name='report')
         and not exists(select 1 from information_schema.columns where table_name='reconciliation_runs' and column_name='details') then
        alter table reconciliation_runs add column details jsonb not null default '{}'::jsonb;
      end if;
    end $$;
    `);
  // Older schema used report/completed_at. Keep them if present and backfill the canonical columns.
  const cols=await pool.query(`select column_name from information_schema.columns where table_name='reconciliation_runs' and column_name in ('report','completed_at')`);
  const names=new Set(cols.rows.map(r=>r.column_name));
  if(names.has("report")) await pool.query("update reconciliation_runs set details=coalesce(details,report,'{}'::jsonb) where details is null or details='{}'::jsonb");
  if(names.has("completed_at")) await pool.query("update reconciliation_runs set finished_at=coalesce(finished_at,completed_at) where finished_at is null");
}
async function loadState(chainId,contractAddress,safeLatest){
  const r=await pool.query("select last_processed_block,last_block_hash,contract_address from indexer_state where chain_id=$1",[chainId]);
  if(!r.rowCount){
    const configured=START_BLOCK!==null?START_BLOCK:Math.max(0,safeLatest-INITIAL_LOOKBACK);
    return {block:configured-1,hash:null};
  }
  const row=r.rows[0];
  if(row.contract_address&&row.contract_address.toLowerCase()!==contractAddress.toLowerCase()) throw new Error("indexer_state contract address does not match BNB_CONTRACT_ADDRESS");
  return {block:Number(row.last_processed_block),hash:row.last_block_hash||null};
}
async function saveState(chainId,contractAddress,block,hash){
  await pool.query(`insert into indexer_state(chain_id,contract_address,last_processed_block,last_block_hash,updated_at)
    values($1,$2,$3,$4,now())
    on conflict(chain_id) do update set contract_address=excluded.contract_address,last_processed_block=excluded.last_processed_block,last_block_hash=excluded.last_block_hash,updated_at=now()`,
    [chainId,contractAddress,block,hash]);
}
async function verifyCursor(state){
  if(state.block<0||!state.hash) return;
  const b=await rpc.getBlock(state.block);
  if(!b) throw new Error(`Indexed cursor block ${state.block} is no longer available`);
  if(b.hash&&b.hash.toLowerCase()!==state.hash.toLowerCase()) throw new Error("Indexed cursor block hash changed; manual reindex/reorg recovery is required");
}
async function indexRange(chainId,contractAddress,fromBlock,toBlock){
  if(fromBlock>toBlock) return {logs:0,inserted:0,eventsByName:{}};
  const logs=await rpc.getLogs({address:contractAddress,fromBlock,toBlock});
  let inserted=0; const eventsByName={};
  for(const log of logs){
    let parsed;
    try{parsed=iface.parseLog({topics:log.topics,data:log.data});}catch(_){continue;}
    if(!parsed) continue;
    const args={};
    for(let i=0;i<parsed.fragment.inputs.length;i++){const input=parsed.fragment.inputs[i];args[input.name||String(i)]=jsonSafe(parsed.args[i]);}
    const r=await pool.query(`insert into chain_events(chain_id,contract_address,block_number,block_hash,tx_hash,log_index,event_name,args)
      values($1,$2,$3,$4,$5,$6,$7,$8) on conflict(chain_id,tx_hash,log_index) do nothing`,
      [chainId,contractAddress,log.blockNumber,log.blockHash,log.transactionHash,log.index,parsed.name,JSON.stringify(args)]);
    inserted+=r.rowCount; eventsByName[parsed.name]=(eventsByName[parsed.name]||0)+r.rowCount;
  }
  return {logs:logs.length,inserted,eventsByName};
}
async function run(){
  requireConfig(); await ensureSchema();
  const lock=await pool.query("select pg_try_advisory_lock(hashtext('liholiswano-bnb-indexer')) as locked");
  if(!lock.rows[0].locked) return {status:"already_running"};
  try{
    const net=await rpc.getNetwork(); const chainId=Number(net.chainId); const latest=await rpc.getBlockNumber();
    const safeLatest=Math.max(0,latest-CONFIRMATIONS); const contractAddress=getAddress(CONTRACT);
    const state=await loadState(chainId,contractAddress,safeLatest); await verifyCursor(state);
    if(state.block>=safeLatest) return {chainId,latestBlock:latest,safeBlock:safeLatest,fromBlock:state.block+1,toBlock:safeLatest,processed:0,message:"nothing to index"};
    const from=state.block+1; const to=Math.min(safeLatest,from+MAX_RANGE-1);
    const runResult=await pool.query(`insert into reconciliation_runs(chain_id,contract_address,from_block,to_block,status,details)
      values($1,$2,$3,$4,'running',$5) returning id`,
      [chainId,contractAddress,from,to,JSON.stringify({mode:"event-index",confirmations:CONFIRMATIONS})]);
    const runId=runResult.rows[0].id;
    try{
      const result=await indexRange(chainId,contractAddress,from,to);
      const endBlock=await rpc.getBlock(to); const endHash=endBlock&&endBlock.hash;
      if(!endHash) throw new Error(`Unable to read block hash for indexed block ${to}`);
      await saveState(chainId,contractAddress,to,endHash);
      await pool.query("update reconciliation_runs set status='completed',finished_at=now(),details=$2 where id=$1",
        [runId,JSON.stringify({...result,mode:"event-index",fromBlock:from,toBlock:to,latestBlock:latest,safeBlock:safeLatest})]);
      return {chainId,latestBlock:latest,safeBlock:safeLatest,fromBlock:from,toBlock:to,...result};
    }catch(error){
      await pool.query("update reconciliation_runs set status='failed',finished_at=now(),details=$2 where id=$1",[runId,JSON.stringify({error:error.message})]).catch(()=>{});
      throw error;
    }
  }finally{await pool.query("select pg_advisory_unlock(hashtext('liholiswano-bnb-indexer'))").catch(()=>{});}
}
run().then(result=>{console.log(JSON.stringify({service:"liholiswano-indexer",...result}));return pool.end();})
  .catch(error=>{console.error(JSON.stringify({service:"liholiswano-indexer",status:"failed",error:error.message}));pool.end().finally(()=>process.exit(1));});
