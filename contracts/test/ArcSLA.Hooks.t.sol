// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLATestBase} from "./ArcSLA.Base.t.sol";
import {HookToken, HookActor} from "./TestTokens2.sol";

/// @dev Malicious PROVIDER / CUSTOMER contracts re-entering from ERC-777-style token hooks, plus
///      read-only-reentrancy checks of what view getters expose mid-callback.
contract ArcSLAHooksTest is ArcSLATestBase {
    HookToken internal ht;
    ArcSLA internal s;
    HookActor internal provActor;
    HookActor internal custActor;
    uint256 internal exp;

    function setUp() public override {
        super.setUp();
        exp = T0 + 1 days;
        ht = new HookToken();
        s = _deployFor(ht);
        provActor = new HookActor();
        custActor = new HookActor();
        ht.mint(address(custActor), 1e30);
        custActor.exec(address(ht), abi.encodeCall(IERC20.approve, (address(s), type(uint256).max)));
    }

    // ---------------------------------------------------------------- helpers

    function _createFor(address prov, address cust) internal returns (uint256 id) {
        vm.prank(cust);
        id = s.createAgreement(prov, verifier, AMOUNT, deadline, SPEC);
    }

    function _sigFor(uint256 id, address prov) internal view returns (bytes memory) {
        return _sign(s, VERIFIER_PK, id, SPEC, prov, EVIDENCE, exp);
    }

    function _releasePayload(uint256 id, address prov) internal view returns (bytes memory) {
        return abi.encodeCall(ArcSLA.release, (id, SPEC, prov, EVIDENCE, exp, _sigFor(id, prov)));
    }

    function _assertBlocked(HookActor a) internal view {
        assertTrue(a.fired(), "hook did not fire");
        assertFalse(a.reentryOk(), "re-entry succeeded");
        assertEq(bytes4(a.reentryRet()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
    }

    function _releaseAs(address by, uint256 id, address prov) internal {
        bytes memory sig = _sigFor(id, prov);
        vm.prank(by);
        s.release(id, SPEC, prov, EVIDENCE, exp, sig);
    }

    // ---------------------------------------------------------------- malicious PROVIDER (hook on release payout)

    function test_Hooks_MaliciousProvider_CannotReenterReleaseSameAgreement() public {
        uint256 id = _createFor(address(provActor), customer);
        provActor.arm(address(s), _releasePayload(id, address(provActor)));
        _releaseAs(submitter, id, address(provActor));
        _assertBlocked(provActor);
        assertEq(provActor.hookCount(), 1);
        assertEq(ht.balanceOf(address(provActor)), AMOUNT, "paid exactly once");
        assertEq(s.totalEscrowed(), 0);
        assertEq(uint8(s.getAgreement(id).status), uint8(ArcSLA.Status.Released));
    }

    function test_Hooks_MaliciousProvider_CannotReenterReleaseOtherAgreement() public {
        uint256 id = _createFor(address(provActor), customer);
        uint256 id2 = _createFor(address(provActor), customer);
        provActor.arm(address(s), _releasePayload(id2, address(provActor)));
        _releaseAs(submitter, id, address(provActor));
        _assertBlocked(provActor);
        assertEq(uint8(s.getAgreement(id2).status), uint8(ArcSLA.Status.Active), "id2 untouched");
        assertEq(ht.balanceOf(address(provActor)), AMOUNT);
        assertEq(s.totalEscrowed(), AMOUNT);
    }

    function test_Hooks_MaliciousProvider_CannotReenterRefundOrCreate() public {
        uint256 id = _createFor(address(provActor), customer);
        uint256 id2 = _createFor(address(provActor), customer);
        // refund attempt of the OTHER agreement (provider is not its customer, guard fires first anyway)
        provActor.arm(address(s), abi.encodeCall(ArcSLA.refund, (id2)));
        _releaseAs(submitter, id, address(provActor));
        _assertBlocked(provActor);
        assertEq(uint8(s.getAgreement(id2).status), uint8(ArcSLA.Status.Active));

        // createAgreement attempt (provider contract holds tokens + allowance, so only the guard stops it)
        ht.mint(address(provActor), 10 * AMOUNT);
        provActor.exec(address(ht), abi.encodeCall(IERC20.approve, (address(s), type(uint256).max)));
        provActor.arm(
            address(s), abi.encodeCall(ArcSLA.createAgreement, (customer, verifier, AMOUNT, deadline, SPEC))
        );
        _releaseAs(submitter, id2, address(provActor));
        _assertBlocked(provActor);
        assertEq(s.agreementCount(), 2, "no agreement created from the callback");
        assertEq(s.totalEscrowed(), 0);
    }

    function test_Hooks_MaliciousProvider_ReadOnlyViewDuringPayoutIsConsistent() public {
        uint256 id = _createFor(address(provActor), customer);
        _createFor(address(provActor), customer); // keep escrow non-zero so totalEscrowed isn't trivially 0
        provActor.watchState(s, id, IERC20(address(ht)));
        _releaseAs(submitter, id, address(provActor));
        assertTrue(provActor.snapped());
        assertEq(provActor.snapStatus(), uint8(ArcSLA.Status.Released), "status already Released in callback");
        assertEq(provActor.snapEscrowed(), AMOUNT, "totalEscrowed already decremented");
        assertEq(provActor.snapSlaBalance(), AMOUNT, "contract balance already decreased (1 agreement left)");
        assertFalse(provActor.snapRefundable(), "never refundable once Released");
        assertGe(provActor.snapSlaBalance(), provActor.snapEscrowed(), "balance >= escrowed during callback");
    }

    // ---------------------------------------------------------------- malicious CUSTOMER (hook on refund payout)

    function _refundAsCustActor(uint256 id) internal {
        (bool ok,) =
            custActor.exec(address(s), abi.encodeCall(ArcSLA.refund, (id)));
        assertTrue(ok, "outer refund must succeed");
    }

    function test_Hooks_MaliciousCustomer_CannotReenterRefundSameAgreement() public {
        uint256 id = _createFor(provider, address(custActor));
        vm.warp(uint256(deadline) + 1);
        uint256 c0 = ht.balanceOf(address(custActor));
        custActor.arm(address(s), abi.encodeCall(ArcSLA.refund, (id)));
        _refundAsCustActor(id);
        _assertBlocked(custActor);
        assertEq(ht.balanceOf(address(custActor)), c0 + AMOUNT, "refunded exactly once");
        assertEq(s.totalEscrowed(), 0);
    }

    function test_Hooks_MaliciousCustomer_CannotReenterRefundOtherAgreement() public {
        uint256 id = _createFor(provider, address(custActor));
        uint256 id2 = _createFor(provider, address(custActor));
        vm.warp(uint256(deadline) + 1);
        custActor.arm(address(s), abi.encodeCall(ArcSLA.refund, (id2)));
        _refundAsCustActor(id);
        _assertBlocked(custActor);
        assertEq(uint8(s.getAgreement(id2).status), uint8(ArcSLA.Status.Active));
        assertEq(s.totalEscrowed(), AMOUNT);
        assertEq(ht.balanceOf(address(s)), AMOUNT);
    }

    function test_Hooks_MaliciousCustomer_CannotReenterReleaseOfOtherAgreement() public {
        uint256 id = _createFor(provider, address(custActor));
        uint256 id2 = _createFor(provider, address(custActor));
        bytes memory payload = _releasePayload(id2, provider); // signed while still valid
        vm.warp(uint256(deadline) + 1);
        custActor.arm(address(s), payload);
        _refundAsCustActor(id);
        _assertBlocked(custActor);
        assertEq(uint8(s.getAgreement(id2).status), uint8(ArcSLA.Status.Active));
        assertEq(ht.balanceOf(provider), 0);
    }

    function test_Hooks_MaliciousCustomer_CannotReenterCreateFromRefundCallback() public {
        uint256 id = _createFor(provider, address(custActor));
        vm.warp(uint256(deadline) + 1);
        custActor.arm(
            address(s),
            abi.encodeCall(
                ArcSLA.createAgreement, (provider, verifier, AMOUNT, uint64(block.timestamp + 1 days), SPEC)
            )
        );
        _refundAsCustActor(id);
        _assertBlocked(custActor);
        assertEq(s.agreementCount(), 1);
        assertEq(s.totalEscrowed(), 0);
    }

    function test_Hooks_MaliciousCustomer_ReadOnlyViewDuringRefundIsConsistent() public {
        uint256 id = _createFor(provider, address(custActor));
        _createFor(provider, address(custActor));
        vm.warp(uint256(deadline) + 1);
        custActor.watchState(s, id, IERC20(address(ht)));
        _refundAsCustActor(id);
        assertTrue(custActor.snapped());
        assertEq(custActor.snapStatus(), uint8(ArcSLA.Status.Refunded), "status already Refunded in callback");
        assertEq(custActor.snapEscrowed(), AMOUNT, "totalEscrowed already decremented");
        assertEq(custActor.snapSlaBalance(), AMOUNT, "balance already decreased");
        assertFalse(custActor.snapRefundable(), "no longer refundable mid-callback (no second refund)");
    }

    // ---------------------------------------------------------------- malicious CUSTOMER (hook on create's pull)

    function _createAsCustActor() internal returns (uint256 id) {
        (bool ok, bytes memory ret) = custActor.exec(
            address(s), abi.encodeCall(ArcSLA.createAgreement, (provider, verifier, AMOUNT, deadline, SPEC))
        );
        assertTrue(ok, "outer create must succeed");
        id = abi.decode(ret, (uint256));
    }

    function test_Hooks_MaliciousCustomer_CreatePullCallback_CannotReenterCreate() public {
        custActor.arm(
            address(s), abi.encodeCall(ArcSLA.createAgreement, (provider, verifier, AMOUNT, deadline, SPEC))
        );
        uint256 id = _createAsCustActor();
        _assertBlocked(custActor);
        assertEq(id, 1);
        assertEq(s.agreementCount(), 1);
        assertEq(s.totalEscrowed(), AMOUNT);
        assertEq(ht.balanceOf(address(s)), AMOUNT);
    }

    function test_Hooks_MaliciousCustomer_CreatePullCallback_CannotReleaseOrRefundNewAgreement() public {
        // id 1 will exist (state written before the pull); its valid release signature is pre-built
        custActor.arm(address(s), _releasePayload(1, provider));
        uint256 id = _createAsCustActor();
        _assertBlocked(custActor);
        assertEq(ht.balanceOf(provider), 0);
        assertEq(uint8(s.getAgreement(id).status), uint8(ArcSLA.Status.Active));

        custActor.arm(address(s), abi.encodeCall(ArcSLA.refund, (2)));
        uint256 id2 = _createAsCustActor();
        assertEq(id2, 2);
        _assertBlocked(custActor);
        assertEq(uint8(s.getAgreement(id2).status), uint8(ArcSLA.Status.Active));
        assertEq(s.totalEscrowed(), 2 * AMOUNT);
        assertEq(ht.balanceOf(address(s)), 2 * AMOUNT);
    }

    /// @dev OBSERVATION (informational): createAgreement writes the agreement and bumps totalEscrowed
    ///      BEFORE pulling tokens, so a read-only observer inside the sender hook of the pull sees an
    ///      Active agreement whose funds have not arrived (balance + AMOUNT == totalEscrowed). It is
    ///      transient (reverts the whole tx if the pull is short) and unexploitable through ArcSLA's
    ///      own functions (nonReentrant), but a third-party integrator reading ArcSLA mid-callback
    ///      could be misled. Release / refund have no such window (checked above).
    function test_Hooks_CreatePullCallback_ReadOnlyViewShowsTransientPrePullState() public {
        custActor.watchState(s, 1, IERC20(address(ht)));
        uint256 id = _createAsCustActor();
        assertEq(id, 1);
        assertTrue(custActor.snapped());
        assertEq(custActor.snapStatus(), uint8(ArcSLA.Status.Active));
        assertEq(custActor.snapEscrowed(), AMOUNT);
        assertEq(custActor.snapSlaBalance() + AMOUNT, custActor.snapEscrowed(), "funds not yet pulled in hook");
        // settled state is consistent
        assertEq(ht.balanceOf(address(s)), s.totalEscrowed());
    }
}
