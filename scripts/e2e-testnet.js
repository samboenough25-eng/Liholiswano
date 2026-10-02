// BNB Testnet controlled E2E: test wallets + MockUSDT only.
// This script never uses real USDT/USDC and must only run on BSC Testnet.
const { ethers } = require("ethers");

const RPC = process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet.bnbchain.org";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const CONTRACT = process.env.BNB_CONTRACT_ADDRESS || "0xe9b104260c940fAE26a73e4E9c952fD18fFd2014";
const TOKEN = process.env.TEST_TOKEN_CONTRACT || "0xb516a4a0ec39e3CBa5baDAE5524E05F43EB66C29";
const SUBSCRIPTION = process.env.SUBSCRIPTION_CONTRACT_ADDRESS;
// Keep the E2E gas budget deliberately small. BSC Testnet gas is inexpensive;
// the test only needs enough tBNB for each temporary member's transactions.
const MEMBER_GAS_FUND = ethers.parseEther(process.env.TESTNET_MEMBER_GAS_FUND || "0.002");
const OWNER_GAS_RESERVE = ethers.parseEther(process.env.TESTNET_OWNER_GAS_RESERVE || "0.01");

if (!PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY is required");

const provider = new ethers.JsonRpcProvider(RPC);
const owner = new ethers.Wallet(PRIVATE_KEY, provider);

const tokenAbi = [
  "function mint(address,uint256)",
  "function transfer(address,uint256) returns (bool)",
  "function approve(address,uint256) returns (bool)",
  "function balanceOf(address) view returns (uint256)"
];
const appAbi = [
  "function createGroup(bytes32,address,uint256,uint256,uint256,uint256)",
  "function joinGroup(bytes32)",
  "function contribute(bytes32)",
  "function submitBid(bytes32,uint256)",
  "function settleRound(bytes32)",
  "function pause()",
  "function unpause()",
  "function paused() view returns (bool)",
  "function approvedToken(address) view returns (bool)",
  "function getMember(bytes32,address) view returns (address,bool,bool,bool,bool,bool,uint256,uint256,uint256,uint256)",
  "function protocolFeeBps() view returns (uint256)",
  "function paused() view returns (bool)",
  "event GroupCreated(bytes32 indexed groupId,address indexed admin,address indexed token)",
  "event MemberJoined(bytes32 indexed groupId,address indexed member)",
  "event GroupLockedEvent(bytes32 indexed groupId,uint256 round,uint256 deadline)",
  "event ContributionPaid(bytes32 indexed groupId,address indexed member,uint256 amount)",
  "event BidSubmitted(bytes32 indexed groupId,address indexed member,uint256 bidBps)",
  "event RoundSettled(bytes32 indexed groupId,uint256 round,address indexed winner,uint256 bidAmount,uint256 payout)"
];

async function send(label, txPromise) {
  const tx = await txPromise;
  console.log(label + "_TX=" + tx.hash);
  const receipt = await tx.wait();
  console.log(label + "_BLOCK=" + receipt.blockNumber);
  return receipt;
}

async function main() {
  const network = await provider.getNetwork();
  if (network.chainId !== 97n) throw new Error("Wrong chain: " + network.chainId);

  const balance = await provider.getBalance(owner.address);
  const requiredFunding = MEMBER_GAS_FUND * 3n + OWNER_GAS_RESERVE;
  if (balance < requiredFunding) {
    throw new Error(
      "Insufficient deployer tBNB. Current=" + ethers.formatEther(balance) +
      " required minimum=" + ethers.formatEther(requiredFunding) +
      ". Fund the deployer wallet from the BSC Testnet faucet before rerunning."
    );
  }

  const [appCode, tokenCode] = await Promise.all([
    provider.getCode(CONTRACT),
    provider.getCode(TOKEN)
  ]);
  if (appCode === "0x") throw new Error("BNB_CONTRACT_ADDRESS has no deployed code on BSC Testnet");
  if (tokenCode === "0x") throw new Error("TEST_TOKEN_CONTRACT has no deployed code on BSC Testnet");

  if (!SUBSCRIPTION || !ethers.isAddress(SUBSCRIPTION)) throw new Error("SUBSCRIPTION_CONTRACT_ADDRESS is required for the fresh E2E");
  const token = new ethers.Contract(TOKEN, tokenAbi, owner);
  const app = new ethers.Contract(CONTRACT, appAbi, owner);
  const subscriptions = new ethers.Contract(SUBSCRIPTION, [
    "function paySubscription(bytes32,bytes32,uint256,uint256)",
    "function paid(bytes32) view returns(bool)",
    "function treasury() view returns(address)",
    "function token() view returns(address)",
    "function pause()",
    "function unpause()",
    "function paused() view returns(bool)",
    "event SubscriptionPaid(bytes32 indexed subscriptionKey,bytes32 indexed customerKey,address indexed payer,address token,uint256 amount,uint256 periodStart)"
  ], owner);
  if (!(await app.approvedToken(TOKEN))) {
    throw new Error("Test token is not allowlisted by the deployed Liholiswano contract");
  }

  console.log("CHAIN_ID=97");
  console.log("DEPLOYER=" + owner.address);
  console.log("DEPLOYER_BALANCE_TBNB=" + ethers.formatEther(balance));
  console.log("CONTRACT=" + CONTRACT);
  console.log("TOKEN=" + TOKEN);
  console.log("SUBSCRIPTION=" + SUBSCRIPTION);
  console.log("MEMBER_GAS_FUND_TBNB=" + ethers.formatEther(MEMBER_GAS_FUND));
  console.log("OWNER_GAS_RESERVE_TBNB=" + ethers.formatEther(OWNER_GAS_RESERVE));
  console.log("REQUIRED_MINIMUM_TBNB=" + ethers.formatEther(requiredFunding));

  const members = [
    ethers.Wallet.createRandom().connect(provider),
    ethers.Wallet.createRandom().connect(provider),
    ethers.Wallet.createRandom().connect(provider)
  ];

  for (let i = 0; i < members.length; i++) {
    await send("FUND_MEMBER_" + (i + 1), owner.sendTransaction({
      to: members[i].address,
      value: MEMBER_GAS_FUND
    }));
  }

  const memberTokenAmount = ethers.parseUnits("200", 6);
  for (let i = 0; i < members.length; i++) {
    await send("MINT_MEMBER_" + (i + 1), token.mint(members[i].address, memberTokenAmount));
  }

  const contribution = ethers.parseUnits("100", 6);
  const collateral = ethers.parseUnits("50", 6);
  const winningBidBps = 1500n;
  const maxBidBps = 2000;
  const groupId = ethers.keccak256(ethers.toUtf8Bytes("LIHOLISWANO-TESTNET-" + Date.now()));

  console.log("GROUP_ID=" + groupId);
  console.log("MEMBER_1=" + members[0].address);
  console.log("MEMBER_2=" + members[1].address);
  console.log("MEMBER_3=" + members[2].address);

  await send("CREATE_GROUP", app.createGroup(groupId, TOKEN, contribution, collateral, maxBidBps, 3));

  // Emergency-pause control test. The owner pauses the protocol and a
  // customer financial action must be rejected on-chain. We then unpause
  // and continue the same group through the normal financial lifecycle.
  await send("PAUSE_PROTOCOL", app.pause());
  if (!(await app.paused())) throw new Error("Protocol pause state did not become true");

  let pauseBlocked = false;
  try {
    await app.connect(members[0]).joinGroup(groupId);
  } catch (error) {
    pauseBlocked = true;
    console.log("PAUSE_BLOCKED_ERROR=" + (error.shortMessage || error.message || "reverted"));
  }
  if (!pauseBlocked) throw new Error("Paused protocol accepted a financial join operation");

  await send("UNPAUSE_PROTOCOL", app.unpause());
  if (await app.paused()) throw new Error("Protocol pause state did not clear");
  console.log("PAUSE_E2E=PASS");

  for (let i = 0; i < members.length; i++) {
    const memberToken = token.connect(members[i]);
    await send("APPROVE_MEMBER_" + (i + 1), memberToken.approve(CONTRACT, ethers.MaxUint256));
    await send("JOIN_MEMBER_" + (i + 1), app.connect(members[i]).joinGroup(groupId));
  }

  for (let i = 0; i < members.length; i++) {
    await send("CONTRIBUTE_MEMBER_" + (i + 1), app.connect(members[i]).contribute(groupId));
  }

  await send("BID_MEMBER_1", app.connect(members[0]).submitBid(groupId, 500));
  await send("BID_MEMBER_2", app.connect(members[1]).submitBid(groupId, winningBidBps));
  await send("BID_MEMBER_3", app.connect(members[2]).submitBid(groupId, 1000));

  const before = await token.balanceOf(members[1].address);
  const settlement = await send("SETTLE_ROUND", app.settleRound(groupId));
  const after = await token.balanceOf(members[1].address);
  const payout = after - before;

  const member = await app.getMember(groupId, members[1].address);
  const feeBps = await app.protocolFeeBps();
  const pot = contribution * 3n;
  const bidAmount = pot * winningBidBps / 10000n;
  const fee = bidAmount * feeBps / 10000n;
  const distributable = bidAmount - fee;
  const share = distributable / 2n;
  const remainder = distributable - (share * 2n);
  const expectedPayout = pot - bidAmount + remainder;

  if (payout !== expectedPayout) {
    throw new Error("Unexpected winner payout: actual=" + ethers.formatUnits(payout, 6) + " expected=" + ethers.formatUnits(expectedPayout, 6));
  }
  // Member tuple order: account, active, defaulted, wonThisRotation,
  // contributedThisRound, bidSubmitted, bidBps, totalWins, ...
  if (member[7] !== 1n) {
    throw new Error("Winner totalWins mismatch: " + member[7]);
  }

  console.log("SETTLEMENT_TX=" + settlement.hash);
  console.log("WINNER=" + members[1].address);
  console.log("PAYOUT=" + ethers.formatUnits(payout, 6));
  console.log("EXPECTED_PAYOUT=" + ethers.formatUnits(expectedPayout, 6));
  console.log("PROTOCOL_FEE_BPS=" + feeBps.toString());
  // Subscription vault E2E: a customer explicitly pays the configured test subscription
  // amount to the separate treasury, independent of ROSCA escrow.
  const subscriptionAmount = ethers.parseUnits(process.env.TESTNET_SUBSCRIPTION_AMOUNT || "5", 6);
  const periodStart = BigInt(Math.floor(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1) / 1000));
  const customerKey = ethers.keccak256(ethers.toUtf8Bytes("E2E-CUSTOMER:"+members[0].address));
  const subscriptionKey = ethers.keccak256(ethers.toUtf8Bytes("E2E-SUBSCRIPTION:"+members[0].address+":"+periodStart.toString()));
  const subBefore = await token.balanceOf(owner.address);
  const treasuryBefore = await token.balanceOf(await subscriptions.treasury());
  await send("APPROVE_SUBSCRIPTION", token.connect(members[0]).approve(SUBSCRIPTION, subscriptionAmount));
  await send("PAY_SUBSCRIPTION", subscriptions.connect(members[0]).paySubscription(subscriptionKey,customerKey,periodStart,subscriptionAmount));
  if (!(await subscriptions.paid(subscriptionKey))) throw new Error("Subscription payment was not recorded");
  const treasuryAfter = await token.balanceOf(await subscriptions.treasury());
  if (treasuryAfter - treasuryBefore !== subscriptionAmount) throw new Error("Subscription treasury amount mismatch");
  console.log("SUBSCRIPTION_E2E=PASS");
  console.log("SUBSCRIPTION_AMOUNT="+ethers.formatUnits(subscriptionAmount,6));
  console.log("SUBSCRIPTION_TREASURY="+await subscriptions.treasury());

  await send("PAUSE_SUBSCRIPTIONS", subscriptions.pause());
  if (!(await subscriptions.paused())) throw new Error("Subscription vault pause failed");
  let subBlocked=false;
  try { await subscriptions.connect(members[1]).paySubscription(ethers.keccak256(ethers.toUtf8Bytes("E2E-SECOND")),customerKey,periodStart,subscriptionAmount); }
  catch(e){ subBlocked=true; }
  if(!subBlocked) throw new Error("Paused subscription vault accepted payment");
  await send("UNPAUSE_SUBSCRIPTIONS", subscriptions.unpause());
  if(await subscriptions.paused()) throw new Error("Subscription vault unpause failed");
  console.log("SUBSCRIPTION_PAUSE_E2E=PASS");

  console.log("TESTNET_E2E=PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
