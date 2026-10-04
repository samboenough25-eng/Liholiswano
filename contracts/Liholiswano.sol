// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Minimal {
    function transfer(address to,uint256 amount) external returns(bool);
    function transferFrom(address from,address to,uint256 amount) external returns(bool);
    function balanceOf(address account) external view returns(uint256);
    function allowance(address owner,address spender) external view returns(uint256);
}

contract Liholiswano {
    uint256 public constant FUNDERS_PER_PAYOUT = 10;
    uint256 public constant ENTRY_FEE = 5e6; // P5 with the testnet token's 6 decimals; production token amount is configurable below.
    uint256 public constant MAX_TIERS = 32;
    uint256 public constant MAX_QUEUE_SCAN = 128;

    address public owner;
    address public pendingOwner;
    address public treasury;
    bool public paused;
    uint256 public protocolFeeBps;
    uint256 private lockState = 1;

    mapping(address=>bool) public approvedToken;
    uint256 public nextTierId = 1;

    struct Tier {
        bool exists;
        bool active;
        address token;
        uint256 payout;
        uint256 contribution;
        uint256 collateralRequired;
        uint256 paymentWindow;
        uint256 queueLength;
        uint256 recipientIndex;
        uint256 funderCursor;
        uint256 cycle;
        uint256 fundedAmount;
        uint256 funderCount;
        uint256 payoutDeadline;
        address recipient;
    }

    struct Participant {
        bool joined;
        bool eligible;
        uint256 collateral;
        uint256 queueIndex;
        uint256 receivedCount;
        uint256 fundedCount;
        uint256 defaultCount;
    }

    struct Payout {
        bool exists;
        bool paid;
        uint256 funded;
        uint256 funderCount;
        uint256 deadline;
        address recipient;
        mapping(address=>bool) fundedBy;
    }

    mapping(uint256=>Tier) private tiers;
    mapping(uint256=>address[]) private queues;
    mapping(uint256=>mapping(address=>Participant)) private participants;
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
    error InsufficientCollateral();
    error NotEligible();
    error NotYourTurn();
    error InvalidAmount();
    error AlreadyFunded();
    error PaymentClosed();
    error PayoutNotReady();
    error TransferFailed();
    error TransferMismatch();
    error ZeroAddress();
    error Reentrancy();
    error ScanLimit();
    error NoEligibleRecipient();

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
    event FunderPaid(uint256 indexed tierId,uint256 indexed payoutId,address indexed funder,uint256 amount,uint256 funderCount);
    event FunderDefaulted(uint256 indexed tierId,uint256 indexed payoutId,address indexed funder,uint256 amount,uint256 remainingCollateral);
    event RecipientPaid(uint256 indexed tierId,uint256 indexed payoutId,address indexed recipient,uint256 amount,uint256 nextQueueIndex);
    event RecipientRequeued(uint256 indexed tierId,address indexed recipient,uint256 newPosition);

    constructor(address initialTreasury,uint256 initialFeeBps) {
        if(initialTreasury==address(0)||initialFeeBps>500) revert InvalidConfig();
        owner=msg.sender; treasury=initialTreasury; protocolFeeBps=initialFeeBps;
        emit OwnershipTransferred(address(0),msg.sender);
    }

    modifier onlyOwner(){if(msg.sender!=owner) revert Unauthorized(); _;}
    modifier whenNotPaused(){if(paused) revert PausedError(); _;}
    modifier nonReentrant(){if(lockState!=1) revert Reentrancy(); lockState=2; _; lockState=1;}

    function pause() external onlyOwner { paused=true; emit PausedStateChanged(true,msg.sender); }
    function unpause() external onlyOwner { paused=false; emit PausedStateChanged(false,msg.sender); }
    function transferOwnership(address n) external onlyOwner { if(n==address(0)) revert ZeroAddress(); pendingOwner=n; emit OwnershipTransferStarted(owner,n); }
    function acceptOwnership() external { if(msg.sender!=pendingOwner) revert Unauthorized(); address old=owner; owner=msg.sender; pendingOwner=address(0); emit OwnershipTransferred(old,msg.sender); }
    function setTreasury(address n) external onlyOwner { if(n==address(0)) revert ZeroAddress(); emit TreasuryChanged(treasury,n); treasury=n; }
    function setProtocolFeeBps(uint256 n) external onlyOwner { if(n>500) revert InvalidConfig(); emit ProtocolFeeChanged(protocolFeeBps,n); protocolFeeBps=n; }
    function setApprovedToken(address t,bool a) external onlyOwner { if(t==address(0)||t.code.length==0) revert InvalidToken(); approvedToken[t]=a; emit TokenApprovalChanged(t,a); }

    function createTier(address token,uint256 payout,uint256 collateralRequired,uint256 paymentWindow) external onlyOwner whenNotPaused returns(uint256 id) {
        if(!approvedToken[token]||token.code.length==0) revert NotApprovedToken();
        if(payout==0||payout%FUNDERS_PER_PAYOUT!=0||collateralRequired==0||paymentWindow==0||nextTierId>MAX_TIERS) revert InvalidConfig();
        id=nextTierId++;
        tiers[id]=Tier(true,true,token,payout,payout/FUNDERS_PER_PAYOUT,collateralRequired,paymentWindow,0,0,0,0,0,0,0,address(0));
        emit TierCreated(id,token,payout,payout/FUNDERS_PER_PAYOUT,collateralRequired);
    }

    function updateTier(uint256 id,uint256 payout,uint256 collateralRequired,uint256 paymentWindow,bool active) external onlyOwner {
        Tier storage t=_tier(id);
        if(payout==0||payout%FUNDERS_PER_PAYOUT!=0||collateralRequired==0||paymentWindow==0) revert InvalidConfig();
        if(t.queueLength>0 && (t.payout!=payout || t.token==address(0))) revert InvalidConfig();
        t.payout=payout; t.contribution=payout/FUNDERS_PER_PAYOUT; t.collateralRequired=collateralRequired; t.paymentWindow=paymentWindow; t.active=active;
        emit TierUpdated(id,payout,t.contribution,collateralRequired,paymentWindow,active);
    }

    function joinTier(uint256 id) external whenNotPaused nonReentrant {
        Tier storage t=_tier(id); if(!t.active) revert TierInactive();
        Participant storage p=participants[id][msg.sender]; if(p.joined) revert AlreadyJoined();
        _transferFromExact(t.token,msg.sender,address(this),ENTRY_FEE+t.collateralRequired);
        p.joined=true; p.eligible=true; p.collateral=t.collateralRequired; p.queueIndex=t.queueLength;
        queues[id].push(msg.sender); t.queueLength++;
        emit JoinedQueue(id,msg.sender,p.queueIndex,p.collateral);
        _ensureRecipient(t,id);
    }

    function restoreCollateral(uint256 id) external whenNotPaused nonReentrant {
        Tier storage t=_tier(id); Participant storage p=participants[id][msg.sender]; if(!p.joined) revert NotParticipant();
        if(p.collateral>=t.collateralRequired) revert AlreadyEligible();
        uint256 needed=t.collateralRequired-p.collateral;
        _transferFromExact(t.token,msg.sender,address(this),needed);
        p.collateral+=needed; p.eligible=true;
        emit CollateralRestored(id,msg.sender,needed,p.collateral);
    }

    function fundCurrent(uint256 id) external whenNotPaused nonReentrant {
        Tier storage t=_tier(id); Participant storage p=participants[id][msg.sender];
        if(!p.joined) revert NotParticipant();
        if(!p.eligible || p.collateral<t.collateralRequired) revert NotEligible();
        _ensureRecipient(t,id);
        address recipient=t.recipient; if(recipient==address(0)||recipient==msg.sender) revert NotEligible();
        uint256 pid=payoutNumber[id]; Payout storage po=payouts[id][pid];
        if(block.timestamp>=po.deadline) revert PaymentClosed();
        if(po.fundedBy[msg.sender]) revert AlreadyFunded();
        _transferFromExact(t.token,msg.sender,address(this),t.contribution);
        po.fundedBy[msg.sender]=true; po.funded+=t.contribution; po.funderCount++;
        p.fundedCount++;
        emit FunderPaid(id,pid,msg.sender,t.contribution,po.funderCount);
        if(po.funderCount==FUNDERS_PER_PAYOUT) _payRecipient(t,id,pid);
    }

    function defaultFunder(uint256 id,address funder) external whenNotPaused nonReentrant {
        Tier storage t=_tier(id); Participant storage p=participants[id][funder];
        if(!p.joined) revert NotParticipant();
        uint256 pid=payoutNumber[id]; Payout storage po=payouts[id];
        if(!po.exists||po.paid||!po.fundedBy[funder]) revert NotEligible();
        if(block.timestamp<po.deadline) revert PaymentClosed();
        // A successfully funded contribution cannot default. This function is retained for
        // reserved future slot accounting; actual missed payments are represented by an
        // unsuccessful fundCurrent call and skipped by the cursor.
        revert NotEligible();
    }

    function skipCurrent(uint256 id) external whenNotPaused {
        Tier storage t=_tier(id); _ensureRecipient(t,id);
        Payout storage po=payouts[id][payoutNumber[id]];
        if(block.timestamp<po.deadline) revert PaymentClosed();
        if(po.funderCount>=FUNDERS_PER_PAYOUT) revert PayoutNotReady();
        t.funderCursor=_nextIndex(t,id,t.funderCursor);
        po.deadline=block.timestamp+t.paymentWindow;
    }

    function settlePayout(uint256 id) external whenNotPaused nonReentrant {
        Tier storage t=_tier(id); _ensureRecipient(t,id);
        uint256 pid=payoutNumber[id]; Payout storage po=payouts[id][pid];
        if(po.funderCount<FUNDERS_PER_PAYOUT) revert PayoutNotReady();
        _payRecipient(t,id,pid);
    }

    function _payRecipient(Tier storage t,uint256 id,uint256 pid) internal {
        Payout storage po=payouts[id][pid]; if(po.paid) return;
        if(po.funderCount!=FUNDERS_PER_PAYOUT||po.funded!=t.payout) revert PayoutNotReady();
        uint256 fee=po.funded*protocolFeeBps/10000;
        uint256 net=po.funded-fee;
        _transferExact(t.token,po.recipient,net);
        if(fee>0) _transferExact(t.token,treasury,fee);
        po.paid=true;
        Participant storage rp=participants[id][po.recipient];
        rp.receivedCount++; rp.eligible=true;
        // Recipient goes to the back. The array uses append-only slots so the queue
        // remains auditable; recipientIndex points at the current head.
        uint256 oldIndex=rp.queueIndex;
        rp.queueIndex=t.queueLength;
        queues[id].push(po.recipient); t.queueLength++;
        t.recipientIndex=_nextIndex(t,id,oldIndex);
        t.funderCursor=t.recipientIndex;
        t.recipient=address(0);
        emit RecipientPaid(id,pid,po.recipient,net,t.recipientIndex);
        emit RecipientRequeued(id,po.recipient,rp.queueIndex);
        _ensureRecipient(t,id);
    }

    function _ensureRecipient(Tier storage t,uint256 id) internal {
        if(t.recipient!=address(0)) return;
        if(t.queueLength==0) revert NoEligibleRecipient();
        uint256 idx=t.recipientIndex;
        for(uint256 i=0;i<MAX_QUEUE_SCAN;i++){
            if(idx>=t.queueLength) idx=0;
            address candidate=queues[id][idx];
            Participant storage p=participants[id][candidate];
            if(p.joined&&p.eligible&&p.collateral>=t.collateralRequired){
                t.recipient=candidate;
                uint256 pid=payoutNumber[id]+1;
                payoutNumber[id]=pid;
                Payout storage po=payouts[id][pid];
                po.exists=true; po.deadline=block.timestamp+t.paymentWindow; po.recipient=candidate;
                t.payoutDeadline=po.deadline; t.fundedAmount=0; t.funderCount=0; t.cycle++;
                return;
            }
            idx++;
        }
        revert NoEligibleRecipient();
    }

    function _nextIndex(Tier storage t,uint256 id,uint256 idx) internal view returns(uint256) {
        if(t.queueLength==0) return 0;
        idx++;
        if(idx>=t.queueLength) idx=0;
        return idx;
    }

    function isFunderEligible(uint256 id,address a) external view returns(bool) {
        Tier storage t=_tier(id); Participant storage p=participants[id][a];
        if(!p.joined||!p.eligible||p.collateral<t.collateralRequired||a==t.recipient) return false;
        if(IERC20Minimal(t.token).balanceOf(a)<t.contribution) return false;
        if(IERC20Minimal(t.token).allowance(a,address(this))<t.contribution) return false;
        Payout storage po=payouts[id][payoutNumber[id]];
        return !po.fundedBy[a];
    }

    function getTier(uint256 id) external view returns(Tier memory) { return _tier(id); }
    function getQueue(uint256 id) external view returns(address[] memory) { return queues[id]; }
    function getParticipant(uint256 id,address a) external view returns(Participant memory) { return participants[id][a]; }
    function getCurrentPayout(uint256 id) external view returns(bool,uint256,address,uint256,uint256,uint256) {
        Tier storage t=_tier(id); Payout storage p=payouts[id][payoutNumber[id]];
        return(p.exists,payoutNumber[id],p.recipient,p.funded,p.funderCount,p.deadline);
    }
    function getTierIds() external view returns(uint256[] memory out) {
        uint256 count=nextTierId-1; out=new uint256[](count); for(uint256 i=0;i<count;i++) out[i]=i+1;
    }

    function _tier(uint256 id) internal view returns(Tier storage t){t=tiers[id];if(!t.exists) revert TierNotFound();}
    function _transferFromExact(address token,address from,address to,uint256 amount) internal {
        uint256 beforeBal=IERC20Minimal(token).balanceOf(to);
        (bool ok,bytes memory data)=token.call(abi.encodeWithSelector(IERC20Minimal.transferFrom.selector,from,to,amount));
        if(!ok||(data.length>0&&!abi.decode(data,(bool)))) revert TransferFailed();
        uint256 afterBal=IERC20Minimal(token).balanceOf(to);
        if(afterBal<beforeBal||afterBal-beforeBal!=amount) revert TransferMismatch();
    }
    function _transferExact(address token,address to,uint256 amount) internal {
        uint256 beforeBal=IERC20Minimal(token).balanceOf(to);
        (bool ok,bytes memory data)=token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector,to,amount));
        if(!ok||(data.length>0&&!abi.decode(data,(bool)))) revert TransferFailed();
        uint256 afterBal=IERC20Minimal(token).balanceOf(to);
        if(afterBal<beforeBal||afterBal-beforeBal!=amount) revert TransferMismatch();
    }
}
