const {JsonRpcProvider,Contract,Wallet}=require("ethers");
const {assertAddress}=require("./wallet");
const DEFAULT_RPC="https://bsc-testnet-dataseed.bnbchain.org";
const RPC=()=>process.env.BSC_TESTNET_RPC_URL||DEFAULT_RPC;
const PROTOCOL_ABI=[
 "event GroupCreated(bytes32 indexed groupId,address indexed admin,address indexed token)",
 "event MemberJoined(bytes32 indexed groupId,address indexed member)",
 "event GroupLockedEvent(bytes32 indexed groupId,uint256 round,uint256 deadline)",
 "event ContributionPaid(bytes32 indexed groupId,address indexed member,uint256 amount)",
 "event BidSubmitted(bytes32 indexed groupId,address indexed member,uint256 bidBps)",
 "event RoundSettled(bytes32 indexed groupId,uint256 round,address indexed winner,uint256 bidAmount,uint256 payout)",
 "event MemberDefaulted(bytes32 indexed groupId,address indexed member,uint256 collateral,uint256 uncovered)",
 "function getGroupIds() view returns (bytes32[])",
 "function getGroup(bytes32) view returns (bool,bool,address,address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
 "function getMember(bytes32,address) view returns (address,bool,bool,bool,bool,bool,uint256,uint32,uint256,uint256)",
 "function joinGroup(bytes32)",
 "function contribute(bytes32)",
 "function submitBid(bytes32,uint256)",
 "function settleRound(bytes32)"
];
function provider(){return new JsonRpcProvider(RPC());}
function contract(address,abi=PROTOCOL_ABI){assertAddress(address);return new Contract(address,abi,provider());}
function signer(){if(!process.env.DEPLOYER_PRIVATE_KEY)throw new Error("DEPLOYER_PRIVATE_KEY is not configured");return new Wallet(process.env.DEPLOYER_PRIVATE_KEY,provider());}
function writableContract(address,abi=PROTOCOL_ABI){assertAddress(address);return new Contract(address,abi,signer());}
async function chainInfo(){const p=provider();const n=await p.getNetwork();return {chainId:Number(n.chainId),blockNumber:await p.getBlockNumber()};}
async function groupState(address,id){const g=await contract(address).getGroup(id);return {exists:g[0],locked:g[1],admin:g[2],token:g[3],contribution:g[4].toString(),collateral:g[5].toString(),maxMembers:Number(g[6]),maxBidBps:Number(g[7]),round:Number(g[8]),rotation:Number(g[9]),reserve:g[10].toString(),uncoveredShortfall:g[11].toString(),roundDeadline:Number(g[12]),escrowBalance:g[13].toString(),memberCount:Number(g[14])};}
async function memberState(address,id,wallet){const m=await contract(address).getMember(id,wallet);return {account:m[0],active:m[1],defaulted:m[2],wonThisRotation:m[3],contributedThisRound:m[4],bidSubmitted:m[5],bidBps:Number(m[6]),totalWins:Number(m[7]),totalContributed:m[8].toString(),totalReceived:m[9].toString()};}
module.exports={provider,contract,writableContract,signer,chainInfo,groupState,memberState,PROTOCOL_ABI};