require("dotenv").config();
const {Pool}=require("pg");
const {JsonRpcProvider}=require("ethers");
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==="false"?false:{rejectUnauthorized:false}});
const rpc=new JsonRpcProvider(process.env.BSC_TESTNET_RPC_URL||"https://data-seed-prebsc-1-s1.bnbchain.org:8545");
async function run(){
  const net=await rpc.getNetwork();
  const block=await rpc.getBlockNumber();
  console.log(JSON.stringify({service:"liholiswano-indexer",chainId:Number(net.chainId),latestBlock:block}));
  await pool.query("insert into reconciliation_runs(chain_id,from_block,to_block,status,report,completed_at) values($1,$2,$3,'completed',$4,now())",[Number(net.chainId),block,block,JSON.stringify({mode:"health-check",discrepancyCount:0})]);
}
run().then(()=>pool.end()).catch(e=>{console.error(e);pool.end();process.exit(1)});
