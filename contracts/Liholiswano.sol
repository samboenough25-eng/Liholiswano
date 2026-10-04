// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
 function transfer(address,uint256) external returns(bool);
 function transferFrom(address,address,uint256) external returns(bool);
 function balanceOf(address) external view returns(uint256);
 function allowance(address,address) external view returns(uint256);
}

contract Liholiswano {
 uint256 public constant FUNDERS_PER_PAYOUT=10;
 uint256 public constant ENTRY_FEE=5e6; // P5 with 6-decimal test/production stablecoin configuration.
 uint256 public constant MAX_TIERS=32;
 uint256 public constant MAX_QUEUE_SCAN=2048;

 address public owner;
 address public pendingOwner;
 address public treasury;
 bool public paused;
 uint256 public protocolFeeBps;
 uint256 private guard=1;
 uint256 public nextTierId=1;
 mapping(address=>bool) public approvedToken;

 struct Tier {
  bool exists;
  bool active;
  address token;
  uint256 payout;
  uint256 contribution;
  uint256 collateralRequired;
  uint256 paymentWindow;
  uint256 queueSize;
  uint256 cycle;
  address head;
  address tail;
  address recipient;
 }
 struct Participant {
  bool joined;
  bool eligible;
  uint256 collateral;
  uint256 receivedCount;
  uint256 fundedCount;
  uint256 defaultCount;
 }
 struct Payout {
  bool exists;
  bool paid;
  uint256 funded;
  uint256 defaultedAmount;
  uint256 funderCount;
  uint256 deadline;
  address recipient;
  address currentFunder;
 }
 mapping(uint256=>Tier) private tiers;
 mapping(uint256=>mapping(address=>Participant)) private participants;
 mapping(uint256=>mapping(address=>address)) private nextParticipant;
 mapping(uint256=>mapping(uint256=>Payout)) private payouts;
 mapping(uint256=>uint256) public payoutNumber;

 error Unauthorized();
 error PausedError();
 error InvalidConfig();
 error InvalidToken();
 error NotApprovedToken();
 error TierNotFound();
 error TierInactive();
 error AlreadyJoined();
 error NotParticipant();
 error AlreadyEligible();
 error NotEligible();
 error NoEligibleRecipient();
 error AlreadyFunded();
 error PaymentClosed();
 error PayoutNotReady();
 error TransferFailed();
 error TransferMismatch();
 error ZeroAddress();
 error Reentrancy();
 error NotCurrentFunder();
 error NoEligibleFunder();
 error DeadlineNotReached();
 error InsufficientCollateral();

 constructor(address t,uint256 fee) {
  if(t==address(0)||fee!=0) revert InvalidConfig();
  owner=msg.sender; treasury=t; protocolFeeBps=fee;
  emit OwnershipTransferred(address(0),msg.sender);
 }
 modifier onlyOwner(){if(msg.sender!=owner)revert Unauthorized();_; }
 modifier live(){if(paused)revert PausedError();_; }
 modifier nonReentrant(){if(guard!=1)revert Reentrancy();guard=2;_;guard=1;}

 event OwnershipTransferStarted(address indexed oldOwner,address indexed pendingOwner);
 event OwnershipTransferred(address indexed oldOwner,address indexed newOwner);
 event PausedStateChanged(bool paused,address indexed operator);
 event TreasuryChanged(address indexed oldTreasury,address indexed newTreasury);
 event ProtocolFeeChanged(uint256 oldFeeBps,uint256 newFeeBps);
 event TokenApprovalChanged(address indexed token,bool approved);
 event TierCreated(uint256 indexed tierId,address indexed token,uint256 payout,uint256 contribution,uint256 collateralRequired);
 event TierUpdated(uint256 indexed tierId,uint256 payout,uint256 contribution,uint256 collateralRequired,uint256 paymentWindow,bool active);
 event JoinedQueue(uint256 indexed tierId,address indexed participant,uint256 position,uint256 collateral);
 event CollateralRestored(uint256 indexed tierId,address indexed participant,uint256 amount,uint256 totalCollateral);
 event FunderAssigned(uint256 indexed tierId,uint256 indexed payoutId,address indexed funder,uint256 deadline);
 event FunderPaid(uint256 indexed tierId,uint256 indexed payoutId,address indexed funder,uint256 amount,uint256 funderCount);
 event FunderDefaulted(uint256 indexed tierId,uint256 indexed payoutId,address indexed funder,uint256 amount,uint256 remainingCollateral);
 event RecipientPaid(uint256 indexed tierId,uint256 indexed payoutId,address indexed recipient,uint256 amount);
 event RecipientRequeued(uint256 indexed tierId,address indexed recipient);
 
 function pause() external onlyOwner {paused=true;emit PausedStateChanged(true,msg.sender);}
 function unpause() external onlyOwner {paused=false;emit PausedStateChanged(false,msg.sender);}
 function transferOwnership(address n) external onlyOwner {if(n==address(0))revert ZeroAddress();pendingOwner=n;emit OwnershipTransferStarted(owner,n);}
 function acceptOwnership() external {if(msg.sender!=pendingOwner)revert Unauthorized();address old=owner;owner=msg.sender;pendingOwner=address(0);emit OwnershipTransferred(old,owner);}
 function setTreasury(address n) external onlyOwner {if(n==address(0))revert ZeroAddress();emit TreasuryChanged(treasury,n);treasury=n;}
 function setProtocolFeeBps(uint256 n) external onlyOwner {if(n>500)revert InvalidConfig();emit ProtocolFeeChanged(protocolFeeBps,n);protocolFeeBps=n;}
 function setApprovedToken(address t,bool a) external onlyOwner {if(t==address(0)||t.code.length==0)revert InvalidToken();approvedToken[t]=a;emit TokenApprovalChanged(t,a);}

 function createTier(address token,uint256 payout,uint256 collateral,uint256 window) external onlyOwner live returns(uint256 id){
  if(!approvedToken[token]||token.code.length==0)revert NotApprovedToken();
  uint256 contribution=payout/FUNDERS_PER_PAYOUT;
  if(payout==0||payout%FUNDERS_PER_PAYOUT!=0||collateral<contribution||window==0||nextTierId>MAX_TIERS)revert InvalidConfig();
  id=nextTierId++;
  tiers[id]=Tier(true,true,token,payout,contribution,collateral,window,0,0,address(0),address(0),address(0));
  emit TierCreated(id,token,payout,contribution,collateral);
 }

 function updateTier(uint256 id,uint256 payout,uint256 collateral,uint256 window,bool active) external onlyOwner {
  Tier storage t=_tier(id); uint256 contribution=payout/FUNDERS_PER_PAYOUT;
  if(payout==0||payout%FUNDERS_PER_PAYOUT!=0||collateral<contribution||window==0)revert InvalidConfig();
  if(t.queueSize>0&&(payout!=t.payout||collateral!=t.collateralRequired))revert InvalidConfig();
  t.payout=payout;t.contribution=contribution;t.collateralRequired=collateral;t.paymentWindow=window;t.active=active;
  emit TierUpdated(id,payout,contribution,collateral,window,active);
 }

 function joinTier(uint256 id) external live nonReentrant {
  Tier storage t=_tier(id); if(!t.active)revert TierInactive();
  Participant storage p=participants[id][msg.sender]; if(p.joined)revert AlreadyJoined();
  _transferFromExact(t.token,msg.sender,address(this),ENTRY_FEE+t.collateralRequired);
  p.joined=true;p.eligible=true;p.collateral=t.collateralRequired;
  _append(t,id,msg.sender);emit JoinedQueue(id,msg.sender,t.queueSize-1,p.collateral);
  _ensureRecipient(t,id);_ensureFunder(t,id);
 }

 function restoreCollateral(uint256 id) external live nonReentrant {
  Tier storage t=_tier(id);Participant storage p=participants[id][msg.sender];
  if(!p.joined)revert NotParticipant();if(p.collateral>=t.collateralRequired)revert AlreadyEligible();
  uint256 need=t.collateralRequired-p.collateral;
  _transferFromExact(t.token,msg.sender,address(this),need);
  p.collateral+=need;p.eligible=true;emit CollateralRestored(id,msg.sender,need,p.collateral);
  _ensureRecipient(t,id);_ensureFunder(t,id);
 }

 // Anyone can call this permissionlessly. The contract itself chooses the next eligible
 // queue participant. A participant is only penalized after the contract has assigned them
 // the contribution obligation and their payment window expires.
 function refreshFunder(uint256 id) external live {
  Tier storage t=_tier(id);_ensureRecipient(t,id);_ensureFunder(t,id);
 }

 function fundCurrent(uint256 id) external live nonReentrant {
  Tier storage t=_tier(id);_ensureRecipient(t,id);_ensureFunder(t,id);
  Payout storage po=payouts[id][payoutNumber[id]];
  if(po.paid||po.currentFunder==address(0))revert NoEligibleFunder();
  if(block.timestamp>=po.deadline)revert PaymentClosed();
  if(msg.sender!=po.currentFunder)revert NotCurrentFunder();
  _transferFromExact(t.token,msg.sender,address(this),t.contribution);
  po.currentFunder=address(0);po.funded+=t.contribution;po.funderCount++;
  participants[id][msg.sender].fundedCount++;
  emit FunderPaid(id,payoutNumber[id],msg.sender,t.contribution,po.funderCount);
  if(po.funderCount==FUNDERS_PER_PAYOUT)_payRecipient(t,id);
  else _ensureFunder(t,id);
 }

 // The assigned funder failed to pay within the window. Their collateral pays exactly one
 // missed contribution, then their remaining collateral is below the tier requirement and
 // they become ineligible until they restore it.
 function defaultCurrentFunder(uint256 id) external live nonReentrant {
  Tier storage t=_tier(id);_ensureRecipient(t,id);Payout storage po=payouts[id][payoutNumber[id]];
  address funder=po.currentFunder;
  if(funder==address(0))revert NoEligibleFunder();
  if(block.timestamp<po.deadline)revert DeadlineNotReached();
  Participant storage p=participants[id][funder];if(p.collateral<t.contribution)revert InsufficientCollateral();
  po.currentFunder=address(0);p.collateral-=t.contribution;p.eligible=false;p.defaultCount++;
  po.funded+=t.contribution;po.defaultedAmount+=t.contribution;po.funderCount++;
  _transferExact(t.token,po.recipient,t.contribution);
  emit FunderDefaulted(id,payoutNumber[id],funder,t.contribution,p.collateral);
  if(po.funderCount==FUNDERS_PER_PAYOUT)_payRecipient(t,id);
  else _ensureFunder(t,id);
 }

 function settlePayout(uint256 id) external live nonReentrant {
  Tier storage t=_tier(id);_ensureRecipient(t,id);Payout storage po=payouts[id][payoutNumber[id]];
  if(po.funderCount!=FUNDERS_PER_PAYOUT)revert PayoutNotReady();_payRecipient(t,id);
 }

 function _payRecipient(Tier storage t,uint256 id) internal {
  Payout storage po=payouts[id][payoutNumber[id]];if(po.paid)return;
  if(po.funded!=t.payout||po.funderCount!=FUNDERS_PER_PAYOUT)revert PayoutNotReady();
  uint256 escrowDue=t.payout-po.defaultedAmount;if(escrowDue>0)_transferExact(t.token,po.recipient,escrowDue);
  po.paid=true;address recipient=po.recipient;participants[id][recipient].receivedCount++;
  _moveHeadToTail(t,id,recipient);
  emit RecipientPaid(id,payoutNumber[id],recipient,t.payout);emit RecipientRequeued(id,recipient);
  t.recipient=address(0);_ensureRecipient(t,id);_ensureFunder(t,id);
 }

 function _ensureRecipient(Tier storage t,uint256 id) internal {
  if(t.recipient!=address(0))return;
  address candidate=t.head;if(candidate==address(0))revert NoEligibleRecipient();
  for(uint256 i=0;i<MAX_QUEUE_SCAN;i++){
   if(candidate==address(0))revert NoEligibleRecipient();
   Participant storage p=participants[id][candidate];
   if(p.joined&&p.eligible&&p.collateral>=t.collateralRequired){
    t.recipient=candidate;uint256 pid=payoutNumber[id]+1;payoutNumber[id]=pid;
    Payout storage po=payouts[id][pid];po.exists=true;po.recipient=candidate;po.deadline=0;po.currentFunder=address(0);
    t.cycle++;return;
   }
   address next=nextParticipant[id][candidate];
   _moveHeadToTail(t,id,candidate);candidate=next;
  }
  revert NoEligibleRecipient();
 }

 function _ensureFunder(Tier storage t,uint256 id) internal {
  Payout storage po=payouts[id][payoutNumber[id]];
  if(!po.exists||po.paid||po.funderCount>=FUNDERS_PER_PAYOUT||po.currentFunder!=address(0))return;
  address candidate=nextParticipant[id][t.head]; // start at queue head
  if(candidate==address(0))revert NoEligibleFunder();
  for(uint256 i=0;i<MAX_QUEUE_SCAN;i++){
   if(candidate==address(0))candidate=t.head;
   if(candidate!=po.recipient){
    Participant storage p=participants[id][candidate];
    if(p.joined&&p.eligible&&p.collateral>=t.collateralRequired&&IERC20Minimal(t.token).balanceOf(candidate)>=t.contribution&&IERC20Minimal(t.token).allowance(candidate,address(this))>=t.contribution){
     po.currentFunder=candidate;po.deadline=block.timestamp+t.paymentWindow;emit FunderAssigned(id,payoutNumber[id],candidate,po.deadline);return;
    }
   }
   candidate=nextParticipant[id][candidate];
   if(candidate==t.head)break;
  }
  // No one is currently able to fund. A later balance/allowance change can call refreshFunder().
 }

 function _append(Tier storage t,uint256 id,address a) internal {
  if(t.tail==address(0)){t.head=a;t.tail=a;}
  else {nextParticipant[id][t.tail]=a;t.tail=a;}
  nextParticipant[id][a]=address(0);t.queueSize++;
 }

 function _moveHeadToTail(Tier storage t,uint256 id,address a) internal {
  if(t.queueSize<=1){t.head=a;t.tail=a;return;}
  if(t.head!=a)return;
  address next=nextParticipant[id][a];t.head=next;nextParticipant[id][t.tail]=a;t.tail=a;nextParticipant[id][a]=address(0);
 }

 function isFunderEligible(uint256 id,address a) external view returns(bool){
  Tier storage t=_tier(id);Participant storage p=participants[id][a];Payout storage po=payouts[id][payoutNumber[id]];
  return p.joined&&p.eligible&&p.collateral>=t.collateralRequired&&a!=po.recipient&&po.currentFunder==address(0)&&po.funderCount<FUNDERS_PER_PAYOUT&&IERC20Minimal(t.token).balanceOf(a)>=t.contribution&&IERC20Minimal(t.token).allowance(a,address(this))>=t.contribution;
 }

 function getTier(uint256 id) external view returns(Tier memory){return _tier(id);}
 function getQueue(uint256 id) external view returns(address[] memory out){
  Tier storage t=_tier(id);out=new address[](t.queueSize);address cur=t.head;
  for(uint256 i=0;i<t.queueSize;i++){out[i]=cur;cur=nextParticipant[id][cur];}
 }
 function getParticipant(uint256 id,address a) external view returns(Participant memory){return participants[id][a];}
 function getCurrentPayout(uint256 id) external view returns(bool,uint256,address,uint256,uint256,uint256,address){
  Tier storage t=_tier(id);Payout storage p=payouts[id][payoutNumber[id]];
  return(p.exists,payoutNumber[id],p.recipient,p.funded,p.funderCount,p.deadline,p.currentFunder);
 }
 function getTierIds() external view returns(uint256[] memory out){uint256 n=nextTierId-1;out=new uint256[](n);for(uint256 i=0;i<n;i++)out[i]=i+1;}
 function _tier(uint256 id) internal view returns(Tier storage t){t=tiers[id];if(!t.exists)revert TierNotFound();}
 function _transferFromExact(address token,address from,address to,uint256 amount) internal{
  uint256 beforeBal=IERC20Minimal(token).balanceOf(to);
  (bool ok,bytes memory data)=token.call(abi.encodeWithSelector(IERC20Minimal.transferFrom.selector,from,to,amount));
  if(!ok||(data.length>0&&!abi.decode(data,(bool))))revert TransferFailed();
  uint256 afterBal=IERC20Minimal(token).balanceOf(to);if(afterBal<beforeBal||afterBal-beforeBal!=amount)revert TransferMismatch();
 }
 function _transferExact(address token,address to,uint256 amount) internal{
  uint256 beforeBal=IERC20Minimal(token).balanceOf(to);
  (bool ok,bytes memory data)=token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector,to,amount));
  if(!ok||(data.length>0&&!abi.decode(data,(bool))))revert TransferFailed();
  uint256 afterBal=IERC20Minimal(token).balanceOf(to);if(afterBal<beforeBal||afterBal-beforeBal!=amount)revert TransferMismatch();
 }
}