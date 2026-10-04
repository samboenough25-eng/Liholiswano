const {expect}=require("chai");
const {ethers}=require("hardhat");

describe("Liholiswano tier waiting-list protocol",function(){
 async function fixture(){
  const [owner,...users]=await ethers.getSigners();
  const T=await ethers.getContractFactory("MockUSDT"); const t=await T.deploy(owner.address,ethers.parseUnits("1000000",6)); await t.waitForDeployment();
  for(const u of users) await t.mint(u.address,ethers.parseUnits("5000",6));
  const F=await ethers.getContractFactory("Liholiswano"); const app=await F.deploy(owner.address,0); await app.waitForDeployment(); await app.setApprovedToken(t.target,true);
  return {owner,t,app,users};
 }
 async function setup(f,count=11){
  const payout=ethers.parseUnits("1000",6), collateral=ethers.parseUnits("200",6), id=await f.app.nextTierId();
  await f.app.createTier(f.t.target,payout,collateral,3600);
  for(const u of f.users.slice(0,count)){await f.t.connect(u).approve(f.app.target,ethers.MaxUint256);await f.app.connect(u).joinTier(id);}
  return {id,payout,contribution:ethers.parseUnits("100",6),collateral};
 }
 it("creates tiers with payout = 10 x contribution",async()=>{const f=await fixture(),x=await setup(f);const t=await f.app.getTier(x.id);expect(t.payout).eq(x.payout);expect(t.contribution).eq(x.contribution);});
 it("requires entry fee plus full collateral to join",async()=>{const f=await fixture(),id=await f.app.nextTierId();await f.app.createTier(f.t.target,ethers.parseUnits("500",6),ethers.parseUnits("100",6),3600);const u=f.users[0];await f.t.connect(u).approve(f.app.target,ethers.MaxUint256);const before=await f.t.balanceOf(u.address);await f.app.connect(u).joinTier(id);expect(await f.t.balanceOf(u.address)).eq(before-ethers.parseUnits("105",6));});
 it("reserves ten eligible funders, collects them, pays the recipient, and requeues them",async()=>{const f=await fixture(),x=await setup(f),cp=await f.app.getCurrentPayout(x.id),recipient=cp[2];let used=0;for(const u of f.users.slice(0,11)){if(u.address.toLowerCase()===recipient.toLowerCase())continue;await f.app.connect(u).reserveFunder(x.id);await f.app.connect(u).fundCurrent(x.id);used++;}expect(used).eq(10);const p=await f.app.getParticipant(x.id,recipient);expect(p.receivedCount).eq(1);expect(p.queueIndex).eq(11);});
 it("prevents the recipient from funding itself",async()=>{const f=await fixture(),x=await setup(f),recipient=(await f.app.getCurrentPayout(x.id))[2],u=f.users.find(v=>v.address.toLowerCase()===recipient.toLowerCase());await expect(f.app.connect(u).fundCurrent(x.id)).to.be.revertedWithCustomError(f.app,"NotEligible");});
 it("uses collateral for an expired reserved funder and makes them ineligible",async()=>{const f=await fixture(),x=await setup(f),recipient=(await f.app.getCurrentPayout(x.id))[2],u=f.users.find(v=>v.address.toLowerCase()!==recipient.toLowerCase());await f.app.connect(u).reserveNextFunder(x.id);await ethers.provider.send("evm_increaseTime",[3601]);await ethers.provider.send("evm_mine",[]);const before=await f.t.balanceOf(recipient);await f.app.defaultFunder(x.id,u.address);const p=await f.app.getParticipant(x.id,u.address);expect(p.collateral).eq(x.collateral-x.contribution);expect(p.eligible).eq(false);expect(await f.t.balanceOf(recipient)).eq(before+x.contribution);});
 it("restores collateral before eligibility returns",async()=>{const f=await fixture(),x=await setup(f),recipient=(await f.app.getCurrentPayout(x.id))[2],u=f.users.find(v=>v.address.toLowerCase()!==recipient.toLowerCase());await f.app.connect(u).reserveNextFunder(x.id);await ethers.provider.send("evm_increaseTime",[3601]);await ethers.provider.send("evm_mine",[]);await f.app.defaultFunder(x.id,u.address);await f.app.connect(u).restoreCollateral(x.id);const p=await f.app.getParticipant(x.id,u.address);expect(p.collateral).eq(x.collateral);expect(p.eligible).eq(true);});
 it("allows the next eligible participant after a default to reserve",async()=>{const f=await fixture(),x=await setup(f),recipient=(await f.app.getCurrentPayout(x.id))[2],bad=f.users.find(v=>v.address.toLowerCase()!==recipient.toLowerCase());await f.app.connect(bad).reserveNextFunder(x.id);await ethers.provider.send("evm_increaseTime",[3601]);await ethers.provider.send("evm_mine",[]);await f.app.defaultFunder(x.id,bad.address);const good=f.users.find(v=>v.address.toLowerCase()!==recipient.toLowerCase()&&v.address.toLowerCase()!==bad.address.toLowerCase());await f.app.connect(good).reserveNextFunder(x.id);expect(await f.app.isFunderEligible(x.id,good.address)).eq(false);});
});
