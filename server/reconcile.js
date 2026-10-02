require("dotenv").config();
const {Pool}=require("pg");
const {JsonRpcProvider,Interface,Contract,isAddress,formatUnits}=require("ethers");
const {PROTOCOL_ABI}=require("./blockchain");

const CHAIN_ID=Number(process.env.BNB_CHAIN_ID||97);
const CONTRACT=process.env.BNB_CONTRACT_ADDRESS;
const RPC=process.env.BSC_TESTNET_RPC_URL||"https://bsc-testnet-dataseed.bnbchain.org";
const CONFIRMATIONS=Number(process.env.INDEXER_CONFIRMATIONS||3);
const MAX_RANGE=Math.max(10,Number(process.env.RECONCILIATION_MAX_RANGE||500));
const START=process.env.RECONCILIATION_START_BLOCK==null||process.env.RECONCILIATION_START_BLOCK===""?null:Number(process.env.RECONCILIATION_START_BLOCK);
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false}});
const rpc=new JsonRpcProvider(RPC);
const iface=new Interface(PROTOCOL_ABI);
const ERC20=new Interface([
 "function decimals() view returns (uint8)",
 "function symbol() view returns (string)"
]);

function safe(v){if(typeof v==="bigint")return v.toString();return v;}
function eq(a,b){return String(a??"").toLowerCase()===String(b??"").toLowerCase();}
function add(discrepancies,category,entityType,entityKey,expected,actual,severity="critical"){discrepancies.push({severity,category,entityType,entityKey,expected,actual});}

async function ensureSchema(){
 await pool.query(`
 create table if not exists reconciliation_discrepancies(
  id uuid primary key default gen_random_uuid(), run_id uuid references reconciliation_runs(id) on delete cascade,
  severity varchar(16) not null, category varchar(64) not null, entity_type varchar(64),
  entity_key varchar(255), expected jsonb not null default '{}'::jsonb, actual jsonb not null default '{}'::jsonb,
  resolved_at timestamptz, resolution_note text, created_at timestamptz not null default now());
 create index if not exists idx_recon_discrepancies_open on reconciliation_discrepancies(created_at desc) where resolved_at is null;
 create table if not exists reconciliation_projection(
  id uuid primary key default gen_random_uuid(), chain_id bigint not null, contract_address varchar(42) not null,
  tx_hash varchar(66) not null, log_index integer not null, event_name varchar(96) not null,
  group_id varchar(66), wallet_address varchar(42), user_id uuid references users(id) on delete set null,
  asset_symbol varchar(16), asset_decimals integer, amount numeric(78,0), direction varchar(8),
  ledger_entry_id uuid references ledger_entries(id) on delete set null, block_number bigint not null,
  created_at timestamptz not null default now(), unique(chain_id,tx_hash,log_index,event_name));
 `);
}
async function safeBlock(){
 try{const b=await rpc.getBlock("finalized");if(b?.number!=null)return Number(b.number);}catch{}
 return Math.max(0,(await rpc.getBlockNumber())-CONFIRMATIONS);
}
async function rangeLogs(from,to){
 const logs=[];
 for(let a=from;a<=to;a+=MAX_RANGE){
  const b=Math.min(to,a+MAX_RANGE-1); console.log(JSON.stringify({service:"liholiswano-reconciliation",status:"scanning",fromBlock:a,toBlock:b}));
  let attempt=0;
  while(true){
   try{logs.push(...await rpc.getLogs({address:CONTRACT,fromBlock:a,toBlock:b}));break;}
   catch(e){if(attempt++>=4)throw e;await new Promise(r=>setTimeout(r,Math.min(8000,500*2**attempt)));}
  }
 }
 return logs;
}
async function tokenInfo(address){
 if(!isAddress(address))return {symbol:"UNKNOWN",decimals:18};
 const c=new Contract(address,ERC20,rpc);
 try{return {symbol:String(await c.symbol()),decimals:Number(await c.decimals())};}
 catch{return {symbol:"UNKNOWN",decimals:18};}
}
async function chainGroup(id){
 const c=new Contract(CONTRACT,PROTOCOL_ABI,rpc);
 const g=await c.getGroup(id);
 return {exists:g[0],locked:g[1],admin:g[2],token:g[3],contribution:safe(g[4]),collateral:safe(g[5]),maxMembers:Number(g[6]),maxBidBps:Number(g[7]),round:Number(g[8]),rotation:Number(g[9]),reserve:safe(g[10]),uncoveredShortfall:safe(g[11]),roundDeadline:Number(g[12]),escrowBalance:safe(g[13]),memberCount:Number(g[14])};
}
async function memberState(group,wallet){
 const c=new Contract(CONTRACT,PROTOCOL_ABI,rpc),m=await c.getMember(group,wallet);
 return {account:m[0],active:m[1],defaulted:m[2],wonThisRotation:m[3],contributedThisRound:m[4],bidSubmitted:m[5],bidBps:Number(m[6]),totalWins:Number(m[7]),totalContributed:safe(m[8]),totalReceived:safe(m[9])};
}
async function projectFinancialEvent(ev,runId,tokenCache,discrepancies){
 const args=ev.args||{}, group=args.groupId, member=args.member, key=`${CHAIN_ID}:${ev.tx_hash}:${ev.log_index}:${ev.event_name}`;
 if(!["ContributionPaid","RoundSettled"].includes(ev.event_name))return;
 const wallet=member||args.winner;
 const tokenAddress=(await chainGroup(group)).token;
 let ti=tokenCache.get(tokenAddress.toLowerCase());if(!ti){ti=await tokenInfo(tokenAddress);tokenCache.set(tokenAddress.toLowerCase(),ti);}
 const raw=String(ev.event_name==="ContributionPaid"?args.amount:args.payout);
 const direction=ev.event_name==="ContributionPaid"?"debit":"credit";
 const user=await pool.query("select u.id from users u join wallets w on w.user_id=u.id where w.chain_id=$1 and lower(w.address)=lower($2) and w.verified_at is not null limit 1",[CHAIN_ID,wallet]);
 const userId=user.rowCount?user.rows[0].id:null;
 let ledgerId=null;
 if(userId){
  const amount=Number(ti.decimals)<=18?formatUnits(BigInt(raw),ti.decimals):raw;
  const ref=`chain:${CHAIN_ID}:${ev.tx_hash}:${ev.log_index}`;
  const existing=await pool.query("select id from ledger_entries where reference=$1 limit 1",[ref]);
  if(existing.rowCount) ledgerId=existing.rows[0].id;
  else {
   const ins=await pool.query("insert into ledger_entries(user_id,group_id,entry_type,asset_symbol,chain_id,amount,direction,status,reference,metadata) select $1,g.id,$2,$3,$4,$5,$6,'confirmed',$7,$8 from groups g where g.chain_id=$4 and g.onchain_group_id=$9 returning id",
    [userId,ev.event_name==="ContributionPaid"?"rosca.contribution":"rosca.payout",ti.symbol,CHAIN_ID,amount,direction,ref,JSON.stringify({txHash:ev.tx_hash,logIndex:ev.log_index,rawAmount:raw,groupId:group}),group]);
   if(ins.rowCount)ledgerId=ins.rows[0].id;
  }
 }
 await pool.query(`insert into reconciliation_projection(chain_id,contract_address,tx_hash,log_index,event_name,group_id,wallet_address,user_id,asset_symbol,asset_decimals,amount,direction,ledger_entry_id,block_number)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
 on conflict(chain_id,tx_hash,log_index,event_name) do update set user_id=excluded.user_id,ledger_entry_id=excluded.ledger_entry_id`,
 [CHAIN_ID,CONTRACT,ev.tx_hash,ev.log_index,ev.event_name,group,wallet||null,userId,ti.symbol,ti.decimals,raw,direction,ledgerId,ev.block_number]);
 return {userId,ledgerId};
}
async function run(){
 if(CHAIN_ID!==97)throw new Error("Stage 3 reconciler currently supports BNB Testnet chain 97 only");
 if(!CONTRACT||!isAddress(CONTRACT))throw new Error("BNB_CONTRACT_ADDRESS is missing or invalid");
 if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is not configured");
 await ensureSchema();
 const lock=await pool.query("select pg_try_advisory_lock(hashtext('liholiswano-bnb-reconciliation')) locked");
 if(!lock.rows[0].locked)return {status:"already_running"};
 try{
  const latest=await rpc.getBlockNumber(), safe=await safeBlock(); console.log(JSON.stringify({service:"liholiswano-reconciliation",status:"started",latestBlock:latest,safeBlock:safe,startBlock:START}));
  const code=await rpc.getCode(CONTRACT);if(!code||code==="0x")throw new Error("Protocol contract has no code");
  const state=await pool.query("select last_processed_block,last_block_hash,contract_address from indexer_state where chain_id=$1",[CHAIN_ID]);
  const cursor=state.rowCount?Number(state.rows[0].last_processed_block):-1;
  if(state.rowCount&&state.rows[0].contract_address&&!eq(state.rows[0].contract_address,CONTRACT))throw new Error("Indexer contract address mismatch");
  if(state.rowCount&&state.rows[0].last_block_hash){
   const b=await rpc.getBlock(cursor);if(!b||!eq(b.hash,state.rows[0].last_block_hash))throw new Error("Indexer cursor hash changed; stop and perform explicit reorg recovery");
  }
  const from=START!==null?START:(cursor>=0?Math.max(0,cursor-20):Math.max(0,safe-10000));
  const run=await pool.query("insert into reconciliation_runs(chain_id,contract_address,from_block,to_block,status,details) values($1,$2,$3,$4,'running',$5) returning id",
   [CHAIN_ID,CONTRACT,from,safe,JSON.stringify({mode:"financial-reconciliation",latestBlock:latest,safeBlock:safe})]);
  const runId=run.rows[0].id, discrepancies=[];
  try{
   const ids=new Contract(CONTRACT,PROTOCOL_ABI,rpc), groupIds=await ids.getGroupIds();
   const dbGroups=await pool.query("select * from groups where chain_id=$1",[CHAIN_ID]);
   const byOnchain=new Map(dbGroups.rows.map(g=>[String(g.onchain_group_id).toLowerCase(),g]));
   for(const rawId of groupIds){
    const id=String(rawId), cg=await chainGroup(rawId), db=byOnchain.get(id.toLowerCase());
    if(!db){add(discrepancies,"missing_group","group",id,{onchainGroupId:id},{database:false},"warning");continue;}
    const expected={locked:cg.locked,token:cg.token,contribution:cg.contribution,collateral:cg.collateral,maxMembers:cg.maxMembers,maxBidBps:cg.maxBidBps,round:cg.round,rotation:cg.rotation,reserve:cg.reserve,uncoveredShortfall:cg.uncoveredShortfall,escrowBalance:cg.escrowBalance,memberCount:cg.memberCount};
    const actual={token:db.metadata?.token||null};
    if(db.contract_address&&!eq(db.contract_address,CONTRACT))add(discrepancies,"contract_mismatch","group",id,{contract:CONTRACT},{contract:db.contract_address});
    const members=await pool.query("select user_id,wallet_address,status from group_memberships where group_id=$1",[db.id]);
    if(members.rowCount!==cg.memberCount)add(discrepancies,"member_count_mismatch","group",id,{memberCount:cg.memberCount},{memberCount:members.rowCount});
    for(const m of members.rows){
      try{
       const cm=await memberState(rawId,m.wallet_address);
       if(!cm.active&&m.status==="active")add(discrepancies,"member_status_mismatch","membership",m.wallet_address,{active:true},{active:cm.active,defaulted:cm.defaulted});
       if(cm.defaulted&&m.status!=="defaulted")add(discrepancies,"member_default_mismatch","membership",m.wallet_address,{status:"defaulted"},{status:m.status});
       if(!eq(cm.account,m.wallet_address))add(discrepancies,"member_address_mismatch","membership",m.wallet_address,{account:m.wallet_address},{account:cm.account});
      }catch(e){add(discrepancies,"member_read_error","membership",m.wallet_address,{readable:true},{error:e.message},"critical");}
    }
   }
   const logs=await rangeLogs(from,safe);
   const chainFacts=new Map();
   for(const log of logs){try{const p=iface.parseLog({topics:log.topics,data:log.data});if(p)chainFacts.set(`${log.transactionHash}:${log.index}`,p.name);}catch{}}
   const indexed=await pool.query("select tx_hash,log_index,event_name from chain_events where chain_id=$1 and contract_address=$2 and block_number between $3 and $4",[CHAIN_ID,CONTRACT,from,safe]);
   const indexedFacts=new Map(indexed.rows.map(r=>[`${r.tx_hash}:${r.log_index}`,r.event_name]));
   for(const [key,name] of chainFacts){if(!indexedFacts.has(key))add(discrepancies,"indexer_missing_event","chain_event",key,{eventName:name},{indexed:false});}
   for(const [key,name] of indexedFacts){if(!chainFacts.has(key))add(discrepancies,"indexer_orphan_event","chain_event",key,{presentOnChain:true},{eventName:name});}
   const facts=await pool.query("select tx_hash,log_index,event_name,args,block_number from chain_events where chain_id=$1 and contract_address=$2 and block_number between $3 and $4 order by block_number,log_index",[CHAIN_ID,CONTRACT,from,safe]);
   const tokenCache=new Map();
   for(const ev of facts.rows){try{await projectFinancialEvent(ev,runId,tokenCache,discrepancies);}catch(e){console.error(JSON.stringify({service:"liholiswano-reconciliation",status:"projection_error",txHash:ev.tx_hash,logIndex:ev.log_index,eventName:ev.event_name,error:e.message}));add(discrepancies,"projection_error","chain_event",`${ev.tx_hash}:${ev.log_index}`,{projectable:true},{error:e.message},"critical");}}
   for(const d of discrepancies)await pool.query("insert into reconciliation_discrepancies(run_id,severity,category,entity_type,entity_key,expected,actual) values($1,$2,$3,$4,$5,$6,$7)",
    [runId,d.severity,d.category,d.entityType,d.entityKey,JSON.stringify(d.expected),JSON.stringify(d.actual)]);
   const status=discrepancies.some(x=>x.severity==="critical")?"failed":discrepancies.length?"warning":"completed";
   await pool.query("update reconciliation_runs set status=$2,finished_at=now(),details=$3,discrepancy_count=$4,report=$5 where id=$1",
    [runId,status,JSON.stringify({mode:"financial-reconciliation",latestBlock:latest,safeBlock:safe,groups:groupIds.length,directEvents:chainFacts.size,indexedEvents:indexedFacts.size,discrepancies:discrepancies.length}),discrepancies.length,JSON.stringify({discrepancies})]);
   return {status,runId,latestBlock:latest,safeBlock:safe,groups:groupIds.length,directEvents:chainFacts.size,indexedEvents:indexedFacts.size,discrepancies:discrepancies.length};
  }catch(e){
   await pool.query("update reconciliation_runs set status='failed',finished_at=now(),details=$2 where id=$1",[runId,JSON.stringify({error:e.message})]).catch(()=>{});
   throw e;
  }
 }finally{await pool.query("select pg_advisory_unlock(hashtext('liholiswano-bnb-reconciliation'))").catch(()=>{});}
}
if(require.main===module){run().then(r=>{console.log(JSON.stringify({service:"liholiswano-reconciliation",...r}));return pool.end();}).catch(e=>{console.error(JSON.stringify({service:"liholiswano-reconciliation",status:"failed",error:e.message}));pool.end().finally(()=>process.exit(1));});}
module.exports={run};