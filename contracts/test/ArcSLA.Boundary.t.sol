// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLAAdvBase} from "./ArcSLA.AdvBase.t.sol";

/// @dev Exact-second boundary behaviour of release / refund / attestation expiry.
contract ArcSLABoundaryTest is ArcSLAAdvBase {
    function _tryRelease(uint256 id_, uint256 expiry) internal returns (bool ok) {
        bytes memory sig = _sign(sla, VERIFIER_PK, id_, SPEC, provider, EVIDENCE, expiry);
        vm.prank(submitter);
        try sla.release(id_, SPEC, provider, EVIDENCE, expiry, sig) {
            ok = true;
        } catch {}
    }

    function _tryRefund(uint256 id_) internal returns (bool ok) {
        vm.prank(customer);
        try sla.refund(id_) {
            ok = true;
        } catch {}
    }

    function _createWithDeadline(uint64 dl) internal returns (uint256) {
        vm.prank(customer);
        return sla.createAgreement(provider, verifier, AMOUNT, dl, SPEC);
    }

    // ------------------------------------------------------------ release / refund at the deadline

    function test_Time_ReleaseAtDeadlineSucceeds() public {
        vm.warp(deadline);
        _release(id, type(uint256).max);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
    }

    function test_Time_ReleaseAtDeadlinePlusOneRevertsDeadlinePassed() public {
        vm.warp(uint256(deadline) + 1);
        bytes memory sig = _goodSig(id, type(uint256).max);
        vm.expectRevert(ArcSLA.DeadlinePassed.selector);
        _submit(id, SPEC, provider, EVIDENCE, type(uint256).max, sig);
        _assertStillActive(id);
    }

    function test_Time_RefundAtDeadlineRevertsRefundNotAvailable() public {
        vm.warp(deadline);
        vm.expectRevert(ArcSLA.RefundNotAvailable.selector);
        vm.prank(customer);
        sla.refund(id);
        assertFalse(sla.isRefundable(id));
        _assertStillActive(id);
    }

    function test_Time_RefundAtDeadlinePlusOneSucceeds() public {
        vm.warp(uint256(deadline) + 1);
        assertTrue(sla.isRefundable(id));
        uint256 before_ = usdc.balanceOf(customer);
        _refund(id);
        assertEq(usdc.balanceOf(customer), before_ + AMOUNT);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Refunded));
    }

    function test_Time_ReleaseAtCreationTimestampSucceeds() public {
        // same block timestamp as creation
        _release(id, exp);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
        assertEq(sla.getAgreement(id).createdAt, T0);
    }

    // ------------------------------------------------------------ deadline = createdAt + 1

    function test_Time_DeadlineCreatedAtPlusOne_FullTimeline() public {
        uint256 a = _createWithDeadline(uint64(T0 + 1));
        uint256 b = _createWithDeadline(uint64(T0 + 1));
        assertEq(sla.getAgreement(a).deadline, sla.getAgreement(a).createdAt + 1);

        // at createdAt: release possible, refund not
        assertFalse(sla.isRefundable(a));
        vm.expectRevert(ArcSLA.RefundNotAvailable.selector);
        vm.prank(customer);
        sla.refund(a);

        // at createdAt+1 (== deadline): release still possible (inclusive), refund still not
        vm.warp(T0 + 1);
        assertFalse(sla.isRefundable(a));
        vm.expectRevert(ArcSLA.RefundNotAvailable.selector);
        vm.prank(customer);
        sla.refund(a);
        _release(a, T0 + 1);
        assertEq(uint8(_status(a)), uint8(ArcSLA.Status.Released));

        // at createdAt+2: release impossible, refund possible
        vm.warp(T0 + 2);
        bytes memory sig = _goodSig(b, T0 + 2);
        vm.expectRevert(ArcSLA.DeadlinePassed.selector);
        _submit(b, SPEC, provider, EVIDENCE, T0 + 2, sig);
        assertTrue(sla.isRefundable(b));
        _refund(b);
        assertEq(uint8(_status(b)), uint8(ArcSLA.Status.Refunded));
    }

    // ------------------------------------------------------------ attestation expiry boundary

    function test_Time_AttestationExpiryBoundary() public {
        uint256 e = T0 + 1 hours;
        // at exactly expiry: ok
        vm.warp(e);
        uint256 id2 = _create();
        _release(id, e);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
        // one second after expiry: AttestationExpired (deadline still far away)
        vm.warp(e + 1);
        bytes memory sig = _goodSig(id2, e);
        vm.expectRevert(ArcSLA.AttestationExpired.selector);
        _submit(id2, SPEC, provider, EVIDENCE, e, sig);
        _assertAgreementActive(id2);
        // a fresh attestation with later expiry works
        _release(id2, e + 1);
        assertEq(uint8(_status(id2)), uint8(ArcSLA.Status.Released));
    }

    function test_Time_AttestationExpiryInThePastAtSubmissionReverts() public {
        vm.warp(T0 + 100);
        bytes memory sig = _goodSig(id, T0 + 99);
        vm.expectRevert(ArcSLA.AttestationExpired.selector);
        _submit(id, SPEC, provider, EVIDENCE, T0 + 99, sig);
        sig = _goodSig(id, 0);
        vm.expectRevert(ArcSLA.AttestationExpired.selector);
        _submit(id, SPEC, provider, EVIDENCE, 0, sig);
        _assertStillActive(id);
    }

    function test_Time_ExpiryBeforeDeadline_ReleaseOnlyUntilExpiry() public {
        uint256 e = T0 + 2 days; // < deadline (7d)
        vm.warp(e);
        assertTrue(_tryRelease(id, e));
    }

    function test_Time_ExpiryBeforeDeadline_AfterExpiryRevertsAttestationExpired() public {
        uint256 e = T0 + 2 days;
        vm.warp(e + 1);
        bytes memory sig = _goodSig(id, e);
        vm.expectRevert(ArcSLA.AttestationExpired.selector);
        _submit(id, SPEC, provider, EVIDENCE, e, sig);
        // not refundable either: deadline not reached -> funds locked until deadline (documented trust model)
        assertFalse(sla.isRefundable(id));
    }

    function test_Time_ExpiryAfterDeadline_ReleaseAfterDeadlineRevertsDeadlinePassedNotExpired() public {
        uint256 e = uint256(deadline) + 5 days;
        vm.warp(uint256(deadline) + 1);
        bytes memory sig = _goodSig(id, e);
        vm.expectRevert(ArcSLA.DeadlinePassed.selector);
        _submit(id, SPEC, provider, EVIDENCE, e, sig);
        _assertStillActive(id);
    }

    function test_Time_ExpiryEqualsDeadline_BoundaryBothInclusive() public {
        vm.warp(deadline);
        _release(id, deadline);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
    }

    function test_Time_ExpiryAfterDeadline_ReleaseAtDeadlineSucceeds() public {
        vm.warp(deadline);
        _release(id, uint256(deadline) + 1 days);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
    }

    function test_Time_ExpiryBelowDeadline_ReleaseAtDeadlineRevertsAttestationExpired() public {
        vm.warp(deadline);
        bytes memory sig = _goodSig(id, uint256(deadline) - 1);
        vm.expectRevert(ArcSLA.AttestationExpired.selector);
        _submit(id, SPEC, provider, EVIDENCE, uint256(deadline) - 1, sig);
    }

    function _assertAgreementActive(uint256 id_) internal view {
        assertEq(uint8(_status(id_)), uint8(ArcSLA.Status.Active));
    }

    // ------------------------------------------------------------ fuzz: release XOR refund

    /// @dev For an Active agreement at ANY timestamp t >= creation, exactly one of {release possible,
    ///      refund possible} holds; never both, never neither (with a non-expiring attestation).
    function _exclusiveAt(uint256 t) internal {
        vm.warp(t);
        uint256 snap = vm.snapshotState();
        bool canRelease = _tryRelease(id, type(uint256).max);
        vm.revertToState(snap);
        vm.warp(t);
        snap = vm.snapshotState();
        bool canRefund = _tryRefund(id);
        vm.revertToState(snap);
        vm.warp(t);

        assertTrue(canRelease != canRefund, "exactly one of release/refund must be possible");
        assertEq(canRelease, t <= deadline, "release iff t <= deadline");
        assertEq(canRefund, t > deadline, "refund iff t > deadline");
        assertEq(sla.isRefundable(id), canRefund, "isRefundable agrees");
    }

    function testFuzz_Time_ExactlyOneOfReleaseOrRefund_NearDeadline(uint256 t) public {
        t = bound(t, T0, uint256(deadline) + 30 days);
        _exclusiveAt(t);
    }

    function testFuzz_Time_ExactlyOneOfReleaseOrRefund_AnyFutureTime(uint256 t) public {
        t = bound(t, T0, type(uint64).max);
        _exclusiveAt(t);
    }

    function testFuzz_Time_ExactlyOneAroundDeadlineWindow(uint8 off) public {
        _exclusiveAt(uint256(deadline) - 3 + (off % 7));
    }

    function testFuzz_Time_RandomDeadlineWindow(uint32 dlOffset, uint32 dt) public {
        uint64 dl = uint64(T0 + 1 + (uint256(dlOffset) % 365 days));
        uint256 id2 = _createWithDeadline(dl);
        uint256 t = T0 + (uint256(dt) % (400 days));
        vm.warp(t);
        bool canRelease = _tryReleaseSnap(id2);
        vm.warp(t);
        bool canRefund = _tryRefundSnap(id2);
        vm.warp(t);
        assertTrue(canRelease != canRefund);
        assertEq(canRelease, t <= dl);
    }

    function _tryReleaseSnap(uint256 id_) internal returns (bool ok) {
        uint256 s = vm.snapshotState();
        ok = _tryRelease(id_, type(uint256).max);
        vm.revertToState(s);
    }

    function _tryRefundSnap(uint256 id_) internal returns (bool ok) {
        uint256 s = vm.snapshotState();
        ok = _tryRefund(id_);
        vm.revertToState(s);
    }
}
