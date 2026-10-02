const {expect}=require("chai");
const {ethers}=require("hardhat");

describe("LiholiswanoSubscriptions",function(){
  async function fixture(){
    const [owner,treasury,alice,bob]=await ethers.getSigners();
    const T=await ethers.getContractFactory("MockUSDT");
    const token=await T.deploy(owner.address,ethers.parseUnits("1000000",6));
    await token.mint(alice.address,ethers.parseUnits("100",6));
    const V=await ethers.getContractFactory("LiholiswanoSubscriptions");
    const vault=await V.deploy(treasury.address,token.target);
    return {owner,treasury,alice,bob,token,vault};
  }

  it("routes the exact payment to the separate treasury and records the subscription key",async()=>{
    const f=await fixture();
    const amount=ethers.parseUnits("5",6);
    const key=ethers.keccak256(ethers.toUtf8Bytes("alice-2026-10"));
    const customer=ethers.keccak256(ethers.toUtf8Bytes("customer"));
    const period=1730419200;
    await f.token.connect(f.alice).approve(f.vault.target,amount);
    const before=await f.token.balanceOf(f.treasury.address);
    await expect(f.vault.connect(f.alice).paySubscription(key,customer,period,amount))
      .to.emit(f.vault,"SubscriptionPaid").withArgs(key,customer,f.alice.address,f.token.target,amount,period);
    expect(await f.token.balanceOf(f.treasury.address)).eq(before+amount);
    expect(await f.vault.paid(key)).eq(true);
    await expect(f.vault.connect(f.alice).paySubscription(key,customer,period,amount))
      .to.be.revertedWithCustomError(f.vault,"AlreadyPaid");
  });

  it("pauses payments and only the owner can administer",async()=>{
    const f=await fixture();
    await f.vault.pause();
    expect(await f.vault.paused()).eq(true);
    const key=ethers.keccak256(ethers.toUtf8Bytes("paused"));
    const customer=ethers.keccak256(ethers.toUtf8Bytes("customer"));
    await expect(f.vault.connect(f.alice).paySubscription(key,customer,1730419200,1))
      .to.be.revertedWithCustomError(f.vault,"Paused");
    await expect(f.vault.connect(f.alice).pause()).to.be.revertedWithCustomError(f.vault,"Unauthorized");
    await f.vault.unpause();
    expect(await f.vault.paused()).eq(false);
  });

  it("rejects zero identifiers, zero amount and zero admin addresses",async()=>{
    const f=await fixture();
    await expect(f.vault.paySubscription(ethers.ZeroHash,ethers.keccak256(ethers.toUtf8Bytes("c")),1,1))
      .to.be.revertedWithCustomError(f.vault,"InvalidAmount");
    await expect(f.vault.paySubscription(ethers.keccak256(ethers.toUtf8Bytes("k")),ethers.ZeroHash,1,1))
      .to.be.revertedWithCustomError(f.vault,"InvalidAmount");
    await expect(f.vault.paySubscription(ethers.keccak256(ethers.toUtf8Bytes("k")),ethers.keccak256(ethers.toUtf8Bytes("c")),1,0))
      .to.be.revertedWithCustomError(f.vault,"InvalidAmount");
    await expect(f.vault.setTreasury(ethers.ZeroAddress)).to.be.revertedWithCustomError(f.vault,"ZeroAddress");
    await expect(f.vault.setToken(ethers.ZeroAddress)).to.be.revertedWithCustomError(f.vault,"ZeroAddress");
  });
});
