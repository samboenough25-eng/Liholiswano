const {ethers}=require("hardhat");
async function main(){
 const [owner,...users]=await ethers.getSigners();const T=await ethers.getContractFactory("MockUSDT");const token=await T.deploy(owner.address,ethers.parseUnits("1000000",6));await token.waitForDeployment();
 const F=await ethers.getContractFactory("Liholiswano");const app=await F.deploy(owner.address,0);await app.waitForDeployment();await app.setApprovedToken(token.target,true);
 const id=await app.nextTierId(),payout=ethers.parseUnits("1000",6),collateral=ethers.parseUnits("200",6),contribution=ethers.parseUnits("100",6);
 await app.createTier(token.target,payout,collateral,3600);
 for(const u of users.slice(0,11)){await token.mint(u.address,ethers.parseUnits("5000",6));await token.connect(u).approve(app.target,ethers.MaxUint256);await app.connect(u).joinTier(id);}
 const recipient=(await app.getCurrentPayout(id))[2];const before=await token.balanceOf(recipient);
 let funded=0;for(const u of users.slice(0,11)){if(u.address.toLowerCase()===recipient.toLowerCase())continue;await app.connect(u).reserveNextFunder(id);await app.connect(u).fundCurrent(id);funded++;}
 if(funded!==10)throw new Error("Expected ten successful funders");const after=await token.balanceOf(recipient);if(after-before!==payout)throw new Error("Recipient did not receive Tier 1 payout");
 const part=await app.getParticipant(id,recipient);if(part.receivedCount!==1n)throw new Error("Recipient was not recorded");if(part.queueIndex!==11n)throw new Error("Recipient was not requeued at the back");
 console.log("LOCAL_E2E=PASS");console.log("TIER_ID="+id);console.log("PAYOUT=1000.000000");console.log("CONTRIBUTION=100.000000");console.log("FUNDERS="+funded);console.log("RECIPIENT="+recipient);
}
main().catch(e=>{console.error(e);process.exitCode=1;});
