const { JsonRpcProvider, Contract, Wallet, getAddress } = require("ethers");
const { assertAddress } = require("./wallet");

const DEFAULT_TESTNET_RPC="https://bsc-testnet-dataseed.bnbchain.org";
function rpcUrl(){
  const url=process.env.BSC_RPC_URL||process.env.BSC_TESTNET_RPC_URL||DEFAULT_TESTNET_RPC;
  if(process.env.REQUIRE_DEDICATED_RPC==="true"&&!process.env.BSC_RPC_URL) throw new Error("A dedicated BSC_RPC_URL is required for production blockchain operations");
  return url;
}

const PROTOCOL_ABI=[
 "event RoundCreated(uint256 indexed tierId,uint256 indexed roundId,uint256 activatedAt,uint256 deadline)",
 "event RoundMemberAdded(uint256 indexed tierId,uint256 indexed roundId,uint8 indexed memberIndex,address member)",
 "event RoundActivated(uint256 indexed tierId,uint256 indexed roundId)",
 "event PayoutPositionCreated(uint256 indexed tierId,uint256 indexed roundId,uint8 indexed recipientIndex,address recipient,uint256 payout)",
 "event ObligationCreated(uint256 indexed tierId,uint256 indexed roundId,uint8 indexed recipientIndex,uint8 funderIndex,address funder,uint256 amount,uint256 dueAt)",
 "event ObligationPaid(uint256 indexed tierId,uint256 indexed roundId,uint8 indexed recipientIndex,uint8 funderIndex,address funder,uint256 amount)",
 "event ObligationCollateralCovered(uint256 indexed tierId,uint256 indexed roundId,uint8 indexed recipientIndex,uint8 funderIndex,address funder,uint256 amount)",
 "event ObligationBlocked(uint256 indexed tierId,uint256 indexed roundId,uint8 indexed recipientIndex,uint8 funderIndex,address funder,uint256 amount)",
 "event PayoutSettled(uint256 indexed tierId,uint256 indexed roundId,uint8 indexed recipientIndex,address recipient,uint256 amount)",
 "event ParticipantDefaulted(uint256 indexed tierId,uint256 indexed roundId,address indexed participant,uint256 amount,uint256 defaultCount,uint256 remainingCollateral)",
 "event CollateralRestored(uint256 indexed tierId,address indexed participant,uint256 amount,uint256 totalCollateral)",
 "event RoundCompleted(uint256 indexed tierId,uint256 indexed roundId)",
 "event CollateralWithdrawn(uint256 indexed tierId,uint256 indexed roundId,address indexed participant,uint256 amount)",
 "event NextRoundOptIn(uint256 indexed tierId,uint256 indexed completedRound,address indexed participant)",
 "function owner() view returns(address)",
 "function paused() view returns(bool)",
 "function treasury() view returns(address)",
 "function approvedToken(address) view returns(bool)",
 "function latestRoundId(uint256) view returns(uint256)",
 "function getTier(uint256) view returns(bool,bool,address,uint256,uint256,uint256,uint256,uint256)",
 "function getWaitingList(uint256) view returns(address[])",
 "function getParticipant(uint256,address) view returns(bool,bool,uint256,uint256,uint256,uint256,uint256,uint256)",
 "function getRound(uint256,uint256) view returns(bool,bool,bool,uint256,uint256,address,uint256,uint256,uint256,uint256,uint256,uint256,uint8,uint8,address[11])",
 "function getPosition(uint256,uint256,uint8) view returns(address,uint256,uint8,bool)",
 "function getObligation(uint256,uint256,uint8,uint8) view returns(address,uint256,uint256,uint8)",
 "function getObligationStatus(uint256,uint256,uint8,uint8) view returns(uint8)",
 "function payObligation(uint256,uint256,uint8,uint8)",
 "function processExpiredObligation(uint256,uint256,uint8,uint8)",
 "function restoreAndResolveBlockedObligation(uint256,uint256,uint8,uint8)",
 "function settlePayout(uint256,uint256,uint8)"
];

function provider(){ return new JsonRpcProvider(rpcUrl()); }
function contract(address,abi=PROTOCOL_ABI){ assertAddress(address); return new Contract(address,abi,provider()); }
function signer(){ if(!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY is not configured"); return new Wallet(process.env.DEPLOYER_PRIVATE_KEY,provider()); }
function writableContract(address,abi=PROTOCOL_ABI){ assertAddress(address); return new Contract(address,abi,signer()); }

async function chainInfo(){
  const p=provider(), n=await p.getNetwork();
  return {chainId:Number(n.chainId),blockNumber:await p.getBlockNumber()};
}
async function tierState(address,id){
  const t=await contract(address).getTier(id);
  return {exists:t[0],active:t[1],token:getAddress(t[2]),payout:t[3].toString(),contribution:t[4].toString(),collateralRequired:t[5].toString(),targetWindow:Number(t[6]),maxWindow:Number(t[7])};
}
async function participantState(address,id,wallet){
  const p=await contract(address).getParticipant(id,wallet);
  return {joined:p[0],waiting:p[1],collateral:p[2].toString(),defaultCount:Number(p[3]),suspendedThroughRound:Number(p[4]),activeRound:Number(p[5]),receivedInActiveRound:p[6],resolvedObligationsInActiveRound:Number(p[7])};
}
async function roundState(address,tierId,roundId){
  const r=await contract(address).getRound(tierId,roundId);
  return {exists:r[0],active:r[1],complete:r[2],tierId:Number(r[3]),id:Number(r[4]),token:getAddress(r[5]),payout:r[6].toString(),contribution:r[7].toString(),collateralRequired:r[8].toString(),targetWindow:Number(r[9]),maxWindow:Number(r[10]),activatedAt:Number(r[11]),deadline:Number(r[12]),settledPositions:Number(r[13]),resolvedObligations:Number(r[14]),members:r[15].map(getAddress)};
}
module.exports={provider,contract,writableContract,signer,chainInfo,tierState,participantState,roundState,PROTOCOL_ABI,rpcUrl};
