const { ethers } = require("hardhat");

async function main() {
  const [owner, ...users] = await ethers.getSigners();
  const Token = await ethers.getContractFactory("MockUSDT");
  const token = await Token.deploy(owner.address, ethers.parseUnits("1000000", 6));
  await token.waitForDeployment();

  const F = await ethers.getContractFactory("LiholiswanoV1");
  const app = await F.deploy(owner.address);
  await app.waitForDeployment();
  await app.setApprovedToken(token.target, true);
  await app.configureTier(1, token.target, ethers.parseUnits("200", 6), ethers.parseUnits("40", 6), 12 * 3600, 24 * 3600, true);

  for (const u of users.slice(0, 12)) {
    await token.mint(u.address, ethers.parseUnits("5000", 6));
    await token.connect(u).approve(app.target, ethers.MaxUint256);
  }
  for (const u of users.slice(0, 11)) await app.connect(u).joinTier(1);
  await app.connect(users[11]).joinTier(1);

  const r = await app.getRound(1, 1);
  if (!r.active || r.members.length !== 11) throw new Error("Expected an active 11-member round");
  const waiting = await app.getWaitingList(1);
  if (waiting.length !== 1 || waiting[0].toLowerCase() !== users[11].address.toLowerCase()) throw new Error("Late joiner was not kept in the next-round waiting list");

  const recipientIndex = 0;
  const recipient = r.members[recipientIndex];
  const before = await token.balanceOf(recipient);
  for (let j = 0; j < 11; j++) {
    if (j === recipientIndex) continue;
    const o = await app.getObligation(1, 1, recipientIndex, j);
    if (o.funder.toLowerCase() !== r.members[j].toLowerCase() || o.amount !== r.contribution || o.status !== 1n) throw new Error("Fixed obligation matrix is incorrect");
    await app.connect(users[j]).payObligation(1, 1, recipientIndex, j);
  }
  const pos = await app.getPosition(1, 1, recipientIndex);
  if (pos.resolvedCount !== 10n || pos.resolvedAmount !== r.payout) throw new Error("Payout position did not resolve from its own ten obligations");
  await app.settlePayout(1, 1, recipientIndex);
  const after = await token.balanceOf(recipient);
  if (after - before !== r.payout) throw new Error("Recipient did not receive exact payout");

  console.log("LOCAL_V1_E2E=PASS");
  console.log("ROUND_SIZE=11");
  console.log("OBLIGATIONS=110_TOTAL");
  console.log("LATE_JOINERS_WAITING=1");
  console.log("INDEPENDENT_POSITION_SETTLEMENT=PASS");
}
main().catch(e => { console.error(e); process.exitCode = 1; });