require("dotenv").config();
const {Pool}=require("pg");
const {JsonRpcProvider,Interface,Contract,isAddress,formatUnits,getAddress}=require("ethers");
const {PROTOCOL_ABI}=require("./blockchain");

const CHAIN_ID=Number(process.env.BSC_CHAIN_ID||97);
const CONTRACT=process.env.BNB_CONTRACT_ADDRESS;
const RPC=process.env.BSC_RPC_URL||process.env.BSC_TESTNET_RPC_URL||"https://bsc-testnet-dataseed.bnbchain.org";
const CONFIRMATIONS=Number(process.env.INDEXER_CONFIRMATIONS||3);
const MAX_RANGE=Math.max(10,Number(process.env.RECONCILIATION_MAX_RANGE||100));
const START=process.env.RECONCILIATION_START_BLOCK==null||process.env.RECONCILIATION_START_BLOCK===""?null:Number(process.env.RECONCILIATION_START_BLOCK);

const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false}});
const rpc=new JsonRpcProvider(RPC);
const iface=new Interface(PROTOCOL_ABI);
const ERC20=new Interface([
 "event Transfer(address indexed from,address indexed to,uint256 value)",
 "function decimals() view returns (uint8)",
 "function symbol() view returns (string)"
]);

function eq(a,b){return String(a??"").toLowerCase()===String(b??"").toLowerCase();}
function safe(v){return typeof v==="bigint"?v.toString():v;}
function jsonSafe(v){if(typeof v==="bigint")return v.toString();if(Array.isArray(v))return v.map(jsonSafe);if(v&&typeof v==="object"){const o={};for(const [k,x] of Object.entries(v)){if(!/^\d+$/.test(k))o[k]=jsonSafe(x);}return o;}return v;}
function add(list,category,entityType,entityKey,expected,actual,severity="critical"){list.push({severity,category,entityType,entityKey,expected,actual});}

async function ensureSchema(){
 if(process.env.REQUIRE_DEDICATED_RPC==="true"&&!process.env.BSC_RPC_URL)throw new Error("A dedicated BSC_RPC_URL is required for production reconciliation");
 await pool.query(`
  create table if not exists reconciliation_state(
    chain_id bigint primary key, contract_address varchar(42) not null,
    last_processed_block bigint not null default -1, last_block_hash varchar(66),
    updated_at timestamptz not null default now()
  );
  create table if not exists reconciliation_discrepancies(
    id uuid primary key default gen_random_uuid(), run_id uuid references reconciliation_runs(id) on delete cascade,
    severity varchar(16) not null, category varchar(64) not null, entity_type varchar(64),
    entity_key varchar(255), expected jsonb not null default '{}'::jsonb, actual jsonb not null default '{}'::jsonb,
    resolved_at timestamptz, resolution_note text, created_at timestamptz not null default now()
  );
  create index if not exists idx_recon_discrepancies_open on reconciliation_discrepancies(created_at desc) where resolved_at is null;
  create index if not exists idx_recon_discrepancies_run on reconciliation_discrepancies(run_id);
  create table if not exists reconciliation_projection(
    id uuid primary key default gen_random_uuid(), chain_id bigint not null, contract_address varchar(42) not null,
    tx_hash varchar(66) not null, log_index integer not null, event_name varchar(96) not null,
    group_id varchar(66), wallet_address varchar(42), user_id uuid references users(id) on delete set null,
    asset_symbol varchar(16), asset_decimals integer, amount numeric(78,0), direction varchar(8),
    ledger_entry_id uuid references ledger_entries(id) on delete set null, block_number bigint not null,
    created_at timestamptz not null default now(), unique(chain_id,tx_hash,log_index,event_name)
  );
  create table if not exists reconciliation_member_snapshots(
    id uuid primary key default gen_random_uuid(), run_id uuid references reconciliation_runs(id) on delete cascade,
    group_id varchar(66) not null, wallet_address varchar(42) not null,
    active boolean not null, defaulted boolean not null, won_this_rotation boolean not null,
    contributed_this_round boolean not null, bid_submitted boolean not null, bid_bps bigint not null,
    total_wins bigint not null, total_contributed numeric(78,0) not null, total_received numeric(78,0) not null,
    block_number bigint not null, created_at timestamptz not null default now(),
    unique(run_id,group_id,wallet_address)
  );
  create index if not exists idx_recon_member_snapshot_group on reconciliation_member_snapshots(group_id,created_at desc);
 `);
}

async function safeBlock(){
 const latest=await rpc.getBlockNumber();
 try{const b=await rpc.getBlock("finalized");if(b?.number!=null)return Math.min(latest,Number(b.number));}catch{}
 return Math.max(0,latest-CONFIRMATIONS);
}
async function loadCursor(){
 const r=await pool.query("select last_processed_block,last_block_hash,contract_address from reconciliation_state where chain_id=$1",[CHAIN_ID]);
 if(!r.rowCount)return {block:START!==null?START-1:-1,hash:null};
 const row=r.rows[0];
 if(!eq(row.contract_address,CONTRACT))throw new Error("Reconciliation contract address mismatch");
 return {block:Number(row.last_processed_block),hash:row.last_block_hash||null};
}
async function saveCursor(block,hash){
 await pool.query(`insert into reconciliation_state(chain_id,contract_address,last_processed_block,last_block_hash,updated_at)
 values($1,$2,$3,$4,now())
 on conflict(chain_id) do update set contract_address=excluded.contract_address,last_processed_block=excluded.last_processed_block,last_block_hash=excluded.last_block_hash,updated_at=now()`,
 [CHAIN_ID,CONTRACT,block,hash]);
}
async function verifyCursor(cursor){
 if(cursor.block<0||!cursor.hash)return;
 const b=await rpc.getBlock(cursor.block);
 if(!b)throw new Error(`Reconciliation cursor block \${cursor.block} is unavailable`);
 if(b.hash&&!eq(b.hash,cursor.hash))throw new Error("Reconciliation cursor hash changed; explicit reorg recovery is required");
}
async function rangeLogs(from,to){
 const logs=[];
 for(let a=from;a<=to;a+=MAX_RANGE){
  const b=Math.min(to,a+MAX_RANGE-1);
  let attempt=0;
  while(true){
   try{logs.push(...await rpc.getLogs({address:CONTRACT,fromBlock:a,toBlock:b}));break;}
   catch(e){
    if(attempt++>=4)throw e;
    await new Promise(r=>setTimeout(r,Math.min(8000,500*Math.pow(2,attempt))));
   }
  }
 }
 return logs;
}
async function tokenInfo(address,cache){
 const key=address.toLowerCase(); if(cache.has(key))return cache.get(key);
 const c=new Contract(address,ERC20,rpc);
 let info={symbol:"UNKNOWN",decimals:18};
 try{info={symbol:String(await c.symbol()),decimals:Number(await c.decimals())};}catch{}
 cache.set(key,info); return info;
}
async function chainGroup(id){
 const c=new Contract(CONTRACT,PROTOCOL_ABI,rpc),g=await c.getGroup(id);
 return {exists:g[0],locked:g[1],admin:g[2],token:getAddress(g[3]),contribution:g[4].toString(),collateral:g[5].toString(),
  maxMembers:Number(g[6]),maxBidBps:Number(g[7]),round:Number(g[8]),rotation:Number(g[9]),reserve:g[10].toString(),
  uncoveredShortfall:g[11].toString(),roundDeadline:Number(g[12]),escrowBalance:g[13].toString(),memberCount:Number(g[14])};
}
async function memberState(group,wallet){
 const c=new Contract(CONTRACT,PROTOCOL_ABI,rpc),m=await c.getMember(group,wallet);
 return {account:getAddress(m[0]),active:m[1],defaulted:m[2],wonThisRotation:m[3],contributedThisRound:m[4],
  bidSubmitted:m[5],bidBps:Number(m[6]),totalWins:Number(m[7]),totalContributed:m[8].toString(),totalReceived:m[9].toString()};
}
async function contractTokenBalance(token){
 const c=new Contract(token,[ "function balanceOf(address) view returns(uint256)" ],rpc);
 return (await c.balanceOf(CONTRACT)).toString();
}
async function receiptTransfers(txHash,token){
 const receipt=await rpc.getTransactionReceipt(txHash);
 if(!receipt)return null;
 const transfers=[];
 for(const log of receipt.logs){
  if(log.address.toLowerCase()!==token.toLowerCase())continue;
  try{
   const p=ERC20.parseLog({topics:log.topics,data:log.data});
   if(p)transfers.push({from:getAddress(p.args.from),to:getAddress(p.args.to),value:p.args.value.toString()});
  }catch{}
 }
 return {status:Number(receipt.status),blockNumber:Number(receipt.blockNumber),transfers};
}
async function projectFinancialEvent(ev,runId,tokenCache,discrepancies){
 if(!["ContributionPaid","RoundSettled"].includes(ev.event_name))return;
 const args=ev.args||{},group=String(args.groupId),wallet=String(args.member||args.winner),token=(await chainGroup(group)).token;
 const ti=await tokenInfo(token,tokenCache);
 const raw=String(ev.event_name==="ContributionPaid"?args.amount:args.payout);
 const direction=ev.event_name==="ContributionPaid"?"debit":"credit";
 const user=await pool.query("select u.id from users u join wallets w on w.user_id=u.id where w.chain_id=$1 and lower(w.address)=lower($2) and w.verified_at is not null limit 1",[CHAIN_ID,wallet]);
 const userId=user.rowCount?user.rows[0].id:null;
 const ref=`chain:\${CHAIN_ID}:\${ev.tx_hash}:\${ev.log_index}`;
 let ledgerId=null;
 const existing=await pool.query("select id from ledger_entries where reference=$1 limit 1",[ref]);
 if(existing.rowCount)ledgerId=existing.rows[0].id;
 else if(userId){
  const amount=formatUnits(BigInt(raw),ti.decimals);
  const ins=await pool.query(`insert into ledger_entries(user_id,group_id,entry_type,asset_symbol,chain_id,amount,direction,status,reference,metadata)
   select $1,g.id,$2,$3,$4,$5,$6,'confirmed',$7,$8 from groups g
   where g.chain_id=$4 and g.onchain_group_id=$9 returning id`,
   [userId,ev.event_name==="ContributionPaid"?"rosca.contribution":"rosca.payout",ti.symbol,CHAIN_ID,amount,direction,ref,
    JSON.stringify({txHash:ev.tx_hash,logIndex:ev.log_index,rawAmount:raw,groupId:group}),group]);
  if(ins.rowCount)ledgerId=ins.rows[0].id;
 }
 if(!userId)add(discrepancies,"unmapped_financial_wallet","financial_event",ref,{verifiedWalletMapping:true},{wallet}, "warning");
 if(!ledgerId)add(discrepancies,"missing_ledger_entry","financial_event",ref,{ledgerReference:ref},{ledgerEntry:false},"critical");
 const receipt=await receiptTransfers(ev.tx_hash,token);
 if(!receipt)add(discrepancies,"missing_receipt","financial_event",ref,{receipt:true},{receipt:false},"critical");
 else if(receipt.status!==1)add(discrepancies,"failed_receipt","financial_event",ref,{status:1},{status:receipt.status},"critical");
 else{
  if(ev.event_name==="ContributionPaid"){
   const match=receipt.transfers.some(t=>eq(t.from,wallet)&&eq(t.to,CONTRACT)&&t.value===raw);
   if(!match)add(discrepancies,"contribution_transfer_mismatch","financial_event",ref,{from:wallet,to:CONTRACT,amount:raw},{transfers:receipt.transfers},"critical");
  }else{
   const totalOut=receipt.transfers.filter(t=>eq(t.from,CONTRACT)).reduce((n,t)=>n+BigInt(t.value),0n);
   const expected=BigInt(args.payout||raw)+BigInt(args.bidAmount||0);
   if(totalOut!==expected)add(discrepancies,"settlement_transfer_mismatch","financial_event",ref,{outgoingTotal:expected.toString()},{outgoingTotal:totalOut.toString(),transfers:receipt.transfers},"critical");
  }
 }
 await pool.query(`insert into reconciliation_projection(chain_id,contract_address,tx_hash,log_index,event_name,group_id,wallet_address,user_id,asset_symbol,asset_decimals,amount,direction,ledger_entry_id,block_number)
 values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
 on conflict(chain_id,tx_hash,log_index,event_name) do update set user_id=excluded.user_id,ledger_entry_id=excluded.ledger_entry_id`,
 [CHAIN_ID,CONTRACT,ev.tx_hash,ev.log_index,ev.event_name,group,wallet,userId,ti.symbol,ti.decimals,raw,direction,ledgerId,ev.block_number]);
}
async function reconcileGroups(runId,discrepancies,tokenCache){
 const c=new Contract(CONTRACT,PROTOCOL_ABI,rpc),ids=await c.getGroupIds();
 const dbGroups=await pool.query("select * from groups where chain_id=$1",[CHAIN_ID]);
 const byId=new Map(dbGroups.rows.map(g=>[String(g.onchain_group_id).toLowerCase(),g]));
 const escrowByToken=new Map();
 for(const rawId of ids){
  const id=String(rawId),cg=await chainGroup(rawId),db=byId.get(id.toLowerCase());
  const currentBalance=BigInt(await contractTokenBalance(cg.token));
  escrowByToken.set(cg.token.toLowerCase(),(escrowByToken.get(cg.token.toLowerCase())||0n)+BigInt(cg.escrowBalance));
  if(!db){add(discrepancies,"missing_group","group",id,{onchainGroupId:id},{database:false},"warning");continue;}
  if(db.contract_address&&!eq(db.contract_address,CONTRACT))add(discrepancies,"contract_mismatch","group",id,{contract:CONTRACT},{contract:db.contract_address});
  const dbToken=db.metadata?.token||null;
  if(dbToken&&!eq(dbToken,cg.token))add(discrepancies,"token_mismatch","group",id,{token:cg.token},{token:dbToken});
  const members=await pool.query("select user_id,wallet_address,status from group_memberships where group_id=$1",[db.id]);
  if(members.rowCount!==cg.memberCount)add(discrepancies,"member_count_mismatch","group",id,{memberCount:cg.memberCount},{memberCount:members.rowCount});
  for(const m of members.rows){
   try{
    const cm=await memberState(rawId,m.wallet_address);
    await pool.query(`insert into reconciliation_member_snapshots(run_id,group_id,wallet_address,active,defaulted,won_this_rotation,contributed_this_round,bid_submitted,bid_bps,total_wins,total_contributed,total_received,block_number)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
     [runId,id,m.wallet_address,cm.active,cm.defaulted,cm.wonThisRotation,cm.contributedThisRound,cm.bidSubmitted,cm.bidBps,cm.totalWins,cm.totalContributed,cm.totalReceived,await safeBlock()]);
    if(cm.active!== (m.status==="active"))add(discrepancies,"member_status_mismatch","membership",m.wallet_address,{active:m.status==="active"},{active:cm.active,defaulted:cm.defaulted});
    if(!eq(cm.account,m.wallet_address))add(discrepancies,"member_address_mismatch","membership",m.wallet_address,{account:m.wallet_address},{account:cm.account});
   }catch(e){add(discrepancies,"member_read_error","membership",m.wallet_address,{readable:true},{error:e.message},"critical");}
  }
  if(BigInt(await contractTokenBalance(cg.token))<BigInt(cg.escrowBalance))
   add(discrepancies,"group_escrow_exceeds_token_balance","group",id,{tokenBalanceAtLeast:cg.escrowBalance},{tokenBalance:await contractTokenBalance(cg.token)},"critical");
 }
 for(const [token,sum] of escrowByToken){
  const balance=BigInt(await contractTokenBalance(token));
  if(balance<sum)add(discrepancies,"aggregate_escrow_exceeds_token_balance","token",token,{escrowTotalAtMost:sum.toString()},{tokenBalance:balance.toString()},"critical");
 }
 return ids.length;
}
async function reconcileTransactionRequests(discrepancies){
 const q=await pool.query("select tx_hash,action,status,chain_id,contract_address,id from blockchain_transactions where chain_id=$1 and tx_hash is not null order by submitted_at desc limit 200",[CHAIN_ID]);
 for(const row of q.rows){
  const receipt=await rpc.getTransactionReceipt(row.tx_hash);
  if(!receipt){if(row.status==="confirmed")add(discrepancies,"confirmed_tx_missing_receipt","blockchain_transaction",row.tx_hash,{receipt:true},{receipt:false},"critical");continue;}
  if(Number(receipt.status)!==1 && row.status==="confirmed")add(discrepancies,"confirmed_tx_failed_onchain","blockchain_transaction",row.tx_hash,{receiptStatus:1},{receiptStatus:Number(receipt.status)},"critical");
  if(row.contract_address&&!eq(row.contract_address,CONTRACT))add(discrepancies,"transaction_contract_mismatch","blockchain_transaction",row.tx_hash,{contract:CONTRACT},{contract:row.contract_address});
 }
}
async function run(){
 if(CHAIN_ID!==97)throw new Error("Stage 3 reconciler currently supports BNB Testnet chain 97 only");
 if(!CONTRACT||!isAddress(CONTRACT))throw new Error("BNB_CONTRACT_ADDRESS is missing or invalid");
 if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL is not configured");
 await ensureSchema();
 const lock=await pool.query("select pg_try_advisory_lock(hashtext('liholiswano-bnb-reconciliation')) locked");
 if(!lock.rows[0].locked)return {status:"already_running"};
 try{
  const latest=await rpc.getBlockNumber(),safe=await safeBlock();
  const cursor=await loadCursor();await verifyCursor(cursor);
  const from=Math.max(cursor.block+1,START!==null?START:0);
  const to=Math.min(safe,from+MAX_RANGE-1);
  const run=await pool.query(`insert into reconciliation_runs(chain_id,contract_address,from_block,to_block,status,details)
   values($1,$2,$3,$4,'running',$5) returning id`,
   [CHAIN_ID,CONTRACT,from,to,JSON.stringify({mode:"financial-reconciliation",latestBlock:latest,safeBlock:safe})]);
  const runId=run.rows[0].id,discrepancies=[],tokenCache=new Map();
  try{
   const code=await rpc.getCode(CONTRACT);if(!code||code==="0x")throw new Error("Protocol contract has no code");
   const groupCount=await reconcileGroups(runId,discrepancies,tokenCache);
   if(from<=to){
    const logs=await rangeLogs(from,to),chainFacts=new Map();
    for(const log of logs){try{const p=iface.parseLog({topics:log.topics,data:log.data});if(p)chainFacts.set(`\${log.transactionHash}:\${log.index}`,p.name);}catch{}}
    const indexed=await pool.query("select tx_hash,log_index,event_name from chain_events where chain_id=$1 and contract_address=$2 and block_number between $3 and $4",[CHAIN_ID,CONTRACT,from,to]);
    const indexedFacts=new Map(indexed.rows.map(r=>[`\${r.tx_hash}:\${r.log_index}`,r.event_name]));
    for(const [key,name] of chainFacts)if(!indexedFacts.has(key))add(discrepancies,"indexer_missing_event","chain_event",key,{eventName:name},{indexed:false},"critical");
    for(const [key,name] of indexedFacts)if(!chainFacts.has(key))add(discrepancies,"indexer_orphan_event","chain_event",key,{onchain:false},{indexedEvent:name},"critical");
    const facts=await pool.query("select tx_hash,log_index,event_name,args,block_number from chain_events where chain_id=$1 and contract_address=$2 and block_number between $3 and $4 order by block_number,log_index",[CHAIN_ID,CONTRACT,from,to]);
    for(const ev of facts.rows){try{await projectFinancialEvent(ev,runId,tokenCache,discrepancies);}catch(e){add(discrepancies,"projection_error","chain_event",`\${ev.tx_hash}:\${ev.log_index}`,{projectable:true},{error:e.message},"critical");}}
   }
   await reconcileTransactionRequests(discrepancies);
   const endHash=to>=0?(await rpc.getBlock(to))?.hash:null;
   if(to>=from&&endHash)await saveCursor(to,endHash);
   const status=discrepancies.some(x=>x.severity==="critical")?"failed":discrepancies.length?"warning":"completed";
   const categorySummary=Object.entries(discrepancies.reduce((m,x)=>(m[x.category]=(m[x.category]||0)+1,m),{}));
   console.log(JSON.stringify({service:"liholiswano-reconciliation",status,runId,latestBlock:latest,safeBlock:safe,fromBlock:from,toBlock:to,groups:groupCount,discrepancies:discrepancies.length,categories:categorySummary}));
   await pool.query("update reconciliation_runs set status=$2,finished_at=now(),completed_at=now(),details=$3,discrepancy_count=$4,report=$5 where id=$1",
    [runId,status,JSON.stringify({mode:"financial-reconciliation",latestBlock:latest,safeBlock:safe,fromBlock:from,toBlock:to,groups:groupCount,discrepancies:discrepancies.length}),discrepancies.length,JSON.stringify({discrepancies})]);
   return {status,runId,latestBlock:latest,safeBlock:safe,fromBlock:from,toBlock:to,groups:groupCount,discrepancies:discrepancies.length};
  }catch(e){
   await pool.query("update reconciliation_runs set status='failed',finished_at=now(),completed_at=now(),details=$2 where id=$1",[runId,JSON.stringify({error:e.message})]).catch(()=>{});
   throw e;
  }
 }finally{await pool.query("select pg_advisory_unlock(hashtext('liholiswano-bnb-reconciliation'))").catch(()=>{});}
}
if(require.main===module)run().then(r=>{console.log(JSON.stringify({service:"liholiswano-reconciliation",...r}));return pool.end();}).catch(e=>{console.error(JSON.stringify({service:"liholiswano-reconciliation",status:"failed",error:e.message}));pool.end().finally(()=>process.exit(1));});
module.exports={run};
