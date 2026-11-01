// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLATestBase} from "./ArcSLA.Base.t.sol";

contract ArcSLARefundTest is ArcSLATestBase {
    uint256 internal id;
    uint256 internal exp;

    function setUp() public override {
        super.setUp();
        id = _create();
        exp = uint256(deadline) + 30 days;
    }

    function test_Refund_AtExactlyDeadlineReverts() public {
        vm.warp(deadline);
        vm.expectRevert(ArcSLA.RefundNotAvailable.selector);
        _refund(id);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Active));
    }

    function test_Refund_OneSecondAfterDeadlineSucceeds() public {
        uint256 custBefore = usdc.balanceOf(customer);
        uint256 ts = uint256(deadline) + 1;
        vm.warp(ts);

        vm.expectEmit(true, true, false, true, address(sla));
        emit ArcSLA.AgreementRefunded(id, customer, AMOUNT, uint64(ts));
        _refund(id);

        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Refunded));
        assertEq(usdc.balanceOf(customer), custBefore + AMOUNT);
        assertEq(usdc.balanceOf(address(sla)), 0);
        assertEq(sla.totalEscrowed(), 0);
    }

    function test_Refund_PrematureRevertsRefundNotAvailable() public {
        vm.expectRevert(ArcSLA.RefundNotAvailable.selector);
        _refund(id);
    }

    function test_Refund_NonCustomerRevertsNotCustomer() public {
        vm.warp(uint256(deadline) + 1);
        vm.expectRevert(ArcSLA.NotCustomer.selector);
        vm.prank(stranger);
        sla.refund(id);
        vm.expectRevert(ArcSLA.NotCustomer.selector);
        vm.prank(provider);
        sla.refund(id);
        vm.expectRevert(ArcSLA.NotCustomer.selector);
        vm.prank(verifier);
        sla.refund(id);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Active));
    }

    function test_Refund_RevertsAgreementNotFound() public {
        vm.expectRevert(ArcSLA.AgreementNotFound.selector);
        _refund(2);
        vm.expectRevert(ArcSLA.AgreementNotFound.selector);
        _refund(0);
    }

    function test_Refund_DoubleRefundReverts() public {
        vm.warp(uint256(deadline) + 1);
        _refund(id);
        vm.expectRevert(ArcSLA.AgreementNotActive.selector);
        _refund(id);
        assertEq(usdc.balanceOf(customer), 1e30, "refunded only once");
    }

    function test_Release_AfterRefundReverts() public {
        // Attestation signed in time, but the customer refunds first (after deadline).
        bytes memory sig = _goodSig(id, exp);
        vm.warp(uint256(deadline) + 1);
        _refund(id);
        vm.expectRevert(ArcSLA.AgreementNotActive.selector);
        _submit(id, SPEC, provider, EVIDENCE, exp, sig);
        assertEq(usdc.balanceOf(provider), 0);
    }

    function test_Refund_AfterReleaseReverts() public {
        _release(id, exp);
        vm.warp(uint256(deadline) + 1);
        vm.expectRevert(ArcSLA.AgreementNotActive.selector);
        _refund(id);
        assertEq(usdc.balanceOf(provider), AMOUNT);
        assertEq(usdc.balanceOf(customer), 1e30 - AMOUNT);
    }

    function test_Refund_OnlyAffectsTargetAgreement() public {
        uint256 id2 = _create();
        vm.warp(uint256(deadline) + 1);
        _refund(id);
        assertEq(sla.totalEscrowed(), AMOUNT);
        assertEq(uint8(_status(id2)), uint8(ArcSLA.Status.Active));
        assertEq(usdc.balanceOf(address(sla)), AMOUNT);
    }
}
