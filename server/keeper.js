require("dotenv").config();
const {JsonRpcProvider,Wallet,Contract}=require("ethers");
const provider=new JsonRpcProvider(process.env.BSC_TESTNET_RPC_URL||"https://data-seed-prebsc-1-s1.bnbchain.org:8545");
const ABI=[
 "function getGroupIds() view returns (bytes32[])",
 "function getGroup(bytes32) view returns (bool,bool,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
 "function settleRound(bytes32)"
];
async function run(){
  if(!process.env.DEPLOYER_PRIVATE_KEY || !process.env.STELLAR_CONTRACT_ID && !process.env.BNB_CONTRACT_ADDRESS) {
    console.log(JSON.stringify({service:"liholiswano-keeper",status:"not_configured"})); return;
  }
  const address=process.env.BNB_CONTRACT_ADDRESS||process.env.STELLAR_CONTRACT_ID;
  if(!/^0x[0-9a-fA-F]{40}$/.test(address)){console.log(JSON.stringify({service:"liholiswano-keeper",status:"invalid_contract_address"}));return;}
  const signer=new Wallet(process.env.DEPLOYER_PRIVATE_KEY,provider);
  const contract=new Contract(address,ABI,signer);
  const ids=await contract.getGroupIds();
  let attempted=0;
  for(const id of ids){
    const g=await contract.getGroup(id);
    if(g[1] && Number(g[12])<=Math.floor(Date.now()/1000)){
      try{const tx=await contract.settleRound(id);console.log(JSON.stringify({groupId:id,txHash:tx.hash}));attempted++;}catch(e){console.log(JSON.stringify({groupId:id,status:"not_settled",reason:String(e.shortMessage||e.message).slice(0,300)}));}
    }
  }
  console.log(JSON.stringify({service:"liholiswano-keeper",status:"completed",groupsChecked:ids.length,settlementsSubmitted:attempted}));
}
run().catch(e=>{console.error(e);process.exit(1)});
