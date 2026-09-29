const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  const Liholiswano = await ethers.getContractFactory("Liholiswano");
  const protocol = await Liholiswano.deploy(deployer.address, 0);
  await protocol.waitForDeployment();

  const MockUSDT = await ethers.getContractFactory("MockUSDT");
  const initialSupply = ethers.parseUnits("1000000", 6);
  const mock = await MockUSDT.deploy(deployer.address, initialSupply);
  await mock.waitForDeployment();

  const approveTx = await protocol.setApprovedToken(mock.target, true);
  await approveTx.wait();

  console.log("LIHOLISWANO_CONTRACT=" + protocol.target);
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