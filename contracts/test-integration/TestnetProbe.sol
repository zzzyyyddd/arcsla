// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcSLA} from "../ArcSLA.sol";

/// @title TestnetProbe
/// @notice READ-ONLY measurement helper. It is never deployed. Its runtime bytecode is injected at
/// a throwaway address through an `eth_call` state override so that SEVERAL calls to the real,
/// deployed ArcSLA run inside ONE simulated call, letting the caller observe state before and
/// after. Nothing it does is ever persisted onchain.
contract TestnetProbe {
    struct Snapshot {
        uint256 totalEscrowed;
        uint256 contractUsdc;
        uint8[] status;
        uint256[] amount;
        bytes32[] evidence;
        uint256[] watched;
    }

    struct StepResult {
        bool ok;
        bytes4 selector;
    }

    function run(
        address sla,
        address usdc,
        uint256[] calldata ids,
        address[] calldata watch,
        bytes[] calldata calls
    ) external returns (Snapshot memory beforeState, StepResult[] memory results, Snapshot memory afterState) {
        beforeState = _snapshot(sla, usdc, ids, watch);

        results = new StepResult[](calls.length);
        for (uint256 i = 0; i < calls.length; i++) {
            (bool ok, bytes memory ret) = sla.call(calls[i]);
            bytes4 sel;
            if (!ok && ret.length >= 4) {
                assembly {
                    sel := mload(add(ret, 32))
                }
            }
            results[i] = StepResult({ok: ok, selector: sel});
        }

        afterState = _snapshot(sla, usdc, ids, watch);
    }

    function _snapshot(address sla, address usdc, uint256[] calldata ids, address[] calldata watch)
        internal
        view
        returns (Snapshot memory s)
    {
        s.totalEscrowed = ArcSLA(sla).totalEscrowed();
        s.contractUsdc = IERC20(usdc).balanceOf(sla);
        s.status = new uint8[](ids.length);
        s.amount = new uint256[](ids.length);
        s.evidence = new bytes32[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) {
            ArcSLA.Agreement memory a = ArcSLA(sla).getAgreement(ids[i]);
            s.status[i] = uint8(a.status);
            s.amount[i] = a.amount;
            s.evidence[i] = a.evidenceHash;
        }
        s.watched = new uint256[](watch.length);
        for (uint256 i = 0; i < watch.length; i++) {
            s.watched[i] = IERC20(usdc).balanceOf(watch[i]);
        }
    }
}
