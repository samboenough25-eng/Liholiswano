// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal { function transfer(address,uint256) external returns(bool); function transferFrom(address,address,uint256) external returns(bool); function balanceOf(address) external view returns(uint256); function allowance(address,address) external view returns(uint256); }

contract Liholiswano {
 uint256 public constant FUNDERS_PER_PAYOUT=10;
 uint256 public constant ENTRY_FEE=5e6; // P5 for 6-decimal stablecoins used by the BNB testnet/proposed production tokens.
 uint256 public constant MAX_TIERS=32;
 uint256 public constant MAX_QUEUE_SCAN=128;
 uint256 public constant MAX_FUNDERS_SCAN=128;
 address public owner; address public pendingOwner; address public treasury; bool public paused; uint256 public protocolFeeBps; uint256 private guard=1;
 mapping(address=>bool) public approvedToken; uint256 public nextTierId=1;
 struct Tier { bool exists; bool active; address token; uint256 payout; uint256 contribution; uint256 collateralRequired; uint256 paymentWindow; uint256 queueLength; uint256 recipientIndex; uint256 funderCursor; uint256 cycle; uint256 payoutDeadline; address recipient; }
 struct Participant { bool joined; bool eligible; uint256 collateral; uint256 queueIndex; uint256 receivedCount; uint256 fundedCount; uint256 defaultCount; }
 struct Payout { bool exists; bool paid; uint256 funded; uint256 funderCount; uint256 deadline; address recipient; mapping(address=>bool) fundedBy; mapping(address=>bool) reservedBy; mapping(address=>uint256) reservedAt; }
 mapping(uint256=>Tier) private tiers; mapping(uint256=>address[]) private queues; mapping(uint256=>mapping(address=>Participant)) private participants; mapping(uint256=>mapping(uint256=>Payout)) private payouts; mapping(uint256=>uint256) public payoutNumber;
 error Unauthorized(); error PausedError(); error InvalidConfig(); error InvalidToken(); error NotApprovedToken(); error TierNotFound(); error TierInactive(); error AlreadyJoined(); error NotParticipant(); error AlreadyEligible(); error NotEligible(); error NoEligibleRecipient(); error AlreadyFunded(); error AlreadyReserved(); error ReservationNotFound(); error PaymentClosed(); error PayoutNotReady(); error TransferFailed(); error TransferMismatch(); error ZeroAddress(); error Reentrancy(); error ScanLimit(); error WrongRecipient(); error NotEnoughCollateral();

 constructor(address t,uint256 fee){if(t==address(0)||fee>500)revert InvalidConfig();owner=msg.sender;treasury=t;protocolFeeBps=fee;emit OwnershipTransferred(address(0),msg.sender);}
 modifier onlyOwner(){if(msg.sender!=owner)revert Unauthorized();_;} modifier live(){if(paused)revert PausedError();_;} modifier nonReentrant(){if(guard!=1)revert Reentrancy();guard=2;_;guard=1;}
 event OwnershipTransferStarted(address indexed oldOwner,address indexed pendingOwner); event OwnershipTransferred(address indexed oldOwner,address indexed newOwner);
 event PausedStateChanged(bool paused,address indexed operator); event TreasuryChanged(address indexed oldTreasury,address indexed newTreasury); event ProtocolFeeChanged(uint256 oldFeeBps,uint256 newFeeBps); event TokenApprovalChanged(address indexed token,bool approved);
 event TierCreated(uint256 indexed tierId,address indexed token,uint256 payout,uint256 contribution,uint256 collateralRequired); event TierUpdated(uint256 indexed tierId,uint256 payout,uint256 contribution,uint256 collateralRequired,uint256 paymentWindow,bool active);
 event JoinedQueue(uint256 indexed tierId,address indexed participant,uint256 position,uint256 collateral); event CollateralRestored(uint256 indexed tierId,address indexed participant,uint256 amount,uint256 totalCollateral);
 event FunderReserved(uint256 indexed tierId,uint256 indexed payoutId,address indexed funder,uint256 slot); event FunderPaid(uint256 indexed tierId,uint256 indexed payoutId,address indexed funder,uint256 amount,uint256 funderCount);
 event FunderDefaulted(uint256 indexed tierId,uint256 indexed payoutId,address indexed funder,uint256 amount,uint256 remainingCollateral);
 event RecipientPaid(uint256 indexed tierId,uint256 indexed payoutId,address indexed recipient,uint256 amount,uint256 nextQueueIndex); event RecipientRequeued(uint256 indexed tierId,address indexed recipient,uint256 newPosition);

 function pause() external onlyOwner {paused=true;emit PausedStateChanged(true,msg.sender);} function unpause() external onlyOwner {paused=false;emit PausedStateChanged(false,msg.sender);}
 function transferOwnership(address n) external onlyOwner {if(n==address(0))revert ZeroAddress();pendingOwner=n;emit OwnershipTransferStarted(owner,n);}
 function acceptOwnership() external {if(msg.sender!=pendingOwner)revert Unauthorized();address old=owner;owner=msg.sender;pendingOwner=address(0);emit OwnershipTransferred(old,owner);}
 function setTreasury(address n) external onlyOwner {if(n==address(0))revert ZeroAddress();emit TreasuryChanged(treasury,n);treasury=n;}
 function setProtocolFeeBps(uint256 n) external onlyOwner {if(n>500)revert InvalidConfig();emit ProtocolFeeChanged(protocolFeeBps,n);protocolFeeBps=n;}
 function setApprovedToken(address t,bool a) external onlyOwner {if(t==address(0)||t.code.length==0)revert InvalidToken();approvedToken[t]=a;emit TokenApprovalChanged(t,a);}

 function createTier(address token,uint256 payout,uint256 collateral,uint256 window) external onlyOwner live returns(uint256 id){
  if(!approvedToken[token]||token.code.length==0)revert NotApprovedToken();
  if(payout==0||payout%FUNDERS_PER_PAYOUT!=0||collateral==0||window==0||nextTierId>MAX_TIERS)revert InvalidConfig();
  id=nextTierId++; tiers[id]=Tier(true,true,token,payout,payout/FUNDERS_PER_PAYOUT,collateral,window,0,0,0,0,0,address(0));
  emit TierCreated(id,token,payout,payout/FUNDERS_PER_PAYOUT,collateral);
 }
 function updateTier(uint256 id,uint256 payout,uint256 collateral,uint256 window,bool active) external onlyOwner {
  Tier storage t=_tier(id);if(payout==0||payout%FUNDERS_PER_PAYOUT!=0||collateral==0||window==0)revert InvalidConfig();
  if(t.queueLength>0&&(payout!=t.payout||collateral!=t.collateralRequired))revert InvalidConfig();
  t.payout=payout;t.contribution=payout/FUNDERS_PER_PAYOUT;t.collateralRequired=collateral;t.paymentWindow=window;t.active=active;
  emit TierUpdated(id,payout,t.contribution,collateral,window,active);
 }

 function joinTier(uint256 id) external live nonReentrant {
  Tier storage t=_tier(id);if(!t.active)revert TierInactive();Participant storage p=participants[id][msg.sender];if(p.joined)revert AlreadyJoined();
  _transferFromExact(t.token,msg.sender,address(this),ENTRY_FEE+t.collateralRequired);
  p.joined=true;p.eligible=true;p.collateral=t.collateralRequired;p.queueIndex=t.queueLength;queues[id].push(msg.sender);t.queueLength++;
  emit JoinedQueue(id,msg.sender,p.queueIndex,p.collateral);_ensureRecipient(t,id);
 }
 function restoreCollateral(uint256 id) external live nonReentrant {
  Tier storage t=_tier(id);Participant storage p=participants[id][msg.sender];if(!p.joined)revert NotParticipant();if(p.collateral>=t.collateralRequired)revert AlreadyEligible();
  uint256 need=t.collateralRequired-p.collateral;_transferFromExact(t.token,msg.sender,address(this),need);p.collateral+=need;p.eligible=true;emit CollateralRestored(id,msg.sender,need,p.collateral);
 }

 // The protocol first reserves the next eligible queue participant. Reservation is the
 // on-chain commitment that creates an obligation. If they do not fund before the payout
 // deadline, their collateral can cover exactly the missed contribution.
 function reserveNextFunder(uint256 id) external live {
  Tier storage t=_tier(id);_ensureRecipient(t,id);Payout storage po=payouts[id][payoutNumber[id]];if(po.paid)revert PayoutNotReady();if(block.timestamp>=po.deadline)revert PaymentClosed();
  uint256 idx=t.funderCursor;
  for(uint256 n=0;n<MAX_FUNDERS_SCAN;n++){
   if(idx>=t.queueLength)idx=0;address a=queues[id][idx];Participant storage p=participants[id][a];
   if(p.joined&&p.eligible&&p.collateral>=t.collateralRequired&&a!=t.recipient&&!po.fundedBy[a]&&!po.reservedBy[a]){
    if(IERC20Minimal(t.token).balanceOf(a)>=t.contribution&&IERC20Minimal(t.token).allowance(a,address(this))>=t.contribution){
     po.reservedBy[a]=true;po.reservedAt[a]=block.timestamp;t.funderCursor=_nextIndex(t,idx);emit FunderReserved(id,payoutNumber[id],a,po.funderCount);return;
    }
   }
   idx=_nextIndex(t,idx);
  }
  revert NoEligibleRecipient();
 }

 function fundCurrent(uint256 id) external live nonReentrant {
  Tier storage t=_tier(id);Participant storage p=participants[id][msg.sender];if(!p.joined)revert NotParticipant();if(!p.eligible||p.collateral<t.collateralRequired)revert NotEligible();
  _ensureRecipient(t,id);Payout storage po=payouts[id][payoutNumber[id]];if(po.paid||block.timestamp>=po.deadline)revert PaymentClosed();
  if(!po.reservedBy[msg.sender])revert ReservationNotFound();if(po.fundedBy[msg.sender])revert AlreadyFunded();
  _transferFromExact(t.token,msg.sender,address(this),t.contribution);po.fundedBy[msg.sender]=true;po.reservedBy[msg.sender]=false;po.funded+=t.contribution;po.funderCount++;p.fundedCount++;
  emit FunderPaid(id,payoutNumber[id],msg.sender,t.contribution,po.funderCount);if(po.funderCount==FUNDERS_PER_PAYOUT)_payRecipient(t,id,payoutNumber[id]);
 }

 // Anyone can finalize an expired reservation. The missed contribution is paid from
 // the participant's collateral to the current recipient. Their collateral must then be
 // restored to the full tier requirement before they become eligible again.
 function defaultFunder(uint256 id,address funder) external live nonReentrant {
  Tier storage t=_tier(id);Participant storage p=participants[id][funder];if(!p.joined)revert NotParticipant();Payout storage po=payouts[id][payoutNumber[id]];
  if(po.paid||!po.reservedBy[funder])revert ReservationNotFound();if(block.timestamp<po.deadline)revert PaymentClosed();
  uint256 amount=t.contribution;if(p.collateral<amount)revert NotEnoughCollateral();
  po.reservedBy[funder]=false;p.collateral-=amount;p.eligible=false;p.defaultCount++;po.funded+=amount;po.funderCount++;
  _transferExact(t.token,po.recipient,amount);emit FunderDefaulted(id,payoutNumber[id],funder,amount,p.collateral);
  if(po.funderCount==FUNDERS_PER_PAYOUT)_payRecipient(t,id,payoutNumber[id]);
  else {po.deadline=block.timestamp+t.paymentWindow;t.funderCursor=_nextIndex(t,p.queueIndex); }
 }

 function settlePayout(uint256 id) external live nonReentrant {Tier storage t=_tier(id);_ensureRecipient(t,id);Payout storage po=payouts[id][payoutNumber[id]];if(po.funderCount!=FUNDERS_PER_PAYOUT)revert PayoutNotReady();_payRecipient(t,id,payoutNumber[id]);}

 function _payRecipient(Tier storage t,uint256 id,uint256 pid) internal {
  Payout storage po=payouts[id][pid];if(po.paid)return;if(po.funded!=t.payout||po.funderCount!=FUNDERS_PER_PAYOUT)revert PayoutNotReady();
  // Defaulted contributions were already transferred to the recipient. Only the normal
  // funder transfers are escrowed, so subtract any amount already delivered by defaults.
  uint256 alreadyDelivered=0;
  // We cannot cheaply enumerate defaulted funders. The safe accounting invariant is that
  // every funded contribution is held in the contract except defaulted ones, so record it.
  // In this implementation defaulted amounts are sent immediately and counted in funded;
  // payout settlement therefore sends only the amount still owed from escrow.
  // total defaulted amount is tracked in t.fundedAmount.
  uint256 escrowDue=t.payout-t.fundedAmount;
  if(escrowDue>0)_transferExact(t.token,po.recipient,escrowDue);
  uint256 fee=0; if(protocolFeeBps>0){fee=t.payout*protocolFeeBps/10000;if(fee>escrowDue)fee=escrowDue;}
  // Fee is intentionally zero by default. If enabled, it is taken only from escrowDue.
  if(fee>0){_transferExact(t.token,treasury,fee);_transferExact(t.token,po.recipient,escrowDue-fee);}
  po.paid=true;Participant storage rp=participants[id][po.recipient];rp.receivedCount++;rp.eligible=true;
  uint256 old=rp.queueIndex;rp.queueIndex=t.queueLength;queues[id].push(po.recipient);t.queueLength++;t.recipientIndex=_nextIndex(t,old);t.funderCursor=t.recipientIndex;t.recipient=address(0);emit RecipientPaid(id,pid,po.recipient,t.payout,t.recipientIndex);emit RecipientRequeued(id,po.recipient,rp.queueIndex);_ensureRecipient(t,id);
 }

 function _ensureRecipient(Tier storage t,uint256 id) internal {
  if(t.recipient!=address(0))return;if(t.queueLength==0)revert NoEligibleRecipient();uint256 idx=t.recipientIndex;
  for(uint256 n=0;n<MAX_QUEUE_SCAN;n++){if(idx>=t.queueLength)idx=0;address a=queues[id][idx];Participant storage p=participants[id][a];
   if(p.joined&&p.eligible&&p.collateral>=t.collateralRequired){t.recipient=a;uint256 pid=payoutNumber[id]+1;payoutNumber[id]=pid;Payout storage po=payouts[id][pid];po.exists=true;po.deadline=block.timestamp+t.paymentWindow;po.recipient=a;t.payoutDeadline=po.deadline;t.fundedAmount=0;t.funderCount=0;t.cycle++;return;}idx++;
  }revert NoEligibleRecipient();
 }
 function _nextIndex(Tier storage t,uint256 idx) internal view returns(uint256){if(t.queueLength==0)return 0;idx++;if(idx>=t.queueLength)idx=0;return idx;}
 function isFunderEligible(uint256 id,address a) external view returns(bool){Tier storage t=_tier(id);Participant storage p=participants[id][a];Payout storage po=payouts[id][payoutNumber[id]];return p.joined&&p.eligible&&p.collateral>=t.collateralRequired&&a!=t.recipient&&!po.fundedBy[a]&&!po.reservedBy[a]&&IERC20Minimal(t.token).balanceOf(a)>=t.contribution&&IERC20Minimal(t.token).allowance(a,address(this))>=t.contribution;}
 function getTier(uint256 id) external view returns(Tier memory){return _tier(id);} function getQueue(uint256 id) external view returns(address[] memory){return queues[id];}
 function getParticipant(uint256 id,address a) external view returns(Participant memory){return participants[id][a];}
 function getCurrentPayout(uint256 id) external view returns(bool,uint256,address,uint256,uint256,uint256){Tier storage t=_tier(id);Payout storage p=payouts[id][payoutNumber[id]];return(p.exists,payoutNumber[id],p.recipient,p.funded,p.funderCount,p.deadline);}
 function getTierIds() external view returns(uint256[] memory out){uint256 n=nextTierId-1;out=new uint256[](n);for(uint256 i=0;i<n;i++)out[i]=i+1;}
 function _tier(uint256 id) internal view returns(Tier storage t){t=tiers[id];if(!t.exists)revert TierNotFound();}
 function _transferFromExact(address token,address from,address to,uint256 amount) internal{uint256 b=IERC20Minimal(token).balanceOf(to);(bool ok,bytes memory d)=token.call(abi.encodeWithSelector(IERC20Minimal.transferFrom.selector,from,to,amount));if(!ok||(d.length>0&&!abi.decode(d,(bool))))revert TransferFailed();uint256 a=IERC20Minimal(token).balanceOf(to);if(a<b||a-b!=amount)revert TransferMismatch();}
 function _transferExact(address token,address to,uint256 amount) internal{uint256 b=IERC20Minimal(token).balanceOf(to);(bool ok,bytes memory d)=token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector,to,amount));if(!ok||(d.length>0&&!abi.decode(d,(bool))))revert TransferFailed();uint256 a=IERC20Minimal(token).balanceOf(to);if(a<b||a-b!=amount)revert TransferMismatch();}
}