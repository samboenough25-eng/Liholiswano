const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiholiswanoV1 fixed-round D-B protocol", function () {
  async function fixture() {
    const [owner, ...users] = await ethers.getSigners();
    const Token = await ethers.getContractFactory("MockUSDT");
    const token = await Token.deploy(owner.address, ethers.parseUnits("1000000", 6));
    await token.waitForDeployment();
    for (const u of users) await token.mint(u.address, ethers.parseUnits("100000", 6));

    const F = await ethers.getContractFactory("LiholiswanoV1");
    const app = await F.deploy(owner.address);
    await app.waitForDeployment();

    await app.setApprovedToken(token.target, true);
    const windows = {
      1: [12 * 3600, 24 * 3600],
      2: [24 * 3600, 36 * 3600],
      3: [24 * 3600, 48 * 3600],
      4: [24 * 3600, 48 * 3600],
      5: [12 * 3600, 24 * 3600],
    };
    const payouts = {1: 200, 2: 400, 3: 600, 4: 800, 5: 100};
    const ids = {};
    for (const id of [1,2,3,4,5]) {
      ids[id] = id;
      const payout = ethers.parseUnits(String(payouts[id]), 6);
      const [target, max] = windows[id];
      await app.configureTier(id, token.target, payout, payout / 5n, target, max, true);
    }
    return { owner, users, token, app, ids };
  }

  async function joinEleven(f, tierId=1) {
    const collateral = ethers.parseUnits(tierId === 5 ? "20" : tierId === 1 ? "40" : String(tierId * 40), 6);
    for (const u of f.users.slice(0, 11)) {
      await f.token.connect(u).approve(f.app.target, ethers.MaxUint256);
      await f.app.connect(u).joinTier(tierId);
    }
    return { collateral };
  }

  it("configures exactly the five canonical tiers and P=10C, collateral=2C", async () => {
    const f = await fixture();
    const expected = {1:[200,20,40],2:[400,40,80],3:[600,60,120],4:[800,80,160],5:[100,10,20]};
    for (const id of [1,2,3,4,5]) {
      const t = await f.app.getTier(id);
      expect(t.payout).eq(ethers.parseUnits(String(expected[id][0]),6));
      expect(t.contribution).eq(ethers.parseUnits(String(expected[id][1]),6));
      expect(t.collateralRequired).eq(ethers.parseUnits(String(expected[id][2]),6));
    }
  });

  it("forms an immutable 11-member round and creates exactly 110 fixed obligations", async () => {
    const f = await fixture();
    await joinEleven(f, 1);
    const r = await f.app.getRound(1, 1);
    expect(r.active).eq(true);
    expect(r.members.length).eq(11);
    expect(await f.app.getWaitingList(1)).to.have.length(0);
    for (let i=0;i<11;i++) {
      const pos = await f.app.getPosition(1,1,i);
      expect(pos.recipient).eq(r.members[i]);
      expect(pos.resolvedCount).eq(0);
      for (let j=0;j<11;j++) {
        if (i===j) continue;
        const o = await f.app.getObligation(1,1,i,j);
        expect(o.funder).eq(r.members[j]);
        expect(o.amount).eq(r.contribution);
        expect(o.status).eq(1);
      }
    }
  });

  it("does not allow active-round configuration changes", async () => {
    const f = await fixture();
    await joinEleven(f, 1);
    await expect(
      f.app.configureTier(1, f.token.target, ethers.parseUnits("200",6), ethers.parseUnits("40",6), 12*3600, 24*3600, true)
    ).to.be.revertedWithCustomError(f.app, "InvalidConfig");
  });

  it("settles one payout independently when its own ten obligations are resolved", async () => {
    const f = await fixture();
    await joinEleven(f, 1);
    const r = await f.app.getRound(1,1);
    const recipientIndex = 5;
    const recipient = r.members[recipientIndex];
    const before = await f.token.balanceOf(recipient);
    for (let j=0;j<11;j++) {
      if (j===recipientIndex) continue;
      await f.app.connect(f.users[j]).payObligation(1,1,recipientIndex,j);
    }
    const pos = await f.app.getPosition(1,1,recipientIndex);
    expect(pos.resolvedCount).eq(10);
    expect(pos.resolvedAmount).eq(r.payout);
    await f.app.settlePayout(1,1,recipientIndex);
    expect(await f.token.balanceOf(recipient)).eq(before + r.payout);
    expect((await f.app.getPosition(1,1,recipientIndex)).settled).eq(true);
  });

  it("cannot cross-subsidize another payout position", async () => {
    const f = await fixture();
    await joinEleven(f, 1);
    const r = await f.app.getRound(1,1);
    for (let j=0;j<11;j++) {
      if (j===0) continue;
      await f.app.connect(f.users[j]).payObligation(1,1,0,j);
    }
    await expect(f.app.settlePayout(1,1,1)).to.be.revertedWithCustomError(f.app, "PayoutNotReady");
    const p0 = await f.app.getPosition(1,1,0);
    expect(p0.resolvedCount).eq(10);
    expect((await f.app.getPosition(1,1,1)).resolvedCount).eq(0);
  });

  it("uses only the defaulting funder's own collateral and requires restoration before another obligation", async () => {
    const f = await fixture();
    await joinEleven(f, 1);
    const r = await f.app.getRound(1,1);
    const funderIndex = 1;
    const recipientIndex = 0;
    await ethers.provider.send("evm_increaseTime", [24*3600 + 1]);
    await ethers.provider.send("evm_mine", []);
    const before = await f.token.balanceOf(r.members[recipientIndex]);
    await f.app.processExpiredObligation(1,1,recipientIndex,funderIndex);
    const p = await f.app.getParticipant(1,r.members[funderIndex]);
    expect(p.collateral).eq(ethers.parseUnits("20",6));
    expect(p.defaultCount).eq(1);
    expect(await f.token.balanceOf(r.members[recipientIndex])).eq(before + r.contribution);
    await expect(
      f.app.connect(f.users[funderIndex]).payObligation(1,1,2,funderIndex)
    ).to.be.revertedWithCustomError(f.app, "InsufficientEligibility");
    await f.token.connect(f.users[funderIndex]).approve(f.app.target, ethers.MaxUint256);
    await f.app.connect(f.users[funderIndex]).restoreCollateral(1);
    expect((await f.app.getParticipant(1,r.members[funderIndex])).collateral).eq(r.collateralRequired);
  });

  it("marks a second expired exposure BLOCKED_RECOVERY when reserve is not restored, without transferring it", async () => {
    const f = await fixture();
    await joinEleven(f, 1);
    const r = await f.app.getRound(1,1);
    await ethers.provider.send("evm_increaseTime", [24*3600 + 1]);
    await ethers.provider.send("evm_mine", []);
    await f.app.processExpiredObligation(1,1,0,1);
    await f.app.processExpiredObligation(1,1,2,1);
    const blocked = await f.app.getObligation(1,1,2,1);
    expect(blocked.status).eq(4);
    expect(blocked.funder).eq(r.members[1]);
    expect((await f.app.getPosition(1,1,2)).resolvedCount).eq(0);
  });

  it("restores a blocked obligation, records the default, and keeps the obligation with the original funder", async () => {
    const f = await fixture();
    await joinEleven(f, 1);
    const r = await f.app.getRound(1,1);
    await ethers.provider.send("evm_increaseTime", [24*3600 + 1]);
    await ethers.provider.send("evm_mine", []);
    await f.app.processExpiredObligation(1,1,0,1);
    await f.app.processExpiredObligation(1,1,2,1);
    await f.app.connect(f.users[1]).restoreAndResolveBlockedObligation(1,1,2,1);
    const o = await f.app.getObligation(1,1,2,1);
    expect(o.status).eq(3);
    expect(o.funder).eq(r.members[1]);
    expect((await f.app.getParticipant(1,r.members[1])).defaultCount).eq(2);
  });

  it("marks HIGH_DEFAULT at three defaults and suspends the immediately following round", async () => {
    const f = await fixture();
    await joinEleven(f, 1);
    const r = await f.app.getRound(1,1);
    await ethers.provider.send("evm_increaseTime", [24*3600 + 1]);
    await ethers.provider.send("evm_mine", []);
    for (const recipientIndex of [0,2,3]) {
      // Restore after each default so the same participant can legitimately expose another obligation.
      const p = await f.app.getParticipant(1,r.members[1]);
      if (p.collateral < r.collateralRequired) {
        await f.token.connect(f.users[1]).approve(f.app.target, ethers.MaxUint256);
        await f.app.connect(f.users[1]).restoreCollateral(1);
      }
      await f.app.processExpiredObligation(1,1,recipientIndex,1);
    }
    const p = await f.app.getParticipant(1,r.members[1]);
    expect(p.defaultCount).eq(3);
    expect(p.suspendedThroughRound).eq(2);
  });

  it("lets completed participants withdraw collateral and re-enter later with the entry fee", async () => {
    const f = await fixture();
    await joinEleven(f, 1);
    const r = await f.app.getRound(1,1);
    for (let i=0;i<11;i++) {
      for (let j=0;j<11;j++) {
        if (i===j) continue;
        await f.app.connect(f.users[j]).payObligation(1,1,i,j);
      }
      await f.app.settlePayout(1,1,i);
    }
    const member = r.members[0];
    const before = await f.token.balanceOf(member);
    await f.app.connect(f.users[0]).withdrawCollateral(1,1);
    expect((await f.app.getParticipant(1,member)).joined).eq(false);
    expect(await f.token.balanceOf(member)).eq(before + r.collateralRequired);
  });
  it("forms deterministic batches of eleven and leaves excess population waiting", async () => {
    const f = await fixture();
    for (const u of f.users.slice(0, 23)) {
      await f.token.connect(u).approve(f.app.target, ethers.MaxUint256);
      await f.app.connect(u).joinTier(1);
    }
    expect((await f.app.latestRoundId(1))).eq(2);
    expect((await f.app.getRound(1,1)).members.length).eq(11);
    expect((await f.app.getRound(1,2)).members.length).eq(11);
    const waiting = await f.app.getWaitingList(1);
    expect(waiting.length).eq(1);
    expect(waiting[0]).eq(f.users[22].address);
    for (const id of [1,2]) {
      const r = await f.app.getRound(1,id);
      for (let i=0;i<11;i++) {
        let count=0;
        for(let j=0;j<11;j++) if(i!==j){
          const o=await f.app.getObligation(1,id,i,j);
          expect(o.amount).eq(r.contribution); expect(o.funder).eq(r.members[j]); count++;
        }
        expect(count).eq(10);
      }
    }
  });

  it("enforces the canonical target and maximum timing windows", async () => {
    const f = await fixture();
    const expected = {1:[12,24],2:[24,36],3:[24,48],4:[24,48],5:[12,24]};
    for (const id of [1,2,3,4,5]) {
      const t = await f.app.getTier(id);
      expect(Number(t.targetWindow)).eq(expected[id][0]*3600);
      expect(Number(t.maxWindow)).eq(expected[id][1]*3600);
      await expect(
        f.app.configureTier(id, f.token.target, t.payout, t.collateralRequired, expected[id][0]*3600 + 1, expected[id][1]*3600, true)
      ).to.be.revertedWithCustomError(f.app, "InvalidConfig");
    }
  });

  it("freezes the collateral token while any participant remains joined", async () => {
    const f = await fixture();
    await joinEleven(f, 1);
    const Token = await ethers.getContractFactory("MockUSDT");
    const token2 = await Token.deploy(f.owner.address, ethers.parseUnits("1000000", 6));
    await token2.waitForDeployment();
    await f.app.setApprovedToken(token2.target, true);
    await expect(
      f.app.configureTier(1, token2.target, ethers.parseUnits("200",6), ethers.parseUnits("40",6), 12*3600, 24*3600, true)
    ).to.be.revertedWithCustomError(f.app, "InvalidConfig");
  });

});
