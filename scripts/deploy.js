const { ethers } = require("hardhat");
async function main(){
 const [deployer]=await ethers.getSigners();const network=await ethers.provider.getNetwork();
 if(network.chainId!==97n)throw new Error("Wrong network: expected BNB Smart Chain Testnet (97)");
 const balance=await ethers.provider.getBalance(deployer.address);if(balance===0n)throw new Error("Deployer wallet has 0 native balance.");
 const F=await ethers.getContractFactory("Liholiswano");const protocol=await F.deploy(deployer.address);await protocol.waitForDeployment();
 const T=await ethers.getContractFactory("MockUSDT");const mock=await T.deploy(deployer.address,ethers.parseUnits("1000000",6));await mock.waitForDeployment();
 await (await protocol.setApprovedToken(mock.target,true)).wait();
 const collateral=ethers.parseUnits(process.env.TESTNET_TIER1_COLLATERAL||"200",6),payout=ethers.parseUnits(process.env.TESTNET_TIER1_PAYOUT||"1000",6),window=Number(process.env.TESTNET_PAYMENT_WINDOW_SECONDS||3600);
 await (await protocol.createTier(mock.target,payout,collateral,window)).wait();
 const S=await ethers.getContractFactory("LiholiswanoSubscriptions");const treasury=process.env.SUBSCRIPTION_TREASURY_ADDRESS||deployer.address;
 const subscriptions=await S.deploy(treasury,mock.target);await subscriptions.waitForDeployment();
 console.log("LIHOLISWANO_CONTRACT="+protocol.target);console.log("TEST_TOKEN_CONTRACT="+mock.target);console.log("SUBSCRIPTION_CONTRACT="+subscriptions.target);
 console.log("SUBSCRIPTION_TREASURY="+treasury);console.log("CHAIN_ID="+network.chainId);console.log("TOKEN_SYMBOL=mUSDT");console.log("TOKEN_DECIMALS=6");
 console.log("TIER1_PAYOUT="+ethers.formatUnits(payout,6));console.log("TIER1_CONTRIBUTION="+ethers.formatUnits(payout/10n,6));console.log("TIER1_COLLATERAL="+ethers.formatUnits(collateral,6));console.log("PAYMENT_WINDOW_SECONDS="+window);console.log("DEPLOYER="+deployer.address);
}
main().catch(e=>{console.error(e);process.exitCode=1;});