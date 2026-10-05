const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = ethers.provider;
  const network = await provider.getNetwork();
  if (network.chainId !== 97n) throw new Error("Expected BNB Smart Chain Testnet chain 97");

  const deployerBalance = await provider.getBalance(deployer.address);
  const min = ethers.parseEther(process.env.V1_E2E_MIN_DEPLOYER_BNB || "0.08");
  if (deployerBalance < min) {
    throw new Error("Insufficient deployer tBNB for the 11-wallet test. Balance=" + ethers.formatEther(deployerBalance) + ", required at least=" + ethers.formatEther(min));
  }

  const Token = await ethers.getContractFactory("MockUSDT");
  const token = await Token.deploy(deployer.address, ethers.parseUnits("1000000", 6));
  await token.waitForDeployment();

  const Protocol = await ethers.getContractFactory("LiholiswanoV1");
  const app = await Protocol.deploy(deployer.address);
  await app.waitForDeployment();
  await (await app.setApprovedToken(token.target, true)).wait();

  const windows = {1:[12,24],2:[24,36],3:[24,48],4:[24,48],5:[12,24]};
  const payouts = {1:200,2:400,3:600,4:800,5:100};
  for (const id of [1,2,3,4,5]) {
    const payout = ethers.parseUnits(String(payouts[id]), 6);
    await (await app.configureTier(id, token.target, payout, payout / 5n, windows[id][0] * 3600, windows[id][1] * 3600, true)).wait();
  }

  const wallets = Array.from({length:12}, () => ethers.Wallet.createRandom().connect(provider));
  const gasFund = ethers.parseEther(process.env.V1_E2E_WALLET_BNB || "0.004");
  for (const w of wallets) await (await deployer.sendTransaction({to:w.address,value:gasFund})).wait();
  for (const w of wallets) await (await token.mint(w.address, ethers.parseUnits("1000",6))).wait();

  for (const w of wallets.slice(0,11)) {
    const t = token.connect(w);
    await (await t.approve(app.target, ethers.MaxUint256)).wait();
    await (await app.connect(w).joinTier(1)).wait();
  }
  await (await token.connect(wallets[11]).approve(app.target, ethers.MaxUint256)).wait();
  await (await app.connect(wallets[11]).joinTier(1)).wait();

  const r = await app.getRound(1,1);
  if (!r.active || r.members.length !== 11) throw new Error("Fresh testnet round was not formed with 11 members");
  const waiting = await app.getWaitingList(1);
  if (waiting.length !== 1 || waiting[0].toLowerCase() !== wallets[11].address.toLowerCase()) throw new Error("12th wallet did not remain in the waiting list");

  const recipientIndex = 0;
  for (let j=1;j<11;j++) {
    await (await app.connect(wallets[j]).payObligation(1,1,recipientIndex,j)).wait();
  }
  const pos = await app.getPosition(1,1,recipientIndex);
  if (pos.resolvedCount !== 10n || pos.resolvedAmount !== r.payout) throw new Error("Full-funded payout position did not resolve");
  await (await app.connect(wallets[0]).settlePayout(1,1,recipientIndex)).wait();

  const defaultRecipient = 1;
  const defaultFunder = 2;
  const before = await token.balanceOf(wallets[defaultRecipient].address);
  await provider.send("evm_increaseTime",[24*3600+2]);
  await provider.send("evm_mine",[]);
  await (await app.processExpiredObligation(1,1,defaultRecipient,defaultFunder)).wait();
  const after = await token.balanceOf(wallets[defaultRecipient].address);
  if (after - before !== r.contribution) throw new Error("Collateral default did not pay the exact contribution");

  console.log("V1_TESTNET_E2E=PASS");
  console.log("CHAIN_ID=97");
  console.log("LIHOLISWANO_V1_CONTRACT=" + app.target);
  console.log("TEST_TOKEN_CONTRACT=" + token.target);
  console.log("ROUND_ID=1");
  console.log("ROUND_SIZE=11");
  console.log("WAITING_AFTER_12TH=1");
  console.log("INDEPENDENT_PAYOUT=PASS");
  console.log("COLLATERAL_DEFAULT=PASS");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
