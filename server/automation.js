const {JsonRpcProvider,Wallet,Contract,parseEther}=require("ethers");
const {Pool}=require("pg");
const ABI=[
 "function getGroupIds() view returns (bytes32[])",
 "function getGroup(bytes32) view returns (bool,bool,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
 "function settleRound(bytes32)",
 "function paused() view returns(bool)"
];

async function runOnce(){
 if(!process.env.DEPLOYER_PRIVATE_KEY||!process.env.BNB_CONTRACT_ADDRESS)return {status:"not_configured"};
 if(process.env.NODE_ENV==="production"&&process.env.REQUIRE_DEDICATED_RPC==="true"&&!process.env.BSC_RPC_URL)return {status:"not_configured",reason:"dedicated_rpc_required"};
 const rpc=process.env.BSC_RPC_URL||process.env.BSC_TESTNET_RPC_URL||"https://bsc-testnet-dataseed.bnbchain.org";
 const p=new JsonRpcProvider(rpc);
 const wallet=new Wallet(process.env.DEPLOYER_PRIVATE_KEY,p);
 const minBalance=parseEther(process.env.AUTOMATION_MIN_NATIVE_BALANCE||"0.01");
 const balance=await p.getBalance(wallet.address);
 if(balance<minBalance)return {status:"paused",reason:"keeper_gas_reserve_low",balance:balance.toString(),required:minBalance.toString()};
 let pool=null,locked=true;
 try{
  if(process.env.DATABASE_URL){
   pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false}});
   const l=await pool.query("select pg_try_advisory_lock(hashtext('liholiswano-bnb-settlement-keeper')) locked");
   locked=Boolean(l.rows[0].locked);
   if(!locked)return {status:"already_running"};
  }
  const c=new Contract(process.env.BNB_CONTRACT_ADDRESS,ABI,wallet);
  if(await c.paused())return {status:"paused",reason:"protocol_paused"};
  const ids=await c.getGroupIds();
  const max=Math.max(1,Number(process.env.MAX_SETTLEMENTS_PER_RUN||10));
  let attempted=0;
  for(const id of ids){
   if(attempted>=max)break;
   const g=await c.getGroup(id);
   if(g[1]&&Number(g[12])<=Math.floor(Date.now()/1000)){
    try{await (await c.settleRound(id)).wait();attempted++;}
    catch(e){console.error("settlement failed",id,String(e.shortMessage||e.message).slice(0,300));}
   }
  }
  return {status:"completed",groupsChecked:ids.length,settlementsSubmitted:attempted,keeper:wallet.address,balance:balance.toString()};
 }finally{
  if(pool){if(locked)await pool.query("select pg_advisory_unlock(hashtext('liholiswano-bnb-settlement-keeper'))").catch(()=>{});await pool.end().catch(()=>{});}
 }
}
if(require.main===module)runOnce().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(e);process.exit(1)});
module.exports={runOnce};
