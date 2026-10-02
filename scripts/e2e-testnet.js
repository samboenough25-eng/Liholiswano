// BNB Testnet controlled E2E: test wallets + MockUSDT only.
// This script never uses real USDT/USDC and must only run on BSC Testnet.
const { ethers } = require("ethers");

const RPC = process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet.bnbchain.org";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const CONTRACT = process.env.BNB_CONTRACT_ADDRESS || "0xe9b104260c940fAE26a73e4E9c952fD18fFd2014";
const TOKEN = process.env.TEST_TOKEN_CONTRACT || "0xb516a4a0ec39e3CBa5baDAE5524E05F43EB66C29";
// Keep the E2E gas budget deliberately small. BSC Testnet gas is inexpensive;
// the test only needs enough tBNB for each temporary member's transactions.
const MEMBER_GAS_FUND = ethers.parseEther(process.env.TESTNET_MEMBER_GAS_FUND || "0.00005");
const OWNER_GAS_RESERVE = ethers.parseEther(process.env.TESTNET_OWNER_GAS_RESERVE || "0.00005");

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
  "function approvedToken(address) view returns (bool)",
  "function getMember(bytes32,address) view returns (address,bool,bool,bool,bool,bool,uint256,uint256,uint256,uint256)",
  "function protocolFeeBps() view returns (uint256)",
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

  const token = new ethers.Contract(TOKEN, tokenAbi, owner);
  const app = new ethers.Contract(CONTRACT, appAbi, owner);
  if (!(await app.approvedToken(TOKEN))) {
    throw new Error("Test token is not allowlisted by the deployed Liholiswano contract");
  }

  console.log("CHAIN_ID=97");
  console.log("DEPLOYER=" + owner.address);
  console.log("DEPLOYER_BALANCE_TBNB=" + ethers.formatEther(balance));
  console.log("CONTRACT=" + CONTRACT);
  console.log("TOKEN=" + TOKEN);
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
  console.log("TESTNET_E2E=PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
