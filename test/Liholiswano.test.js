const {expect}=require("chai");
const {ethers}=require("hardhat");

describe("Liholiswano tier waiting-list protocol",function(){
 async function fixture(){
  const [owner,...users]=await ethers.getSigners();
  const T=await ethers.getContractFactory("MockUSDT");
  const t=await T.deploy(owner.address,ethers.parseUnits("1000000",6));await t.waitForDeployment();
  for(const u of users) await t.mint(u.address,ethers.parseUnits("5000",6));
  const F=await ethers.getContractFactory("Liholiswano");
  const app=await F.deploy(owner.address);await app.waitForDeployment();await app.setApprovedToken(t.target,true);
  return {owner,t,app,users};
 }
 async function setup(f,count=11){
  const payout=ethers.parseUnits("1000",6),collateral=ethers.parseUnits("200",6),id=await f.app.nextTierId();
  await f.app.createTier(f.t.target,payout,collateral,3600);
  for(const u of f.users.slice(0,count)){await f.t.connect(u).approve(f.app.target,ethers.MaxUint256);await f.app.connect(u).joinTier(id);}
  return {id,payout,contribution:ethers.parseUnits("100",6),collateral};
 }
 it("enforces payout = ten contributions",async()=>{
  const f=await fixture(),x=await setup(f),t=await f.app.getTier(x.id);
  expect(t.payout).eq(x.payout);expect(t.contribution).eq(x.contribution);
 });
 it("charges P5 entry fee and locks only the configured collateral in the protocol",async()=>{
  const f=await fixture(),id=await f.app.nextTierId(),u=f.users[0];
  await f.app.createTier(f.t.target,ethers.parseUnits("500",6),ethers.parseUnits("100",6),3600);
  await f.t.connect(u).approve(f.app.target,ethers.MaxUint256);
  const beforeUser=await f.t.balanceOf(u.address),beforeTreasury=await f.t.balanceOf(f.owner.address);
  await f.app.connect(u).joinTier(id);
  expect(await f.t.balanceOf(u.address)).eq(beforeUser-ethers.parseUnits("105",6));
  expect(await f.t.balanceOf(f.owner.address)).eq(beforeTreasury+ethers.parseUnits("5",6));
  expect(await f.t.balanceOf(f.app.target)).eq(ethers.parseUnits("100",6));
 });
 it("assigns the first eligible funder, requires that funder to pay, then advances",async()=>{
  const f=await fixture(),x=await setup(f),cp=await f.app.getCurrentPayout(x.id),recipient=cp[2];
  const first=f.users.find(u=>u.address.toLowerCase()!==recipient.toLowerCase());
  await f.app.refreshFunder(x.id);
  const after=await f.app.getCurrentPayout(x.id);
  expect(after[6].toLowerCase()).eq(first.address.toLowerCase());
  await f.app.connect(first).fundCurrent(x.id);
  expect((await f.app.getCurrentPayout(x.id))[4]).eq(1);
 });
 it("does not allow a non-assigned participant to fund",async()=>{
  const f=await fixture(),x=await setup(f),cp=await f.app.getCurrentPayout(x.id),recipient=cp[2];
  const first=f.users.find(u=>u.address.toLowerCase()!==recipient.toLowerCase());
  const second=f.users.find(u=>u.address.toLowerCase()!==recipient.toLowerCase()&&u.address.toLowerCase()!==first.address.toLowerCase());
  await f.app.refreshFunder(x.id);
  await expect(f.app.connect(second).fundCurrent(x.id)).to.be.revertedWithCustomError(f.app,"NotCurrentFunder");
 });
 it("uses collateral when the assigned funder misses the deadline and blocks eligibility until restoration",async()=>{
  const f=await fixture(),x=await setup(f),cp=await f.app.getCurrentPayout(x.id),recipient=cp[2];
  const first=f.users.find(u=>u.address.toLowerCase()!==recipient.toLowerCase());
  await f.app.refreshFunder(x.id);
  await ethers.provider.send("evm_increaseTime",[3601]);await ethers.provider.send("evm_mine",[]);
  const before=await f.t.balanceOf(recipient);
  await f.app.defaultCurrentFunder(x.id);
  const p=await f.app.getParticipant(x.id,first.address);
  expect(p.collateral).eq(x.collateral-x.contribution);expect(p.eligible).eq(false);
  expect(await f.t.balanceOf(recipient)).eq(before+x.contribution);
  await f.app.connect(first).approve(f.app.target,ethers.MaxUint256);
  await f.app.connect(first).restoreCollateral(x.id);
  const restored=await f.app.getParticipant(x.id,first.address);
  expect(restored.collateral).eq(x.collateral);expect(restored.eligible).eq(true);
 });
 it("pays the full tier after ten contributions and moves the recipient to the back",async()=>{
  const f=await fixture(),x=await setup(f),cp=await f.app.getCurrentPayout(x.id),recipient=cp[2];
  const before=await f.t.balanceOf(recipient);
  for(let n=0;n<10;n++){
   await f.app.refreshFunder(x.id);
   const current=await f.app.getCurrentPayout(x.id);
   const funder=current[6];
   await f.app.connect(f.users.find(u=>u.address.toLowerCase()===funder.toLowerCase())).fundCurrent(x.id);
  }
  expect(await f.t.balanceOf(recipient)).eq(before+x.payout);
  const q=await f.app.getQueue(x.id);
  expect(q[q.length-1].toLowerCase()).eq(recipient.toLowerCase());
 });
});
