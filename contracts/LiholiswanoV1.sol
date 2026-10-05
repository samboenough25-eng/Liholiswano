// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Liholiswano Financial Services Platform - V1 fixed-round protocol
/// @notice The blockchain contract is the financial authority. Backend/keeper code is read/trigger only.
contract LiholiswanoV1 {
    uint8 public constant ROUND_SIZE = 11;
    uint8 public constant OBLIGATIONS_PER_MEMBER = 10;
    uint256 public constant ENTRY_FEE = 5e6; // BWP/E5 for the approved 6-decimal stablecoin set.
    uint256 public constant HIGH_DEFAULT_THRESHOLD = 3;

    enum ObligationStatus { NONE, OPEN, PAID, COLLATERAL_COVERED, BLOCKED_RECOVERY }

    struct Tier {
        bool exists;
        bool active;
        address token;
        uint256 payout;
        uint256 contribution;
        uint256 collateralRequired;
        uint256 targetWindow;
        uint256 maxWindow;
    }

    struct Round {
        bool exists;
        bool active;
        bool complete;
        uint256 tierId;
        uint256 id;
        address token;
        uint256 payout;
        uint256 contribution;
        uint256 collateralRequired;
        uint256 targetWindow;
        uint256 maxWindow;
        uint256 activatedAt;
        uint256 deadline;
        uint8 settledPositions;
        uint8 resolvedObligations;
        address[ROUND_SIZE] members;
    }

    struct Position {
        address recipient;
        uint256 resolvedAmount;
        uint8 resolvedCount;
        bool settled;
    }

    struct Obligation {
        address funder;
        uint256 amount;
        uint256 dueAt;
        ObligationStatus status;
    }

    struct Participant {
        bool joined;
        bool waiting;
        uint256 collateral;
        uint256 defaultCount;
        uint256 suspendedThroughRound;
        uint256 activeRound;
        uint256 lastCompletedRound;
        bool receivedInActiveRound;
        uint8 resolvedObligationsInActiveRound;
    }

    address public owner;
    address public pendingOwner;
    address public treasury;
    bool public paused;
    uint256 private guard = 1;

    mapping(address => bool) public approvedToken;
    mapping(uint256 => Tier) private tiers;
    mapping(uint256 => uint256) public latestRoundId;
    mapping(uint256 => mapping(uint256 => Round)) private rounds;
    mapping(uint256 => mapping(uint256 => Position)) private positions;
    mapping(uint256 => mapping(uint256 => mapping(uint8 => mapping(uint8 => Obligation)))) private obligations;
    mapping(uint256 => mapping(address => Participant)) private participants;

    mapping(uint256 => address[]) private waitingList;
    mapping(uint256 => mapping(address => bool)) private waitingListed;

    error Unauthorized();
    error PausedError();
    error InvalidConfig();
    error InvalidToken();
    error NotApprovedToken();
    error TierNotFound();
    error TierInactive();
    error ZeroAddress();
    error AlreadyJoined();
    error NotParticipant();
    error NotWaiting();
    error AlreadyActive();
    error RoundNotActive();
    error RoundNotComplete();
    error NotRoundMember();
    error InvalidIndex();
    error SelfObligation();
    error NotFunder();
    error AlreadyResolved();
    error DeadlineNotReached();
    error PaymentClosed();
    error InsufficientCollateral();
    error InsufficientEligibility();
    error PayoutNotReady();
    error TransferFailed();
    error TransferMismatch();
    error Reentrancy();
    error Suspended();
    error CannotWithdraw();
    error CannotExit();
    error TokenBalanceShortfall();

    event OwnershipTransferStarted(address indexed oldOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event PausedStateChanged(bool paused, address indexed operator);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event TokenApprovalChanged(address indexed token, bool approved);
    event TierConfigured(uint256 indexed tierId, address indexed token, uint256 payout, uint256 contribution, uint256 collateralRequired, uint256 targetWindow, uint256 maxWindow, bool active);
    event TierActivationChanged(uint256 indexed tierId, bool active);

    event WaitingListJoined(uint256 indexed tierId, address indexed participant, uint256 position);
    event RoundCreated(uint256 indexed tierId, uint256 indexed roundId, uint256 activatedAt, uint256 deadline);
    event RoundMemberAdded(uint256 indexed tierId, uint256 indexed roundId, uint8 indexed memberIndex, address member);
    event RoundActivated(uint256 indexed tierId, uint256 indexed roundId);
    event PayoutPositionCreated(uint256 indexed tierId, uint256 indexed roundId, uint8 indexed recipientIndex, address recipient, uint256 payout);
    event ObligationCreated(uint256 indexed tierId, uint256 indexed roundId, uint8 indexed recipientIndex, uint8 funderIndex, address funder, uint256 amount, uint256 dueAt);
    event ObligationPaid(uint256 indexed tierId, uint256 indexed roundId, uint8 indexed recipientIndex, uint8 funderIndex, address funder, uint256 amount);
    event ObligationCollateralCovered(uint256 indexed tierId, uint256 indexed roundId, uint8 indexed recipientIndex, uint8 funderIndex, address funder, uint256 amount);
    event ObligationBlocked(uint256 indexed tierId, uint256 indexed roundId, uint8 indexed recipientIndex, uint8 funderIndex, address funder, uint256 amount);
    event PayoutSettled(uint256 indexed tierId, uint256 indexed roundId, uint8 indexed recipientIndex, address recipient, uint256 amount);
    event ParticipantDefaulted(uint256 indexed tierId, uint256 indexed roundId, address indexed participant, uint256 amount, uint256 defaultCount, uint256 remainingCollateral);
    event CollateralRestored(uint256 indexed tierId, address indexed participant, uint256 amount, uint256 totalCollateral);
    event RoundCompleted(uint256 indexed tierId, uint256 indexed roundId);
    event CollateralWithdrawn(uint256 indexed tierId, uint256 indexed roundId, address indexed participant, uint256 amount);
    event NextRoundOptIn(uint256 indexed tierId, uint256 indexed completedRound, address indexed participant);
    
    constructor(address treasury_) {
        if (treasury_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        treasury = treasury_;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }
    modifier live() { if (paused) revert PausedError(); _; }
    modifier nonReentrant() { if (guard != 1) revert Reentrancy(); guard = 2; _; guard = 1; }

    function pause() external onlyOwner { paused = true; emit PausedStateChanged(true, msg.sender); }
    function unpause() external onlyOwner { paused = false; emit PausedStateChanged(false, msg.sender); }
    function transferOwnership(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        pendingOwner = next;
        emit OwnershipTransferStarted(owner, next);
    }
    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address old = owner; owner = msg.sender; pendingOwner = address(0);
        emit OwnershipTransferred(old, owner);
    }
    function setTreasury(address next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit TreasuryChanged(treasury, next); treasury = next;
    }
    function setApprovedToken(address token, bool approved) external onlyOwner {
        if (token == address(0) || token.code.length == 0) revert InvalidToken();
        approvedToken[token] = approved;
        emit TokenApprovalChanged(token, approved);
    }

    /// @dev V1 has exactly five product tiers. Values are frozen for active rounds;
    ///      future rounds use the current configuration snapshot.
    function configureTier(
        uint256 tierId,
        address token,
        uint256 payout,
        uint256 collateralRequired,
        uint256 targetWindow,
        uint256 maxWindow,
        bool active
    ) external onlyOwner live {
        if (tierId < 1 || tierId > 5) revert InvalidConfig();
        uint256 expectedPayout = tierId == 1 ? 200e6 : tierId == 2 ? 400e6 : tierId == 3 ? 600e6 : tierId == 4 ? 800e6 : 100e6;
        if (payout != expectedPayout) revert InvalidConfig();
        if (!approvedToken[token] || token.code.length == 0) revert NotApprovedToken();
        if (payout == 0 || payout % 10 != 0 || collateralRequired != payout / 5) revert InvalidConfig();
        if (targetWindow == 0 || maxWindow < targetWindow) revert InvalidConfig();

        uint256 contribution = payout / 10;
        Tier storage t = tiers[tierId];
        if (t.exists && latestRoundId[tierId] != 0 && rounds[tierId][latestRoundId[tierId]].active) revert InvalidConfig();
        if (waitingList[tierId].length != 0) revert InvalidConfig();
        t.exists = true; t.active = active; t.token = token;
        t.payout = payout; t.contribution = contribution; t.collateralRequired = collateralRequired;
        t.targetWindow = targetWindow; t.maxWindow = maxWindow;
        emit TierConfigured(tierId, token, payout, contribution, collateralRequired, targetWindow, maxWindow, active);
    }

    function setTierActive(uint256 tierId, bool active) external onlyOwner {
        Tier storage t = _tier(tierId);
        if (latestRoundId[tierId] != 0 && rounds[latestRoundId[tierId]].active) revert InvalidConfig();
        t.active = active;
        emit TierActivationChanged(tierId, active);
    }

    function joinTier(uint256 tierId) external live nonReentrant {
        Tier storage t = _tier(tierId);
        if (!t.active) revert TierInactive();
        Participant storage p = participants[tierId][msg.sender];
        if (p.joined) revert AlreadyJoined();
        if (p.suspendedThroughRound >= latestRoundId[tierId] + 1) revert Suspended();

        _transferFromExact(t.token, msg.sender, address(this), t.collateralRequired);
        _transferFromExact(t.token, msg.sender, treasury, ENTRY_FEE);

        p.joined = true;
        p.collateral = t.collateralRequired;
        _enterWaiting(tierId, msg.sender);
    }

    function optIntoNextRound(uint256 tierId) external live nonReentrant {
        Tier storage t = _tier(tierId);
        Participant storage p = participants[tierId][msg.sender];
        if (!p.joined) revert NotParticipant();
        if (p.waiting || p.activeRound != 0) revert AlreadyActive();
        if (p.lastCompletedRound == 0 || p.lastCompletedRound != latestRoundId[tierId]) revert CannotExit();
        if (p.suspendedThroughRound >= latestRoundId[tierId] + 1) revert Suspended();
        if (p.collateral < t.collateralRequired) revert InsufficientEligibility();
        p.receivedInActiveRound = false;
        p.resolvedObligationsInActiveRound = 0;
        _enterWaiting(tierId, msg.sender);
        emit NextRoundOptIn(tierId, p.lastCompletedRound, msg.sender);
    }

    function restoreCollateral(uint256 tierId) external live nonReentrant {
        Tier storage t = _tier(tierId);
        Participant storage p = participants[tierId][msg.sender];
        if (!p.joined) revert NotParticipant();
        if (p.collateral >= t.collateralRequired) revert InvalidConfig();
        uint256 need = t.collateralRequired - p.collateral;
        _transferFromExact(t.token, msg.sender, address(this), need);
        p.collateral += need;
        emit CollateralRestored(tierId, msg.sender, need, p.collateral);
    }

    function withdrawCollateral(uint256 tierId, uint256 roundId) external live nonReentrant {
        Participant storage p = participants[tierId][msg.sender];
        Round storage r = _round(tierId, roundId);
        if (!r.complete || p.activeRound != 0 || p.waiting) revert CannotWithdraw();
        if (!_isMember(r, msg.sender)) revert NotRoundMember();
        if (!p.receivedInActiveRound || p.resolvedObligationsInActiveRound != OBLIGATIONS_PER_MEMBER) revert CannotWithdraw();
        uint256 amount = p.collateral;
        if (amount == 0) revert CannotWithdraw();
        p.collateral = 0;
        p.joined = false;
        _transferExact(r.token, msg.sender, amount);
        emit CollateralWithdrawn(tierId, roundId, msg.sender, amount);
    }

    /// @notice Pays one predetermined obligation. No recipient/funder is user-selected.
    function payObligation(uint256 tierId, uint256 roundId, uint8 recipientIndex, uint8 funderIndex) external live nonReentrant {
        Round storage r = _round(tierId, roundId);
        if (!r.active || r.complete) revert RoundNotActive();
        Obligation storage o = _obligation(tierId, roundId, recipientIndex, funderIndex);
        if (o.status != ObligationStatus.OPEN) revert AlreadyResolved();
        if (msg.sender != o.funder) revert NotFunder();
        Participant storage payer = participants[tierId][msg.sender];
        if (payer.collateral < r.collateralRequired) revert InsufficientEligibility();
        if (block.timestamp >= o.dueAt) revert PaymentClosed();
        _transferFromExact(r.token, msg.sender, address(this), o.amount);
        o.status = ObligationStatus.PAID;
        _resolveObligation(tierId, roundId, recipientIndex, funderIndex, false);
        emit ObligationPaid(tierId, roundId, recipientIndex, funderIndex, msg.sender, o.amount);
    }

    /// @notice Permissionless deterministic default processing after the fixed maximum window.
    function processExpiredObligation(uint256 tierId, uint256 roundId, uint8 recipientIndex, uint8 funderIndex) external live nonReentrant {
        Round storage r = _round(tierId, roundId);
        if (!r.active || r.complete) revert RoundNotActive();
        Obligation storage o = _obligation(tierId, roundId, recipientIndex, funderIndex);
        if (o.status != ObligationStatus.OPEN) revert AlreadyResolved();
        if (block.timestamp < o.dueAt) revert DeadlineNotReached();

        Participant storage p = participants[tierId][o.funder];
        if (p.collateral < o.amount) {
            o.status = ObligationStatus.BLOCKED_RECOVERY;
            emit ObligationBlocked(tierId, roundId, recipientIndex, funderIndex, o.funder, o.amount);
            return;
        }

        p.collateral -= o.amount;
        p.defaultCount += 1;
        if (p.defaultCount >= HIGH_DEFAULT_THRESHOLD) {
            uint256 through = roundId + 1;
            if (through > p.suspendedThroughRound) p.suspendedThroughRound = through;
        }
        o.status = ObligationStatus.COLLATERAL_COVERED;
        _transferExact(r.token, r.members[recipientIndex], o.amount);
        _resolveObligation(tierId, roundId, recipientIndex, funderIndex, true);
        emit ObligationCollateralCovered(tierId, roundId, recipientIndex, funderIndex, o.funder, o.amount);
        emit ParticipantDefaulted(tierId, roundId, o.funder, o.amount, p.defaultCount, p.collateral);
    }

    /// @notice Restores a BLOCKED_RECOVERY obligation's collateral and resolves it atomically.
    function restoreAndResolveBlockedObligation(
        uint256 tierId,
        uint256 roundId,
        uint8 recipientIndex,
        uint8 funderIndex
    ) external live nonReentrant {
        Round storage r = _round(tierId, roundId);
        Obligation storage o = _obligation(tierId, roundId, recipientIndex, funderIndex);
        if (o.status != ObligationStatus.BLOCKED_RECOVERY) revert AlreadyResolved();
        if (msg.sender != o.funder) revert NotFunder();
        Participant storage p = participants[tierId][msg.sender];
        if (p.collateral < o.amount) {
            uint256 need = o.amount - p.collateral;
            _transferFromExact(r.token, msg.sender, address(this), need);
            p.collateral += need;
        }
        p.collateral -= o.amount;
        p.defaultCount += 1;
        if (p.defaultCount >= HIGH_DEFAULT_THRESHOLD) {
            uint256 through = roundId + 1;
            if (through > p.suspendedThroughRound) p.suspendedThroughRound = through;
        }
        o.status = ObligationStatus.COLLATERAL_COVERED;
        _transferExact(r.token, r.members[recipientIndex], o.amount);
        _resolveObligation(tierId, roundId, recipientIndex, funderIndex, true);
        emit ObligationCollateralCovered(tierId, roundId, recipientIndex, funderIndex, o.funder, o.amount);
        emit ParticipantDefaulted(tierId, roundId, o.funder, o.amount, p.defaultCount, p.collateral);
    }

    /// @notice Settles a payout only from its own ten resolved obligations.
    function settlePayout(uint256 tierId, uint256 roundId, uint8 recipientIndex) external live nonReentrant {
        Round storage r = _round(tierId, roundId);
        if (!r.active || r.complete) revert RoundNotActive();
        Position storage pos = _position(tierId, roundId, recipientIndex);
        if (pos.settled || pos.resolvedCount != OBLIGATIONS_PER_MEMBER || pos.resolvedAmount != r.payout) revert PayoutNotReady();
        pos.settled = true;
        r.settledPositions += 1;
        Participant storage recipient = participants[tierId][pos.recipient];
        recipient.receivedInActiveRound = true;
        recipient.resolvedObligationsInActiveRound = _countResolvedForParticipant(tierId, roundId, recipientIndex);
        _transferExact(r.token, pos.recipient, r.payout);
        emit PayoutSettled(tierId, roundId, recipientIndex, pos.recipient, r.payout);
        _tryCompleteRound(tierId, roundId);
    }

    function getTier(uint256 tierId) external view returns (Tier memory) { return _tier(tierId); }
    function getWaitingList(uint256 tierId) external view returns (address[] memory) { return waitingList[tierId]; }
    function getParticipant(uint256 tierId, address account) external view returns (Participant memory) { return participants[tierId][account]; }
    function getRound(uint256 tierId, uint256 roundId) external view returns (Round memory) { return _round(tierId, roundId); }
    function getPosition(uint256 tierId, uint256 roundId, uint8 recipientIndex) external view returns (Position memory) { return _position(tierId, roundId, recipientIndex); }
    function getObligation(uint256 tierId, uint256 roundId, uint8 recipientIndex, uint8 funderIndex) external view returns (Obligation memory) { return _obligation(tierId, roundId, recipientIndex, funderIndex); }
    function getObligationStatus(uint256 tierId, uint256 roundId, uint8 recipientIndex, uint8 funderIndex) external view returns (ObligationStatus) { return _obligation(tierId, roundId, recipientIndex, funderIndex).status; }

    function isEligibleForNextRound(uint256 tierId, address account) external view returns (bool) {
        Tier storage t = _tier(tierId);
        Participant storage p = participants[tierId][account];
        return p.joined && !p.waiting && p.activeRound == 0 && p.collateral >= t.collateralRequired &&
            p.suspendedThroughRound < latestRoundId[tierId] + 1;
    }

    function _enterWaiting(uint256 tierId, address account) internal {
        if (waitingListed[tierId][account]) revert AlreadyActive();
        waitingListed[tierId][account] = true;
        Participant storage p = participants[tierId][account];
        p.waiting = true;
        waitingList[tierId].push(account);
        emit WaitingListJoined(tierId, account, waitingList[tierId].length - 1);
        if (waitingList[tierId].length >= ROUND_SIZE) _activateNextRound(tierId);
    }

    function _activateNextRound(uint256 tierId) internal {
        Tier storage t = _tier(tierId);
        uint256 roundId = latestRoundId[tierId] + 1;
        Round storage r = rounds[tierId][roundId];
        r.exists = true; r.active = true; r.tierId = tierId; r.id = roundId;
        r.token = t.token; r.payout = t.payout; r.contribution = t.contribution;
        r.collateralRequired = t.collateralRequired; r.targetWindow = t.targetWindow; r.maxWindow = t.maxWindow;
        r.activatedAt = block.timestamp; r.deadline = block.timestamp + t.maxWindow;
        latestRoundId[tierId] = roundId;

        address[] storage q = waitingList[tierId];
        address[ROUND_SIZE] memory selected;
        uint256 selectedCount;
        uint256 cursor;
        for (uint256 i = 0; i < q.length && selectedCount < ROUND_SIZE; i++) {
            address a = q[i];
            Participant storage p = participants[tierId][a];
            if (p.waiting && p.collateral >= t.collateralRequired && p.suspendedThroughRound < roundId) {
                selected[selectedCount] = a;
                selectedCount++;
            }
        }
        if (selectedCount < ROUND_SIZE) {
            r.active = false;
            r.exists = false;
            latestRoundId[tierId] = roundId - 1;
            return;
        }

        for (uint8 i = 0; i < ROUND_SIZE; i++) {
            address member = selected[i];
            r.members[i] = member;
            Participant storage p = participants[tierId][member];
            p.waiting = false; p.activeRound = roundId; p.receivedInActiveRound = false; p.resolvedObligationsInActiveRound = 0;
            waitingListed[tierId][member] = false;
            emit RoundMemberAdded(tierId, roundId, i, member);
            Position storage pos = positions[tierId][roundId][i];
            pos.recipient = member;
            emit PayoutPositionCreated(tierId, roundId, i, member, r.payout);
        }

        // Remove the selected members from the FIFO waiting list while preserving the
        // relative order of everyone who remains. V1 has only 11 active members; this
        // O(n) housekeeping is deliberately separated from financial settlement.
        uint256 n = q.length;
        for (uint256 i = 0; i < n; i++) {
            bool keep = !waitingListed[tierId][q[i]];
            if (keep) q[cursor++] = q[i];
        }
        while (q.length > cursor) q.pop();

        for (uint8 recipientIndex = 0; recipientIndex < ROUND_SIZE; recipientIndex++) {
            for (uint8 offset = 1; offset <= OBLIGATIONS_PER_MEMBER; offset++) {
                uint8 funderIndex = uint8((uint256(recipientIndex) + offset) % ROUND_SIZE);
                Obligation storage o = obligations[tierId][roundId][recipientIndex][funderIndex];
                o.funder = r.members[funderIndex];
                o.amount = r.contribution;
                o.dueAt = r.deadline;
                o.status = ObligationStatus.OPEN;
                emit ObligationCreated(tierId, roundId, recipientIndex, funderIndex, o.funder, o.amount, o.dueAt);
            }
        }
        emit RoundCreated(tierId, roundId, r.activatedAt, r.deadline);
        emit RoundActivated(tierId, roundId);
    }

    function _resolveObligation(uint256 tierId, uint256 roundId, uint8 recipientIndex, uint8 funderIndex, bool) internal {
        Round storage r = rounds[tierId][roundId];
        Position storage pos = positions[tierId][roundId][recipientIndex];
        Obligation storage o = obligations[tierId][roundId][recipientIndex][funderIndex];
        pos.resolvedAmount += o.amount;
        pos.resolvedCount += 1;
        r.resolvedObligations += 1;
        Participant storage p = participants[tierId][o.funder];
        p.resolvedObligationsInActiveRound += 1;
        if (r.resolvedObligations == ROUND_SIZE * OBLIGATIONS_PER_MEMBER) {
            // Positions may still need explicit settlement; completion waits for both conditions.
            _tryCompleteRound(tierId, roundId);
        }
    }

    function _tryCompleteRound(uint256 tierId, uint256 roundId) internal {
        Round storage r = rounds[tierId][roundId];
        if (r.settledPositions != ROUND_SIZE || r.resolvedObligations != ROUND_SIZE * OBLIGATIONS_PER_MEMBER) return;
        r.active = false; r.complete = true;
        for (uint8 i = 0; i < ROUND_SIZE; i++) {
            Participant storage p = participants[tierId][r.members[i]];
            p.activeRound = 0;
            p.lastCompletedRound = roundId;
            p.resolvedObligationsInActiveRound = OBLIGATIONS_PER_MEMBER;
        }
        emit RoundCompleted(tierId, roundId);
    }

    function _countResolvedForParticipant(uint256 tierId, uint256 roundId, uint8 memberIndex) internal view returns (uint8 count) {
        for (uint8 recipientIndex = 0; recipientIndex < ROUND_SIZE; recipientIndex++) {
            if (recipientIndex == memberIndex) continue;
            Obligation storage o = obligations[tierId][roundId][recipientIndex][memberIndex];
            if (o.status == ObligationStatus.PAID || o.status == ObligationStatus.COLLATERAL_COVERED) count++;
        }
    }

    function _isMember(Round storage r, address account) internal view returns (bool) {
        for (uint8 i = 0; i < ROUND_SIZE; i++) if (r.members[i] == account) return true;
        return false;
    }

    function _tier(uint256 tierId) internal view returns (Tier storage t) {
        t = tiers[tierId];
        if (!t.exists) revert TierNotFound();
    }
    function _round(uint256 tierId, uint256 roundId) internal view returns (Round storage r) {
        r = rounds[roundId];
        if (!r.exists || r.tierId != tierId) revert RoundNotActive();
    }
    function _position(uint256 tierId, uint256 roundId, uint8 recipientIndex) internal view returns (Position storage p) {
        if (recipientIndex >= ROUND_SIZE) revert InvalidIndex();
        p = positions[tierId][roundId][recipientIndex];
    }
    function _obligation(uint256 tierId, uint256 roundId, uint8 recipientIndex, uint8 funderIndex) internal view returns (Obligation storage o) {
        if (recipientIndex >= ROUND_SIZE || funderIndex >= ROUND_SIZE || recipientIndex == funderIndex) revert InvalidIndex();
        o = obligations[tierId][roundId][recipientIndex][funderIndex];
    }

    function _transferFromExact(address token, address from, address to, uint256 amount) internal {
        uint256 beforeBal = _balanceOf(token, to);
        (bool ok, bytes memory data) = token.call(abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        uint256 afterBal = _balanceOf(token, to);
        if (afterBal < beforeBal || afterBal - beforeBal != amount) revert TransferMismatch();
    }
    function _transferExact(address token, address to, uint256 amount) internal {
        uint256 beforeBal = _balanceOf(token, to);
        (bool ok, bytes memory data) = token.call(abi.encodeWithSignature("transfer(address,uint256)", to, amount));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        uint256 afterBal = _balanceOf(token, to);
        if (afterBal < beforeBal || afterBal - beforeBal != amount) revert TransferMismatch();
    }
    function _balanceOf(address token, address account) internal view returns (uint256 bal) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSignature("balanceOf(address)", account));
        if (!ok || data.length < 32) revert TokenBalanceShortfall();
        bal = abi.decode(data, (uint256));
    }
}