// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ReentrantToken {
    string public constant name = "Reentrant Test Token";
    string public constant symbol = "rTEST";
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    address public target;
    bytes public attackData;
    bool public attackEnabled;
    bool private entered;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        _attack();
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        allowance[from][msg.sender] = allowed - amount;
        _move(from, to, amount);
        _attack();
        return true;
    }

    function configureAttack(address target_, bytes calldata data_, bool enabled) external {
        target = target_;
        attackData = data_;
        attackEnabled = enabled;
    }

    function _move(address from, address to, uint256 amount) internal {
        require(balanceOf[from] >= amount, "balance");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }

    function _attack() internal {
        if (!attackEnabled || entered || target == address(0)) return;
        entered = true;
        target.call(attackData);
        entered = false;
    }
}
