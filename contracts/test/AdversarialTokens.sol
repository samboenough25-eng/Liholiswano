// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface ILiholiswanoProbe { function restoreCollateral(uint256) external; }

contract FalseReturnToken {
    string public constant name="False"; string public constant symbol="FALSE"; uint8 public constant decimals=6;
    mapping(address=>uint256) public balanceOf; mapping(address=>mapping(address=>uint256)) public allowance;
    constructor(address to,uint256 amount){balanceOf[to]=amount;}
    function approve(address s,uint256 a) external returns(bool){allowance[msg.sender][s]=a;return true;}
    function transfer(address to,uint256 a) external returns(bool){require(balanceOf[msg.sender]>=a);balanceOf[msg.sender]-=a;balanceOf[to]+=a;return false;}
    function transferFrom(address f,address to,uint256 a) external returns(bool){require(allowance[f][msg.sender]>=a&&balanceOf[f]>=a);allowance[f][msg.sender]-=a;balanceOf[f]-=a;balanceOf[to]+=a;return false;}
}

contract NoReturnToken {
    mapping(address=>uint256) public balanceOf; mapping(address=>mapping(address=>uint256)) public allowance;
    constructor(address to,uint256 amount){balanceOf[to]=amount;}
    function approve(address s,uint256 a) external {allowance[msg.sender][s]=a;}
    function transfer(address to,uint256 a) external {require(balanceOf[msg.sender]>=a);balanceOf[msg.sender]-=a;balanceOf[to]+=a;}
    function transferFrom(address f,address to,uint256 a) external {require(allowance[f][msg.sender]>=a&&balanceOf[f]>=a);allowance[f][msg.sender]-=a;balanceOf[f]-=a;balanceOf[to]+=a;}
}

contract FeeToken {
    mapping(address=>uint256) public balanceOf; mapping(address=>mapping(address=>uint256)) public allowance;
    constructor(address to,uint256 amount){balanceOf[to]=amount;}
    function approve(address s,uint256 a) external returns(bool){allowance[msg.sender][s]=a;return true;}
    function transfer(address to,uint256 a) external returns(bool){return _move(msg.sender,to,a);}
    function transferFrom(address f,address to,uint256 a) external returns(bool){require(allowance[f][msg.sender]>=a);allowance[f][msg.sender]-=a;return _move(f,to,a);}
    function _move(address f,address to,uint256 a) internal returns(bool){require(balanceOf[f]>=a);uint256 fee=a/100;balanceOf[f]-=a;balanceOf[to]+=a-fee;balanceOf[address(0)]+=fee;return true;}
}

contract ReentrantToken {
    mapping(address=>uint256) public balanceOf; mapping(address=>mapping(address=>uint256)) public allowance;
    address public target; bool public attempted;
    constructor(address to,uint256 amount){balanceOf[to]=amount;}
    function setTarget(address t) external {target=t;}
    function approve(address s,uint256 a) external returns(bool){allowance[msg.sender][s]=a;return true;}
    function transfer(address to,uint256 a) external returns(bool){_move(msg.sender,to,a);return true;}
    function transferFrom(address f,address to,uint256 a) external returns(bool){
        require(allowance[f][msg.sender]>=a&&balanceOf[f]>=a); allowance[f][msg.sender]-=a;
        if(target!=address(0)){attempted=true; try ILiholiswanoProbe(target).restoreCollateral(1) {} catch {}}
        _move(f,to,a); return true;
    }
    function _move(address f,address to,uint256 a) internal {balanceOf[f]-=a;balanceOf[to]+=a;}
}
