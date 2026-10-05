const { ethers } = require("hardhat");
async function main(){
 const [deployer]=await ethers.getSigners();
 const network=await ethers.provider.getNetwork();
 if(network.chainId!==97n)throw new Error("Wrong network: expected BNB Smart Chain Testnet (97)");
 if((await ethers.provider.getBalance(deployer.address))===0n)throw new Error("Deployer wallet has 0 native balance.");

 const Token=await ethers.getContractFactory("MockUSDT");
 const token=await Token.deploy(deployer.address,ethers.parseUnits("1000000",6));
 await token.waitForDeployment();

 const F=await ethers.getContractFactory("LiholiswanoV1");
 const protocol=await F.deploy(deployer.address);
 await protocol.waitForDeployment();
 await (await protocol.setApprovedToken(token.target,true)).wait();

 const windows={1:[12*3600,24*3600],2:[24*3600,36*3600],3:[24*3600,48*3600],4:[24*3600,48*3600],5:[12*3600,24*3600]};
 const payouts={1:200,2:400,3:600,4:800,5:100};
 for(const id of [1,2,3,4,5]){
  const payout=ethers.parseUnits(String(payouts[id]),6);
  await (await protocol.configureTier(id,token.target,payout,payout/5n,windows[id][0],windows[id][1],true)).wait();
 }
 console.log("LIHOLISWANO_V1_CONTRACT="+protocol.target);
 console.log("TEST_TOKEN_CONTRACT="+token.target);
 console.log("CHAIN_ID="+network.chainId);
 console.log("TOKEN_SYMBOL=mUSDT");
 console.log("TOKEN_DECIMALS=6");
 console.log("ENTRY_FEE=5.000000");
 for(const id of [1,2,3,4,5])console.log("TIER_"+id+"_PAYOUT="+payouts[id]+".000000");
 console.log("DEPLOYER="+deployer.address);
}
main().catch(e=>{console.error(e);process.exitCode=1;});