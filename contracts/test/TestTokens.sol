// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Plain 6-decimal mintable ERC-20 used as the base of every test token.
contract MintableERC20 is ERC20 {
    constructor() ERC20("Test USDC", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Well-behaved USDC stand-in.
contract TestUSDC is MintableERC20 {}

/// @dev Token whose transfer / transferFrom can be told to revert or return false.
contract FlexToken is MintableERC20 {
    bool public transferReverts;
    bool public transferFromReverts;
    bool public transferReturnsFalse;
    bool public transferFromReturnsFalse;

    function setFlags(bool tRevert, bool tfRevert, bool tFalse, bool tfFalse) external {
        transferReverts = tRevert;
        transferFromReverts = tfRevert;
        transferReturnsFalse = tFalse;
        transferFromReturnsFalse = tfFalse;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (transferReverts) revert("transfer blocked");
        if (transferReturnsFalse) return false;
        return super.transfer(to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (transferFromReverts) revert("transferFrom blocked");
        if (transferFromReturnsFalse) return false;
        return super.transferFrom(from, to, value);
    }
}

/// @dev Fee-on-transfer token: 1% of every transferFrom is burned.
contract FeeToken is MintableERC20 {
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        _spendAllowance(from, msg.sender, value);
        uint256 fee = value / 100;
        _transfer(from, to, value - fee);
        _burn(from, fee);
        return true;
    }
}

/// @dev Malicious token: after a transfer / transferFrom it re-enters `target` with `payload`.
///      The re-entry result is recorded; when `bubble` is set a failed re-entry reverts the outer call.
contract ReentrantToken is MintableERC20 {
    address public target;
    bytes public payload;
    bool public onTransfer;
    bool public onTransferFrom;
    bool public bubble;

    bool public fired;
    bool public reentrySucceeded;
    bytes public reentryReturn;

    function arm(address target_, bytes calldata payload_, bool onTransfer_, bool onTransferFrom_, bool bubble_)
        external
    {
        target = target_;
        payload = payload_;
        onTransfer = onTransfer_;
        onTransferFrom = onTransferFrom_;
        bubble = bubble_;
        fired = false;
        reentrySucceeded = false;
        delete reentryReturn;
    }

    function transfer(address to, uint256 value) public override returns (bool ok) {
        ok = super.transfer(to, value);
        if (onTransfer) _hook();
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool ok) {
        ok = super.transferFrom(from, to, value);
        if (onTransferFrom) _hook();
    }

    function _hook() internal {
        address t = target;
        if (t == address(0)) return;
        target = address(0); // fire once
        (bool ok, bytes memory ret) = t.call(payload);
        fired = true;
        reentrySucceeded = ok;
        reentryReturn = ret;
        if (!ok && bubble) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
