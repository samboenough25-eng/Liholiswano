const { JsonRpcProvider, Wallet, Contract, parseEther } = require("ethers");
const { Pool } = require("pg");

const ABI=[
 "function latestRoundId(uint256) view returns(uint256)",
 "function getRound(uint256,uint256) view returns(bool,bool,bool,uint256,uint256,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint8,address[11])",
 "function getPosition(uint256,uint256,uint8) view returns(address,uint256,uint8,bool)",
 "function getObligation(uint256,uint256,uint8,uint8) view returns(address,uint256,uint256,uint8)",
 "function processExpiredObligation(uint256,uint256,uint8,uint8)",
 "function settlePayout(uint256,uint256,uint8)",
 "function paused() view returns(bool)"
];
const OPEN=1, ROUND_SIZE=11;
async function runOnce(){
 if(!process.env.DEPLOYER_PRIVATE_KEY||!process.env.BNB_CONTRACT_ADDRESS)return {status:"not_configured"};
 if(process.env.NODE_ENV==="production"&&process.env.REQUIRE_DEDICATED_RPC==="true"&&!process.env.BSC_RPC_URL)return {status:"not_configured",reason:"dedicated_rpc_required"};
 const rpc=process.env.BSC_RPC_URL||process.env.BSC_TESTNET_RPC_URL||"https://bsc-testnet-dataseed.bnbchain.org";
 const provider=new JsonRpcProvider(rpc), wallet=new Wallet(process.env.DEPLOYER_PRIVATE_KEY,provider);
 const minBalance=parseEther(process.env.AUTOMATION_MIN_NATIVE_BALANCE||"0.01");
 const balance=await provider.getBalance(wallet.address);
 if(balance<minBalance)return {status:"paused",reason:"keeper_gas_reserve_low",balance:balance.toString(),required:minBalance.toString()};
 const app=new Contract(process.env.BNB_CONTRACT_ADDRESS,ABI,wallet);
 if(await app.paused())return {status:"paused",reason:"protocol_paused"};

 let pool=null,locked=true;
 try{
  if(process.env.DATABASE_URL){
   pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false}});
   const l=await pool.query("select pg_try_advisory_lock(hashtext('liholiswano-bnb-v1-keeper')) locked");
   locked=Boolean(l.rows[0].locked); if(!locked)return {status:"already_running"};
  }
  const max=Number(process.env.MAX_KEEPER_ACTIONS_PER_RUN||25);
  let attempted=0,expiredProcessed=0,payoutsSettled=0,roundsChecked=0;
  for(let tierId=1;tierId<=5 && attempted<max;tierId++){
   const roundId=Number(await app.latestRoundId(tierId)); if(!roundId)continue;
   const r=await app.getRound(tierId,roundId);
   if(!r[1])continue;
   roundsChecked++;
   for(let i=0;i<ROUND_SIZE && attempted<max;i++){
    for(let j=0;j<ROUND_SIZE && attempted<max;j++){
     if(i===j)continue;
     const o=await app.getObligation(tierId,roundId,i,j);
     if(Number(o[3])===OPEN && Number(o[2])<=Math.floor(Date.now()/1000)){
      try{await (await app.processExpiredObligation(tierId,roundId,i,j)).wait();attempted++;expiredProcessed++;}
      catch(e){console.error("V1 obligation processing failed",tierId,roundId,i,j,String(e.shortMessage||e.message).slice(0,300));}
     }
    }
   }
   for(let i=0;i<ROUND_SIZE && attempted<max;i++){
    const p=await app.getPosition(tierId,roundId,i);
    if(!p[3] && Number(p[2])===10 && BigInt(p[1])===BigInt(r[6])){
     try{await (await app.settlePayout(tierId,roundId,i)).wait();attempted++;payoutsSettled++;}
     catch(e){console.error("V1 payout settlement failed",tierId,roundId,i,String(e.shortMessage||e.message).slice(0,300));}
    }
   }
  }
  return {status:"completed",roundsChecked,expiredProcessed,payoutsSettled,actionsSubmitted:attempted,keeper:wallet.address,balance:balance.toString()};
 }finally{
  if(pool){if(locked)await pool.query("select pg_advisory_unlock(hashtext('liholiswano-bnb-v1-keeper'))").catch(()=>{});await pool.end().catch(()=>{});}
 }
}
if(require.main===module)runOnce().then(x=>console.log(JSON.stringify(x))).catch(e=>{console.error(JSON.stringify({service:"liholiswano-v1-keeper",status:"failed",error:e.message}));process.exit(1)});
module.exports={runOnce};
