// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcSLA} from "../ArcSLA.sol";
import {MintableERC20} from "./TestTokens.sol";

/// @dev Circle-style token: per-address blocklist plus a global pause, both enforced on every movement.
contract BlocklistToken is MintableERC20 {
    mapping(address => bool) public blocked;
    bool public paused;

    function setBlocked(address a, bool b) external {
        blocked[a] = b;
    }

    function setPaused(bool p) external {
        paused = p;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (paused) revert("paused");
        if (blocked[from]) revert("sender blocklisted");
        if (blocked[to]) revert("recipient blocklisted");
        super._update(from, to, value);
    }
}

/// @dev USDT-style token: transfer / transferFrom / approve return NOTHING.
contract NoReturnToken {
    string public constant name = "NoReturn";
    string public constant symbol = "NRT";
    uint8 public constant decimals = 6;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 v) external {
        balanceOf[to] += v;
        totalSupply += v;
    }

    function approve(address spender, uint256 v) external {
        allowance[msg.sender][spender] = v;
    }

    function transfer(address to, uint256 v) external {
        balanceOf[msg.sender] -= v;
        balanceOf[to] += v;
    }

    function transferFrom(address from, address to, uint256 v) external {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - v;
        balanceOf[from] -= v;
        balanceOf[to] += v;
    }
}

/// @dev Pulls one base unit LESS than requested but still reports success.
contract ShortPullToken is MintableERC20 {
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        _spendAllowance(from, msg.sender, value);
        _transfer(from, to, value - 1);
        return true;
    }
}

/// @dev Rebasing / inflating token: credits the recipient one base unit MORE than requested.
contract InflatingToken is MintableERC20 {
    function transferFrom(address from, address to, uint256 value) public override returns (bool ok) {
        ok = super.transferFrom(from, to, value);
        _mint(to, 1);
    }
}

/// @dev ERC-777-flavoured token: calls tokensToSend on the sender before and tokensReceived on the
///      recipient after every movement (failures of non-implementers are ignored).
contract HookToken is MintableERC20 {
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && from.code.length > 0) {
            // solhint-disable-next-line avoid-low-level-calls
            (bool ok1,) = from.call(abi.encodeWithSignature("tokensToSend(address,address,uint256)", from, to, value));
        }
        super._update(from, to, value);
        if (to != address(0) && to.code.length > 0) {
            (bool ok2,) = to.call(abi.encodeWithSignature("tokensReceived(address,address,uint256)", from, to, value));
        }
    }
}

/// @dev A contract usable as customer or provider. On the first token hook it (a) snapshots ArcSLA's
///      externally visible state and (b) fires one armed re-entry attempt.
contract HookActor {
    address public target;
    bytes public payload;
    bool public armed;

    bool public fired;
    bool public reentryOk;
    bytes public reentryRet;
    uint256 public hookCount;

    ArcSLA public watch;
    uint256 public watchId;
    bool public snapped;
    uint8 public snapStatus;
    uint256 public snapEscrowed;
    uint256 public snapSlaBalance;
    bool public snapRefundable;
    IERC20 public watchToken;

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
        fired = false;
        reentryOk = false;
        delete reentryRet;
    }

    function watchState(ArcSLA s, uint256 id, IERC20 token) external {
        watch = s;
        watchId = id;
        watchToken = token;
        snapped = false;
    }

    function exec(address t, bytes calldata data) external returns (bool ok, bytes memory ret) {
        (ok, ret) = t.call(data);
    }

    function tokensToSend(address, address, uint256) external {
        _fire();
    }

    function tokensReceived(address, address, uint256) external {
        _fire();
    }

    function _fire() internal {
        ++hookCount;
        if (address(watch) != address(0) && !snapped) {
            snapped = true;
            snapStatus = uint8(watch.getAgreement(watchId).status);
            snapEscrowed = watch.totalEscrowed();
            snapRefundable = watch.isRefundable(watchId);
            snapSlaBalance = watchToken.balanceOf(address(watch));
        }
        if (armed) {
            armed = false;
            (reentryOk, reentryRet) = target.call(payload);
            fired = true;
        }
    }
}
