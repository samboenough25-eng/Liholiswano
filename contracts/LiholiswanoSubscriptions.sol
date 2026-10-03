// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Subscription {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

contract LiholiswanoSubscriptions {
    address public owner;
    address public pendingOwner;
    address public treasury;
    address public token;
    bool public paused;
    mapping(bytes32 => bool) public paid;
    mapping(bytes32 => mapping(uint256 => bool)) public paidCustomerPeriod;
    uint256 private lock = 1;

    error Unauthorized();
    error ZeroAddress();
    error Paused();
    error AlreadyPaid();
    error AlreadyPaidPeriod();
    error InvalidAmount();
    error TransferFailed();
    error TransferMismatch();
    error Reentrancy();

    event OwnershipTransferStarted(address indexed oldOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);
    event TreasuryChanged(address indexed oldTreasury, address indexed newTreasury);
    event TokenChanged(address indexed oldToken, address indexed newToken);
    event PausedStateChanged(bool paused, address indexed operator);
    event SubscriptionPaid(bytes32 indexed subscriptionKey, bytes32 indexed customerKey, address indexed payer, address token, uint256 amount, uint256 periodStart);

    constructor(address initialTreasury, address initialToken) {
        if (initialTreasury == address(0) || initialToken == address(0) || initialToken.code.length == 0) revert ZeroAddress();
        owner = msg.sender;
        treasury = initialTreasury;
        token = initialToken;
        emit OwnershipTransferred(address(0), msg.sender);
    }

    modifier onlyOwner() { if (msg.sender != owner) revert Unauthorized(); _; }
    modifier whenNotPaused() { if (paused) revert Paused(); _; }
    modifier nonReentrant() { if (lock != 1) revert Reentrancy(); lock = 2; _; lock = 1; }

    function pause() external onlyOwner { if (!paused) { paused = true; emit PausedStateChanged(true, msg.sender); } }
    function unpause() external onlyOwner { if (paused) { paused = false; emit PausedStateChanged(false, msg.sender); } }

    function transferOwnership(address nextOwner) external onlyOwner {
        if (nextOwner == address(0)) revert ZeroAddress();
        pendingOwner = nextOwner;
        emit OwnershipTransferStarted(owner, nextOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address old = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(old, msg.sender);
    }

    function setTreasury(address nextTreasury) external onlyOwner {
        if (nextTreasury == address(0)) revert ZeroAddress();
        emit TreasuryChanged(treasury, nextTreasury);
        treasury = nextTreasury;
    }

    function setToken(address nextToken) external onlyOwner {
        if (nextToken == address(0) || nextToken.code.length == 0) revert ZeroAddress();
        emit TokenChanged(token, nextToken);
        token = nextToken;
    }

    function paySubscription(bytes32 subscriptionKey, bytes32 customerKey, uint256 periodStart, uint256 amount)
        external
        whenNotPaused
        nonReentrant
    {
        if (subscriptionKey == bytes32(0) || customerKey == bytes32(0) || periodStart == 0 || amount == 0) revert InvalidAmount();
        if (paid[subscriptionKey]) revert AlreadyPaid();
        if (paidCustomerPeriod[customerKey][periodStart]) revert AlreadyPaidPeriod();

        uint256 beforeBalance = IERC20Subscription(token).balanceOf(treasury);
        (bool ok, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Subscription.transferFrom.selector, msg.sender, treasury, amount)
        );
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        uint256 afterBalance = IERC20Subscription(token).balanceOf(treasury);
        if (afterBalance < beforeBalance || afterBalance - beforeBalance != amount) revert TransferMismatch();

        paid[subscriptionKey] = true;
        paidCustomerPeriod[customerKey][periodStart] = true;
        emit SubscriptionPaid(subscriptionKey, customerKey, msg.sender, token, amount, periodStart);
    }
}
