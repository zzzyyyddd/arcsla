// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLATestBase} from "./ArcSLA.Base.t.sol";

/// @notice Proves the contract has no minimum escrow that would reject the 0.01 USDC proof-of-concept
///         amount (10_000 units at 6 decimals), and that the full lifecycle works at that size.
contract ArcSLAPocAmountTest is ArcSLATestBase {
    uint256 internal constant POC_AMOUNT = 10_000; // 0.01 USDC

    function _createPoc(uint256 amount) internal returns (uint256) {
        vm.prank(customer);
        return sla.createAgreement(provider, verifier, amount, deadline, SPEC);
    }

    function test_Poc_PointZeroOneUsdc_CreateAndRelease() public {
        uint256 id = _createPoc(POC_AMOUNT);
        assertEq(sla.getAgreement(id).amount, POC_AMOUNT);
        assertEq(sla.totalEscrowed(), POC_AMOUNT);
        assertEq(usdc.balanceOf(address(sla)), POC_AMOUNT);

        uint256 exp = T0 + 1 hours;
        bytes memory sig = _sign(sla, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp);
        vm.prank(stranger);
        sla.release(id, SPEC, provider, EVIDENCE, exp, sig);

        assertEq(uint8(sla.getAgreement(id).status), uint8(ArcSLA.Status.Released));
        assertEq(usdc.balanceOf(provider), POC_AMOUNT);
        assertEq(usdc.balanceOf(address(sla)), 0);
        assertEq(sla.totalEscrowed(), 0);
    }

    function test_Poc_PointZeroOneUsdc_CreateAndRefundAfterDeadline() public {
        uint256 id = _createPoc(POC_AMOUNT);
        uint256 before_ = usdc.balanceOf(customer);
        vm.warp(deadline + 1);
        vm.prank(customer);
        sla.refund(id);
        assertEq(uint8(sla.getAgreement(id).status), uint8(ArcSLA.Status.Refunded));
        assertEq(usdc.balanceOf(customer), before_ + POC_AMOUNT);
        assertEq(usdc.balanceOf(address(sla)), 0);
        assertEq(sla.totalEscrowed(), 0);
    }

    function test_Poc_OnlyZeroIsRejected_OneUnitIsAccepted() public {
        vm.prank(customer);
        vm.expectRevert(ArcSLA.ZeroAmount.selector);
        sla.createAgreement(provider, verifier, 0, deadline, SPEC);
        // The smallest USDC unit (0.000001) is accepted, so there is no minimum above zero.
        uint256 id = _createPoc(1);
        assertEq(sla.getAgreement(id).amount, 1);
    }
}
