const { ethers } = require("hardhat");

async function main() {
 const [deployer]=await ethers.getSigners();
 const network=await ethers.provider.getNetwork();
 if(network.chainId!==97n) throw new Error("Wrong network: expected BNB Smart Chain Testnet (97)");
 const balance=await ethers.provider.getBalance(deployer.address);
 if(balance===0n) throw new Error("Deployer wallet has 0 native balance. Fund the BNB Testnet wallet first.");
 const F=await ethers.getContractFactory("Liholiswano");
 const protocol=await F.deploy(deployer.address,0); await protocol.waitForDeployment();
 const T=await ethers.getContractFactory("MockUSDT");
 const mock=await T.deploy(deployer.address,ethers.parseUnits("1000000",6)); await mock.waitForDeployment();
 await (await protocol.setApprovedToken(mock.target,true)).wait();
 const defaultCollateral=ethers.parseUnits(process.env.TESTNET_TIER1_COLLATERAL||"200",6);
 const defaultPayout=ethers.parseUnits(process.env.TESTNET_TIER1_PAYOUT||"1000",6);
 const defaultWindow=Number(process.env.TESTNET_PAYMENT_WINDOW_SECONDS||3600);
 await (await protocol.createTier(mock.target,defaultPayout,defaultCollateral,defaultWindow)).wait();
 console.log("LIHOLISWANO_CONTRACT="+protocol.target);
 console.log("TEST_TOKEN_CONTRACT="+mock.target);
 console.log("CHAIN_ID="+network.chainId.toString());
 console.log("TOKEN_SYMBOL=mUSDT");
 console.log("TOKEN_DECIMALS=6");
 console.log("TIER1_PAYOUT="+ethers.formatUnits(defaultPayout,6));
 console.log("TIER1_CONTRIBUTION="+ethers.formatUnits(defaultPayout/10n,6));
 console.log("TIER1_COLLATERAL="+ethers.formatUnits(defaultCollateral,6));
 console.log("PAYMENT_WINDOW_SECONDS="+defaultWindow);
 console.log("DEPLOYER="+deployer.address);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
