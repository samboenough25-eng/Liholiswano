const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("LiholiswanoV1 adversarial token boundary", function () {
  async function deployApp(token, owner) {
    const F = await ethers.getContractFactory("LiholiswanoV1");
    const app = await F.deploy(owner.address);
    await app.waitForDeployment();
    await app.setApprovedToken(token.target, true);
    await app.configureTier(1, token.target, ethers.parseUnits("200",6), ethers.parseUnits("40",6), 12*3600, 24*3600, true);
    return app;
  }

  it("rejects a token that returns false", async function () {
    const [owner, user] = await ethers.getSigners();
    const T = await ethers.getContractFactory("FalseReturnToken");
    const token = await T.deploy(owner.address, ethers.parseUnits("100000",6));
    await token.waitForDeployment();
    await token.transfer(user.address, ethers.parseUnits("1000",6));
    const app = await deployApp(token, owner);
    await token.connect(user).approve(app.target, ethers.MaxUint256);
    await expect(app.connect(user).joinTier(1)).to.be.revertedWithCustomError(app, "TransferFailed");
  });

  it("accepts a token with no boolean return when exact balance accounting succeeds", async function () {
    const [owner, user] = await ethers.getSigners();
    const T = await ethers.getContractFactory("NoReturnToken");
    const token = await T.deploy(owner.address, ethers.parseUnits("100000",6));
    await ethers.provider.send("evm_mine", []);
    await token.transfer(user.address, ethers.parseUnits("1000",6));
    const app = await deployApp(token, owner);
    await token.connect(user).approve(app.target, ethers.MaxUint256);
    await app.connect(user).joinTier(1);
    const p = await app.getParticipant(1,user.address);
    expect(p.joined).eq(true);
    expect(p.collateral).eq(ethers.parseUnits("40",6));
  });

  it("rejects fee-on-transfer behavior because the protocol requires exact amounts", async function () {
    const [owner, user] = await ethers.getSigners();
    const T = await ethers.getContractFactory("FeeToken");
    const token = await T.deploy(owner.address, ethers.parseUnits("100000",6));
    await token.waitForDeployment();
    await token.transfer(user.address, ethers.parseUnits("1000",6));
    const app = await deployApp(token, owner);
    await token.connect(user).approve(app.target, ethers.MaxUint256);
    await expect(app.connect(user).joinTier(1)).to.be.revertedWithCustomError(app, "TransferMismatch");
  });

  it("blocks reentrant token callbacks with the protocol reentrancy guard", async function () {
    const [owner, user] = await ethers.getSigners();
    const T = await ethers.getContractFactory("ReentrantToken");
    const token = await T.deploy(owner.address, ethers.parseUnits("100000",6));
    await token.waitForDeployment();
    await token.transfer(user.address, ethers.parseUnits("1000",6));
    const app = await deployApp(token, owner);
    await token.setTarget(app.target);
    await token.connect(user).approve(app.target, ethers.MaxUint256);
    await app.connect(user).joinTier(1);
    expect(await token.attempted()).eq(true);
    expect((await app.getParticipant(1,user.address)).joined).eq(true);
  });
});
