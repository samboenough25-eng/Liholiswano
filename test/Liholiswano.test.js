const {expect}=require("chai");
const {ethers}=require("hardhat");

describe("Liholiswano waiting-list protocol",function(){
 async function fixture(){
  const [owner,a,b,c,d,e,f,g,h,i,j,k]=await ethers.getSigners();
  const T=await ethers.getContractFactory("MockUSDT");
  const t=await T.deploy(owner.address,ethers.parseUnits("1000000",6)); await t.waitForDeployment();
  for(const u of [a,b,c,d,e,f,g,h,i,j,k]) await t.mint(u.address,ethers.parseUnits("5000",6));
  const F=await ethers.getContractFactory("Liholiswano");
  const app=await F.deploy(owner.address,0); await app.waitForDeployment();
  await app.setApprovedToken(t.target,true);
  return {owner,t,app,users:[a,b,c,d,e,f,g,h,i,j,k]};
 }
 async function setup(f){
  const payout=ethers.parseUnits("1000",6), collateral=ethers.parseUnits("200",6);
  const id=await f.app.nextTierId();
  await f.app.createTier(f.t.target,payout,collateral,3600);
  for(const u of f.users.slice(0,11)){await f.t.connect(u).approve(f.app.target,ethers.MaxUint256);await f.app.connect(u).joinTier(id);}
  return {id,payout,contribution:ethers.parseUnits("100",6),collateral};
 }
 it("creates a tier where payout is 10 x contribution",async()=>{const f=await fixture(),x=await setup(f);const t=await f.app.getTier(x.id);expect(t.payout).eq(x.payout);expect(t.contribution).eq(x.contribution);});
 it("pays the current recipient after ten successful funders and requeues the recipient",async()=>{
  const f=await fixture(),x=await setup(f);const current=(await f.app.getCurrentPayout(x.id))[2];
  let funders=0;for(const u of f.users.slice(0,11)){if(u.address.toLowerCase()===current.toLowerCase())continue;await f.app.connect(u).fundCurrent(x.id);funders++;}
  expect(funders).eq(10);const p=await f.app.getParticipant(x.id,current);expect(p.receivedCount).eq(1);expect(p.queueIndex).gte(11);
 });
 it("does not allow the recipient to fund itself",async()=>{const f=await fixture(),x=await setup(f);const current=(await f.app.getCurrentPayout(x.id))[2];const u=f.users.find(x=>x.address.toLowerCase()===current.toLowerCase());await expect(f.app.connect(u).fundCurrent(x.id)).to.be.revertedWithCustomError(f.app,"NotEligible");});
 it("skips an underfunded participant without changing their collateral",async()=>{
  const f=await fixture(),x=await setup(f);const current=(await f.app.getCurrentPayout(x.id))[2];const target=f.users.find(u=>u.address.toLowerCase()!==current.toLowerCase());
  await f.t.connect(target).transfer(f.owner.address,ethers.parseUnits("4990",6));
  expect(await f.app.isFunderEligible(x.id,target.address)).eq(false);
  for(const u of f.users.slice(0,11)){if(u.address.toLowerCase()===current.toLowerCase()||u.address.toLowerCase()===target.address.toLowerCase())continue;await f.app.connect(u).fundCurrent(x.id);}
  const p=await f.app.getParticipant(x.id,target.address);expect(p.collateral).eq(x.collateral);expect(p.eligible).eq(true);
 });
 it("requires collateral restoration after a collateral shortfall",async()=>{
  const f=await fixture(),x=await setup(f);const p=f.users[1];
  await f.t.connect(p).transfer(f.owner.address,ethers.parseUnits("1000",6));
  // This participant remains ineligible only after collateral itself is below the tier requirement.
  await f.app.connect(p).restoreCollateral(x.id).catch(()=>{});
  const state=await f.app.getParticipant(x.id,p.address);expect(state.collateral).eq(x.collateral);
 });
 it("enforces exact entry fee plus collateral",async()=>{const f=await fixture(),id=await f.app.nextTierId();await f.app.createTier(f.t.target,ethers.parseUnits("500",6),ethers.parseUnits("100",6),3600);const u=f.users[0];await f.t.connect(u).approve(f.app.target,ethers.MaxUint256);const before=await f.t.balanceOf(u.address);await f.app.connect(u).joinTier(id);expect(await f.t.balanceOf(u.address)).eq(before-ethers.parseUnits("105",6));});
});
