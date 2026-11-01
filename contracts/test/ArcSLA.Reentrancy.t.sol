// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLATestBase} from "./ArcSLA.Base.t.sol";
import {ReentrantToken} from "./TestTokens.sol";

/// @dev A malicious token re-enters ArcSLA from inside transfer / transferFrom. The payloads are
///      fully valid calls (valid signatures, correct customer-less args) so only the guard stops them.
contract ArcSLAReentrancyTest is ArcSLATestBase {
    ReentrantToken internal rt;
    ArcSLA internal slaR;
    uint256 internal exp;

    function setUp() public override {
        super.setUp();
        exp = T0 + 1 days;
        rt = new ReentrantToken();
        slaR = _deployFor(rt);
    }

    function _releasePayload(uint256 id) internal view returns (bytes memory) {
        bytes memory sig = _sign(slaR, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp);
        return abi.encodeCall(ArcSLA.release, (id, SPEC, provider, EVIDENCE, exp, sig));
    }

    function _refundPayload(uint256 id) internal pure returns (bytes memory) {
        return abi.encodeCall(ArcSLA.refund, (id));
    }

    function _createPayload() internal view returns (bytes memory) {
        return abi.encodeCall(ArcSLA.createAgreement, (provider, verifier, AMOUNT, deadline, SPEC));
    }

    function _assertBlocked() internal view {
        assertTrue(rt.fired(), "hook did not fire");
        assertFalse(rt.reentrySucceeded(), "re-entry succeeded");
        assertEq(bytes4(rt.reentryReturn()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function _releaseOuter(uint256 id) internal {
        bytes memory sig = _sign(slaR, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp);
        vm.prank(submitter);
        slaR.release(id, SPEC, provider, EVIDENCE, exp, sig);
    }

    function _assertReleasedOnce(uint256 id) internal view {
        assertEq(uint8(slaR.getAgreement(id).status), uint8(ArcSLA.Status.Released));
        assertEq(rt.balanceOf(provider), AMOUNT, "provider paid exactly once");
        assertEq(slaR.totalEscrowed(), 0);
        assertEq(slaR.agreementCount(), 1, "no extra agreement");
    }

    // ------------------------------------------------------ during release's transfer

    function test_Reentrancy_ReleaseHookCannotReenterRelease() public {
        uint256 id = _createOn(slaR, customer);
        rt.arm(address(slaR), _releasePayload(id), true, false, false);
        _releaseOuter(id);
        _assertBlocked();
        _assertReleasedOnce(id);
    }

    function test_Reentrancy_ReleaseHookCannotReenterRefund() public {
        uint256 id = _createOn(slaR, customer);
        // refund by the token acting as customer would fail NotCustomer anyway, so make the token the customer
        rt.mint(address(rt), 2 * AMOUNT);
        vm.prank(address(rt));
        rt.approve(address(slaR), type(uint256).max);
        vm.prank(address(rt));
        uint256 tokId = slaR.createAgreement(provider, verifier, AMOUNT, uint64(T0 + 1 hours), SPEC);
        vm.warp(T0 + 2 hours); // tokId is now refundable by the token; id's deadline still open? (7d) yes
        rt.arm(address(slaR), _refundPayload(tokId), true, false, false);
        // outer: release `id` (deadline 7d) -> transfer hook tries refund(tokId) from the token (its customer)
        bytes memory sig = _sign(slaR, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp + 1 days);
        vm.prank(submitter);
        slaR.release(id, SPEC, provider, EVIDENCE, exp + 1 days, sig);
        _assertBlocked();
        assertEq(uint8(slaR.getAgreement(tokId).status), uint8(ArcSLA.Status.Active), "refund blocked");
        assertEq(uint8(slaR.getAgreement(id).status), uint8(ArcSLA.Status.Released));
    }

    function test_Reentrancy_ReleaseHookCannotReenterCreateAgreement() public {
        uint256 id = _createOn(slaR, customer);
        rt.arm(address(slaR), _createPayload(), true, false, false);
        _releaseOuter(id);
        _assertBlocked();
        _assertReleasedOnce(id);
    }

    function test_Reentrancy_ReleaseHookReentryBubblesAndRevertsWholeRelease() public {
        uint256 id = _createOn(slaR, customer);
        rt.arm(address(slaR), _releasePayload(id), true, false, true);
        bytes memory sig = _sign(slaR, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(submitter);
        slaR.release(id, SPEC, provider, EVIDENCE, exp, sig);
        assertEq(uint8(slaR.getAgreement(id).status), uint8(ArcSLA.Status.Active));
        assertEq(slaR.totalEscrowed(), AMOUNT);
    }

    // ------------------------------------------------------ during refund's transfer

    function test_Reentrancy_RefundHookCannotReenterRefund() public {
        uint256 id = _createOn(slaR, customer);
        uint256 id2 = _createOn(slaR, customer);
        vm.warp(uint256(deadline) + 1);
        // customer refunds id; during that transfer the token re-enters refund(id).
        // The guard must stop it before any state check.
        rt.arm(address(slaR), _refundPayload(id), true, false, false);
        vm.prank(customer);
        slaR.refund(id);
        _assertBlocked();
        assertEq(uint8(slaR.getAgreement(id).status), uint8(ArcSLA.Status.Refunded));
        assertEq(uint8(slaR.getAgreement(id2).status), uint8(ArcSLA.Status.Active));
        assertEq(slaR.totalEscrowed(), AMOUNT);
        assertEq(rt.balanceOf(address(slaR)), AMOUNT);
    }

    function test_Reentrancy_RefundHookCannotReenterRelease() public {
        uint256 id = _createOn(slaR, customer);
        uint256 id2 = _createOn(slaR, customer);
        // A fully signed release for id2, built while it was still valid. Refunding `id` after the
        // deadline re-enters release(id2); the guard rejects it before any time/state check.
        bytes memory payload = _releasePayload(id2);
        vm.warp(uint256(deadline) + 1);
        rt.arm(address(slaR), payload, true, false, false);
        vm.prank(customer);
        slaR.refund(id);
        _assertBlocked();
        assertEq(uint8(slaR.getAgreement(id).status), uint8(ArcSLA.Status.Refunded));
        assertEq(uint8(slaR.getAgreement(id2).status), uint8(ArcSLA.Status.Active));
        assertEq(rt.balanceOf(provider), 0);
    }

    function test_Reentrancy_RefundHookCannotReenterCreateAgreement() public {
        uint256 id = _createOn(slaR, customer);
        vm.warp(uint256(deadline) + 1);
        rt.arm(address(slaR), _createPayload(), true, false, false);
        vm.prank(customer);
        slaR.refund(id);
        _assertBlocked();
        assertEq(slaR.agreementCount(), 1);
        assertEq(slaR.totalEscrowed(), 0);
    }

    // ------------------------------------------------------ during create's transferFrom

    function test_Reentrancy_CreateHookCannotReenterCreateAgreement() public {
        rt.arm(address(slaR), _createPayload(), false, true, false);
        uint256 id = _createOn(slaR, customer);
        _assertBlocked();
        assertEq(id, 1);
        assertEq(slaR.agreementCount(), 1);
        assertEq(slaR.totalEscrowed(), AMOUNT);
        assertEq(rt.balanceOf(address(slaR)), AMOUNT);
    }

    function test_Reentrancy_CreateHookCannotReenterRelease() public {
        // agreement #1 is stored before the token pull, so a valid signature for id 1 would pay out
        // from inside the pull if the guard were absent.
        rt.arm(address(slaR), _releasePayload(1), false, true, false);
        uint256 id = _createOn(slaR, customer);
        _assertBlocked();
        assertEq(uint8(slaR.getAgreement(id).status), uint8(ArcSLA.Status.Active));
        assertEq(rt.balanceOf(provider), 0);
        assertEq(slaR.totalEscrowed(), AMOUNT);
    }

    function test_Reentrancy_CreateHookCannotReenterRefund() public {
        rt.arm(address(slaR), _refundPayload(1), false, true, false);
        uint256 id = _createOn(slaR, customer);
        _assertBlocked();
        assertEq(uint8(slaR.getAgreement(id).status), uint8(ArcSLA.Status.Active));
        assertEq(slaR.totalEscrowed(), AMOUNT);
    }

    function test_Reentrancy_CreateHookReentryBubblesAndRevertsWholeCreate() public {
        rt.arm(address(slaR), _createPayload(), false, true, true);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vm.prank(customer);
        slaR.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);
        assertEq(slaR.agreementCount(), 0);
        assertEq(slaR.totalEscrowed(), 0);
    }
}
