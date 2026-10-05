require("dotenv").config();
const {Pool}=require("pg");
const {JsonRpcProvider,Interface,Contract,isAddress,getAddress}=require("ethers");
const {PROTOCOL_ABI}=require("./blockchain");

const CHAIN_ID=Number(process.env.BSC_CHAIN_ID||97);
const CONTRACT=process.env.BNB_CONTRACT_ADDRESS;
const RPC=process.env.BSC_RPC_URL||process.env.BSC_TESTNET_RPC_URL||"https://bsc-testnet-dataseed.bnbchain.org";
const CONFIRMATIONS=Number(process.env.INDEXER_CONFIRMATIONS||3);
const MAX_RANGE=Math.max(10,Number(process.env.RECONCILIATION_MAX_RANGE||100));
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false}});
const rpc=new JsonRpcProvider(RPC),iface=new Interface(PROTOCOL_ABI);

function add(xs,category,entity,expected,actual,severity="critical"){xs.push({severity,category,entity,expected,actual});}
async function safeBlock(){const latest=await rpc.getBlockNumber();const finalized=await rpc.getBlock("finalized").catch(()=>null);return finalized?.number!=null?Math.min(latest,Number(finalized.number)):Math.max(0,latest-CONFIRMATIONS);}
async function ensureSchema(){
 await pool.query(`create table if not exists v1_reconciliation_runs(
 id uuid primary key default gen_random_uuid(), chain_id bigint not null, contract_address varchar(42) not null,
 started_at timestamptz not null default now(), finished_at timestamptz, status varchar(32) not null,
 discrepancy_count integer not null default 0, report jsonb not null default '{}'::jsonb);
 create table if not exists v1_round_snapshots(
 run_id uuid not null, tier_id integer not null, round_id bigint not null, active boolean not null, complete boolean not null,
 token varchar(42), payout numeric, contribution numeric, collateral_required numeric, deadline bigint,
 settled_positions integer, resolved_obligations integer, members jsonb not null, primary key(run_id,tier_id,round_id));
 create table if not exists v1_obligation_snapshots(
 run_id uuid not null,tier_id integer not null,round_id bigint not null,recipient_index integer not null,
 funder_index integer not null,funder varchar(42),amount numeric,due_at bigint,status integer,primary key(run_id,tier_id,round_id,recipient_index,funder_index));
 `);
}
async function run(){
 if(CHAIN_ID!==97)throw new Error("V1 reconciler currently supports BNB Testnet chain 97 only");
 if(!CONTRACT||!isAddress(CONTRACT))throw new Error("BNB_CONTRACT_ADDRESS is missing or invalid");
 if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is not configured");
 await ensureSchema();
 const lock=await pool.query("select pg_try_advisory_lock(hashtext('liholiswano-bnb-v1-reconciliation')) locked");
 if(!lock.rows[0].locked)return {status:"already_running"};
 try{
  const c=new Contract(CONTRACT,PROTOCOL_ABI,rpc),safe=await safeBlock(),latest=await rpc.getBlockNumber(),discrepancies=[];
  const code=await rpc.getCode(CONTRACT);if(!code||code==="0x")throw new Error("V1 protocol contract has no code");
  const rr=await pool.query("insert into v1_reconciliation_runs(chain_id,contract_address,status) values($1,$2,'running') returning id",[CHAIN_ID,getAddress(CONTRACT)]);
  const runId=rr.rows[0].id;
  try{
   for(let tierId=1;tierId<=5;tierId++){
    const rid=Number(await c.latestRoundId(tierId));if(!rid)continue;
    const r=await c.getRound(tierId,rid);
    const members=r[15].map(getAddress);
    const unique=new Set(members.map(x=>x.toLowerCase()));
    if(members.length!==11||unique.size!==11)add(discrepancies,"round_member_count_or_uniqueness",`tier:${tierId}:round:${rid}`,{members:11,unique:11},{members:members.length,unique:unique.size});
    await pool.query("insert into v1_round_snapshots values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",[runId,tierId,rid,r[1],r[2],r[5],r[6].toString(),r[7].toString(),r[8].toString(),Number(r[12]),Number(r[13]),Number(r[14]),JSON.stringify(members)]);
    let resolved=0;
    for(let i=0;i<11;i++){
     const pos=await c.getPosition(tierId,rid,i);let sum=0n,count=0;
     for(let j=0;j<11;j++){
      if(i===j)continue;
      const o=await c.getObligation(tierId,rid,i,j),status=Number(o[3]);
      if(o[0].toLowerCase()!==members[j].toLowerCase())add(discrepancies,"funder_mismatch",`tier:${tierId}:round:${rid}:p:${i}:f:${j}`,{funder:members[j]},{funder:o[0]});
      if(BigInt(o[1])!==BigInt(r[7]))add(discrepancies,"obligation_amount_mismatch",`tier:${tierId}:round:${rid}:p:${i}:f:${j}`,{amount:String(r[7])},{amount:String(o[1])});
      if(Number(o[2])!==Number(r[12]))add(discrepancies,"obligation_deadline_mismatch",`tier:${tierId}:round:${rid}:p:${i}:f:${j}`,{dueAt:Number(r[12])},{dueAt:Number(o[2])});
      if(status===2||status===3){sum+=BigInt(o[1]);count++;resolved++;}
      await pool.query("insert into v1_obligation_snapshots values($1,$2,$3,$4,$5,$6,$7,$8,$9)",[runId,tierId,rid,i,j,o[0],o[1].toString(),Number(o[2]),status]);
     }
     if(BigInt(pos[1])!==sum||Number(pos[2])!==count)add(discrepancies,"position_aggregation_mismatch",`tier:${tierId}:round:${rid}:position:${i}`,{amount:sum.toString(),count},{amount:String(pos[1]),count:Number(pos[2])});
     if(pos[3]&&(count!==10||sum!==BigInt(r[6])))add(discrepancies,"settled_position_not_fully_covered",`tier:${tierId}:round:${rid}:position:${i}`,{count:10,amount:String(r[6])},{count,amount:sum.toString()});
    }
    if(r[2]&&(Number(r[13])!==11||Number(r[14])!==110))add(discrepancies,"invalid_round_completion",`tier:${tierId}:round:${rid}`,{settled:11,resolved:110},{settled:Number(r[13]),resolved:Number(r[14])});
   }
   const status=discrepancies.some(x=>x.severity==="critical")?"failed":discrepancies.length?"warning":"completed";
   await pool.query("update v1_reconciliation_runs set status=$2,finished_at=now(),discrepancy_count=$3,report=$4 where id=$1",[runId,status,discrepancies.length,JSON.stringify({latestBlock:latest,safeBlock:safe,discrepancies})]);
   return {status,runId,latestBlock:latest,safeBlock:safe,discrepancies:discrepancies.length};
  }catch(e){await pool.query("update v1_reconciliation_runs set status='failed',finished_at=now(),report=$2 where id=$1",[runId,JSON.stringify({error:e.message})]).catch(()=>{});throw e;}
 }finally{await pool.query("select pg_advisory_unlock(hashtext('liholiswano-bnb-v1-reconciliation'))").catch(()=>{});}
}
if(require.main===module)run().then(r=>{console.log(JSON.stringify({service:"liholiswano-v1-reconciliation",...r}));return pool.end();}).catch(e=>{console.error(JSON.stringify({service:"liholiswano-v1-reconciliation",status:"failed",error:e.message}));pool.end().finally(()=>process.exit(1));});
module.exports={run};