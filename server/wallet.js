const {Wallet,JsonRpcProvider}=require("ethers");
function provider(){return new JsonRpcProvider(process.env.BSC_TESTNET_RPC_URL||"https://data-seed-prebsc-1-s1.bnbchain.org:8545");}
function configured(){return Boolean(process.env.WALLET_PROVIDER_URL&&process.env.WALLET_PROVIDER_API_KEY);}
function walletPolicy(){return {mode:process.env.WALLET_MODE||"managed",provider:process.env.WALLET_PROVIDER||"unset",configured:configured(),custody:"provider-managed",chainId:Number(process.env.BSC_CHAIN_ID||97)};}
function assertAddress(a){if(!/^0x[0-9a-fA-F]{40}$/.test(a||""))throw new Error("Invalid wallet address");return a;}
async function getNativeBalance(address){assertAddress(address);return (await provider().getBalance(address)).toString();}
module.exports={provider,configured,walletPolicy,assertAddress,getNativeBalance};