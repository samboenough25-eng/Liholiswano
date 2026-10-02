const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  if (network.chainId !== 97n) {
    throw new Error("Wrong network: expected BNB Smart Chain Testnet (97), got " + network.chainId);
  }

  const balance = await ethers.provider.getBalance(deployer.address);
  if (balance === 0n) {
    throw new Error("Deployer wallet has 0 native balance. Fund the BNB Testnet wallet with tBNB before deploying.");
  }

  console.log("DEPLOYER_BALANCE_TBNB=" + ethers.formatEther(balance));

  const Liholiswano = await ethers.getContractFactory("Liholiswano");
  const protocol = await Liholiswano.deploy(deployer.address, 0);
  await protocol.waitForDeployment();

  const MockUSDT = await ethers.getContractFactory("MockUSDT");
  const initialSupply = ethers.parseUnits("1000000", 6);
  const mock = await MockUSDT.deploy(deployer.address, initialSupply);
  await mock.waitForDeployment();

  const Subscriptions = await ethers.getContractFactory("LiholiswanoSubscriptions");
  const subscriptionTreasury = process.env.SUBSCRIPTION_TREASURY_ADDRESS || deployer.address;
  if (!ethers.isAddress(subscriptionTreasury) || subscriptionTreasury === ethers.ZeroAddress) throw new Error("Invalid SUBSCRIPTION_TREASURY_ADDRESS");
  const subscriptions = await Subscriptions.deploy(subscriptionTreasury, mock.target);
  await subscriptions.waitForDeployment();

  const approveTx = await protocol.setApprovedToken(mock.target, true);
  await approveTx.wait();

  const approved = await protocol.approvedToken(mock.target);
  if (!approved) {
    throw new Error("MockUSDT was not approved by the protocol");
  }

  console.log("LIHOLISWANO_CONTRACT=" + protocol.target);
  console.log("SUBSCRIPTION_CONTRACT=" + subscriptions.target);
  console.log("SUBSCRIPTION_TREASURY=" + subscriptionTreasury);
  console.log("TEST_TOKEN_CONTRACT=" + mock.target);
  console.log("DEPLOYER=" + deployer.address);
  console.log("CHAIN_ID=" + network.chainId.toString());
  console.log("TOKEN_SYMBOL=mUSDT");
  console.log("TOKEN_DECIMALS=6");
  console.log("TOKEN_APPROVED=true");
  console.log("NEXT=copy LIHOLISWANO_CONTRACT and TEST_TOKEN_CONTRACT into web/config.js");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
