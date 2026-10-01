const {JsonRpcProvider,Contract}=require("ethers");
const {assertAddress}=require("./wallet");
const RPC=process.env.BSC_TESTNET_RPC_URL||"https://data-seed-prebsc-1-s1-s1.bnbchain.org:8545";
function provider(){return new JsonRpcProvider(process.env.BSC_TESTNET_RPC_URL||"https://data-seed-prebsc-1-s1.bnbchain.org:8545");}
function contract(address,abi){assertAddress(address);return new Contract(address,abi,provider());}
async function chainInfo(){const p=provider();return {chainId:Number((await p.getNetwork()).chainId),blockNumber:await p.getBlockNumber()};}
module.exports={provider,contract,chainInfo};