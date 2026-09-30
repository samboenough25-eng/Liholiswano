const { ethers } = require("hardhat");

async function main() {
  const [owner, a, b, c] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDT");
  const token = await Token.deploy(owner.address, ethers.parseUnits("1000000", 6));
  await token.waitForDeployment();

  const App = await ethers.getContractFactory("Liholiswano");
  const app = await App.deploy(owner.address, 100);
  await app.waitForDeployment();
  await (await app.setApprovedToken(token.target, true)).wait();

  const members = [a, b, c];
  for (const m of members) {
    await (await token.mint(m.address, ethers.parseUnits("1000", 6))).wait();
    await (await token.connect(m).approve(app.target, ethers.MaxUint256)).wait();
  }

  const id = ethers.encodeBytes32String("E2E001");
  const contribution = ethers.parseUnits("100", 6);
  const collateral = ethers.parseUnits("50", 6);

  await (await app.connect(a).createGroup(id, token.target, contribution, collateral, 2000, 3)).wait();
  for (const m of members) await (await app.connect(m).joinGroup(id)).wait();
  for (const m of members) await (await app.connect(m).contribute(id)).wait();
  await (await app.connect(a).submitBid(id, 500)).wait();
  await (await app.connect(b).submitBid(id, 1500)).wait();
  await (await app.connect(c).submitBid(id, 1000)).wait();

  const before = await token.balanceOf(b.address);
  await (await app.settleRound(id)).wait();
  const after = await token.balanceOf(b.address);
  const expectedPayout = ethers.parseUnits("255", 6);

  if (after - before !== expectedPayout) throw new Error("Unexpected winner payout");
  const member = await app.getMember(id, b.address);
  if (member.totalWins !== 1n) throw new Error("Winner was not recorded");
  if (await app.protocolFeeBps() !== 100n) throw new Error("Protocol fee configuration mismatch");

  console.log("LOCAL_E2E=PASS");
  console.log("GROUP=E2E001");
  console.log("WINNER=" + b.address);
  console.log("PAYOUT=255.000000");
  console.log("PROTOCOL_FEE_BPS=100");
  console.log("ROTATION=" + (await app.getGroup(id))[9].toString());
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
