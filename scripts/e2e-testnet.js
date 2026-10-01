// BNB Testnet controlled E2E: this script uses test wallets and MockUSDT only.\nconst { ethers } = require("ethers");

const RPC = process.env.BSC_TESTNET_RPC_URL || "https://bsc-testnet.bnbchain.org";
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const CONTRACT = process.env.BNB_CONTRACT_ADDRESS || "0xe9b104260c940fAE26a73e4E9c952fD18fFd2014";
const TOKEN = process.env.TEST_TOKEN_CONTRACT || "0xb516a4a0ec39e3CBa5baDAE5524E05F43EB66C29";

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
  if (balance === 0n) throw new Error("Deployer has no tBNB");

  const token = new ethers.Contract(TOKEN, tokenAbi, owner);
  const app = new ethers.Contract(CONTRACT, appAbi, owner);

  const members = [
    ethers.Wallet.createRandom().connect(provider),
    ethers.Wallet.createRandom().connect(provider),
    ethers.Wallet.createRandom().connect(provider)
  ];

  const gasFund = ethers.parseEther("0.01");
  for (let i = 0; i < members.length; i++) {
    await send("FUND_MEMBER_" + (i + 1), owner.sendTransaction({to: members[i].address, value: gasFund}));
  }

  const memberTokenAmount = ethers.parseUnits("200", 6);
  for (let i = 0; i < members.length; i++) {
    await send("MINT_MEMBER_" + (i + 1), token.mint(members[i].address, memberTokenAmount));
  }

  const contribution = ethers.parseUnits("100", 6);
  const collateral = ethers.parseUnits("50", 6);
  const maxBidBps = 2000;
  const groupId = ethers.keccak256(ethers.toUtf8Bytes("LIHOLISWANO-TESTNET-" + Date.now()));

  console.log("GROUP_ID=" + groupId);
  console.log("CONTRACT=" + CONTRACT);
  console.log("TOKEN=" + TOKEN);
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
  await send("BID_MEMBER_2", app.connect(members[1]).submitBid(groupId, 1500));
  await send("BID_MEMBER_3", app.connect(members[2]).submitBid(groupId, 1000));

  const before = await token.balanceOf(members[1].address);
  const settlement = await send("SETTLE_ROUND", app.settleRound(groupId));
  const after = await token.balanceOf(members[1].address);
  const payout = after - before;

  const member = await app.getMember(groupId, members[1].address);
  const feeBps = await app.protocolFeeBps();
  const expectedPayout = ethers.parseUnits("255", 6);

  if (payout !== expectedPayout) throw new Error("Unexpected winner payout: " + ethers.formatUnits(payout, 6));
  if (member[6] !== 1n) throw new Error("Winner totalWins mismatch: " + member[6]);

  console.log("SETTLEMENT_TX=" + settlement.hash);
  console.log("WINNER=" + members[1].address);
  console.log("PAYOUT=" + ethers.formatUnits(payout, 6));
  console.log("EXPECTED_PAYOUT=255.000000");
  console.log("PROTOCOL_FEE_BPS=" + feeBps.toString());
  console.log("TESTNET_E2E=PASS");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
