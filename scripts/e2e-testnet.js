const {ethers}=require("ethers");
const RPC=process.env.BSC_TESTNET_RPC_URL||"https://data-seed-prebsc-1-s1.bnbchain.org:8545",KEY=process.env.DEPLOYER_PRIVATE_KEY,CONTRACT=process.env.BNB_CONTRACT_ADDRESS,TOKEN=process.env.TEST_TOKEN_CONTRACT,SUB=process.env.SUBSCRIPTION_CONTRACT_ADDRESS;
if(!KEY||!CONTRACT||!TOKEN||!SUB)throw new Error("Fresh deployment addresses and DEPLOYER_PRIVATE_KEY are required");
const provider=new ethers.JsonRpcProvider(RPC),owner=new ethers.Wallet(KEY,provider);
const token=new ethers.Contract(TOKEN,["function mint(address,uint256)","function transfer(address,uint256) returns(bool)","function approve(address,uint256) returns(bool)","function balanceOf(address) view returns(uint256)"],owner);
const app=new ethers.Contract(CONTRACT,["function createTier(address,uint256,uint256,uint256)","function getTierIds() view returns(uint256[])","function getCurrentPayout(uint256) view returns(bool,uint256,address,uint256,uint256,uint256,address)","function joinTier(uint256)","function refreshFunder(uint256)","function fundCurrent(uint256)","function defaultCurrentFunder(uint256,address)","function getParticipant(uint256,address) view returns(bool,bool,uint256,uint256,uint256,uint256,uint256)","function approvedToken(address) view returns(bool)","function pause()","function unpause()","function paused() view returns(bool)"],owner);
const sub=new ethers.Contract(SUB,["function treasury() view returns(address)","function token() view returns(address)","function pause()","function unpause()","function paused() view returns(bool)"],owner);
async function send(label,p){const tx=await p;console.log(label+"_TX="+tx.hash);return tx.wait();}
async function main(){
 if((await provider.getNetwork()).chainId!==97n)throw new Error("Wrong chain");
 if(!(await app.approvedToken(TOKEN)))throw new Error("Test token not approved");
 const ids=await app.getTierIds();if(ids.length!==1||ids[0]!==1n)throw new Error("Expected exactly one deployed Tier 1");
 const id=1n,users=[];for(let i=0;i<11;i++)users.push(ethers.Wallet.createRandom().connect(provider));
 const gas=ethers.parseEther(process.env.TESTNET_MEMBER_GAS_FUND||"0.004");
 for(let i=0;i<users.length;i++){await send("FUND_MEMBER_"+(i+1),owner.sendTransaction({to:users[i].address,value:gas}));await send("MINT_MEMBER_"+(i+1),token.mint(users[i].address,ethers.parseUnits("5000",6)));await send("APPROVE_MEMBER_"+(i+1),token.connect(users[i]).approve(CONTRACT,ethers.MaxUint256));}
 await send("PAUSE_PROTOCOL",app.pause());if(!(await app.paused()))throw new Error("Pause failed");await send("UNPAUSE_PROTOCOL",app.unpause());if(await app.paused())throw new Error("Unpause failed");
 for(let i=0;i<users.length;i++)await send("JOIN_MEMBER_"+(i+1),app.connect(users[i]).joinTier(id));
 const cp=await app.getCurrentPayout(id),recipient=cp[2],beforePayout=await token.balanceOf(recipient);let funded=0;
 for(const u of users){if(u.address.toLowerCase()===recipient.toLowerCase())continue;await send("RESERVE_"+(++funded),app.connect(u).refreshFunder(id));await send("FUND_"+funded,app.connect(u).fundCurrent(id));}
 const payoutBal=await token.balanceOf(recipient);if(payoutBal-beforePayout!==ethers.parseUnits("1000",6))throw new Error("Recipient payout mismatch: "+ethers.formatUnits(payoutBal,6));
 const rp=await app.getParticipant(id,recipient);if(rp[4]!==1n||rp[3]!==11n)throw new Error("Recipient was not requeued correctly");
 const treasury=await sub.treasury();if(treasury.toLowerCase()!==owner.address.toLowerCase())throw new Error("Subscription treasury mismatch");if((await sub.token()).toLowerCase()!==TOKEN.toLowerCase())throw new Error("Subscription token mismatch");
 await send("PAUSE_SUBSCRIPTIONS",sub.pause());if(!(await sub.paused()))throw new Error("Subscription pause failed");await send("UNPAUSE_SUBSCRIPTIONS",sub.unpause());if(await sub.paused())throw new Error("Subscription unpause failed");
 console.log("TESTNET_QUEUE_E2E=PASS");console.log("TIER_ID=1");console.log("RECIPIENT="+recipient);console.log("PAYOUT=1000.000000");console.log("CONTRIBUTION=100.000000");console.log("FUNDERS="+funded);console.log("SUBSCRIPTION_E2E=SKIPPED_DISABLED");console.log("SUBSCRIPTION_PAUSE_E2E=PASS");
}
main().catch(e=>{console.error(e);process.exitCode=1;});