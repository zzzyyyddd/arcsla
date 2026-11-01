// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLAAdvBase} from "./ArcSLA.AdvBase.t.sol";

/// @dev Who may do what, where funds can (not) go, and double-settlement / isolation guarantees.
contract ArcSLARolesTest is ArcSLAAdvBase {
    uint256 internal constant SEED = 5e6;
    address[] internal actors; // customer, provider, verifier, stranger, submitter

    function setUp() public override {
        super.setUp();
        actors.push(customer);
        actors.push(provider);
        actors.push(verifier);
        actors.push(stranger);
        actors.push(submitter);
        for (uint256 i = 1; i < actors.length; ++i) usdc.mint(actors[i], SEED);
        providerStart = SEED;
    }

    function _bal(address a) internal view returns (uint256) {
        return usdc.balanceOf(a);
    }

    // ------------------------------------------------------------ refund is customer-only

    function _assertRefundNotCustomerForAll() internal {
        for (uint256 i = 1; i < actors.length; ++i) {
            vm.expectRevert(ArcSLA.NotCustomer.selector);
            vm.prank(actors[i]);
            sla.refund(id);
        }
        address third = makeAddr("thirdPartySubmitter");
        vm.expectRevert(ArcSLA.NotCustomer.selector);
        vm.prank(third);
        sla.refund(id);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Active));
        assertEq(sla.totalEscrowed(), AMOUNT);
    }

    function test_Roles_RefundByProviderVerifierStrangerSubmitterRevertsNotCustomer_BeforeDeadline() public {
        _assertRefundNotCustomerForAll();
    }

    function test_Roles_RefundByProviderVerifierStrangerSubmitterRevertsNotCustomer_AtDeadline() public {
        vm.warp(deadline);
        _assertRefundNotCustomerForAll();
    }

    function test_Roles_RefundByProviderVerifierStrangerSubmitterRevertsNotCustomer_AfterDeadline() public {
        vm.warp(uint256(deadline) + 1);
        _assertRefundNotCustomerForAll();
        // control: the customer can
        _refund(id);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Refunded));
    }

    function test_Roles_CustomerRefundBeforeDeadlineRevertsRefundNotAvailable() public {
        vm.expectRevert(ArcSLA.RefundNotAvailable.selector);
        vm.prank(customer);
        sla.refund(id);
    }

    // ------------------------------------------------------------ release authority

    function test_Roles_CustomerCannotReleaseWithOwnSignature() public {
        F memory f = _f(id);
        _expectRejectedBy(customer, f, _sigF(customerPk, f));
        _assertStillActive(id);
    }

    function _expectRejectedBy(address by, F memory f, bytes memory sig) internal {
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        vm.prank(by);
        sla.release(f.id, f.spec, f.prov, f.ev, f.exp, sig);
    }

    function test_Roles_ValidSignatureAlwaysPaysProviderRegardlessOfSubmitter() public {
        for (uint256 i; i < actors.length; ++i) {
            uint256 aid = i == 0 ? id : _create();
            F memory f = _f(aid);
            bytes memory sig = _sigF(VERIFIER_PK, f);

            uint256[5] memory before_;
            for (uint256 j; j < actors.length; ++j) before_[j] = _bal(actors[j]);
            uint256 slaBefore = _bal(address(sla));

            _releaseF(f, sig, actors[i]);

            for (uint256 j; j < actors.length; ++j) {
                if (j == 1) {
                    assertEq(_bal(actors[j]), before_[j] + AMOUNT, "provider paid");
                } else {
                    assertEq(_bal(actors[j]), before_[j], "non-provider balance changed");
                }
            }
            assertEq(_bal(address(sla)), slaBefore - AMOUNT);
            assertEq(uint8(_status(aid)), uint8(ArcSLA.Status.Released));
        }
        assertEq(sla.totalEscrowed(), 0);
    }

    // ------------------------------------------------------------ invalid parties

    function test_Roles_CreateWithCustomerEqualsProviderReverts() public {
        vm.expectRevert(ArcSLA.InvalidParties.selector);
        vm.prank(customer);
        sla.createAgreement(customer, verifier, AMOUNT, deadline, SPEC);
    }

    function test_Roles_CreateWithCustomerEqualsVerifierReverts() public {
        vm.expectRevert(ArcSLA.InvalidParties.selector);
        vm.prank(customer);
        sla.createAgreement(provider, customer, AMOUNT, deadline, SPEC);
    }

    function test_Roles_CreateWithVerifierEqualsProviderReverts() public {
        vm.expectRevert(ArcSLA.InvalidParties.selector);
        vm.prank(customer);
        sla.createAgreement(provider, provider, AMOUNT, deadline, SPEC);
    }

    function test_Roles_CreateWithAllThreeEqualReverts() public {
        vm.expectRevert(ArcSLA.InvalidParties.selector);
        vm.prank(customer);
        sla.createAgreement(customer, customer, AMOUNT, deadline, SPEC);
        assertEq(sla.agreementCount(), 1); // only setUp's agreement
    }

    // ------------------------------------------------------------ funds only reach provider / customer

    function test_Roles_FundsOnlyReachProviderOrCustomer() public {
        // 6 agreements; settle a mix, each release submitted by a different party
        uint256[6] memory ids;
        ids[0] = id;
        for (uint256 i = 1; i < 6; ++i) ids[i] = _create();

        uint256 totalIn = 6 * AMOUNT;
        uint256 customerStart = _bal(customer) + totalIn; // before any creation
        uint256[5] memory seed;
        for (uint256 j; j < actors.length; ++j) seed[j] = _bal(actors[j]);

        // release ids 0..2 by customer/verifier/stranger; refund ids 3..5 after the deadline
        address[3] memory by = [customer, verifier, stranger];
        for (uint256 i; i < 3; ++i) {
            F memory f = _f(ids[i]);
            _releaseF(f, _sigF(VERIFIER_PK, f), by[i]);
        }
        vm.warp(uint256(deadline) + 1);
        for (uint256 i = 3; i < 6; ++i) _refund(ids[i]);

        assertEq(_bal(provider), seed[1] + 3 * AMOUNT, "provider got exactly the released sum");
        assertEq(_bal(customer), customerStart - 3 * AMOUNT, "customer net = refunds only");
        assertEq(_bal(verifier), seed[2], "verifier untouched");
        assertEq(_bal(stranger), seed[3], "stranger untouched");
        assertEq(_bal(submitter), seed[4], "submitter untouched");
        assertEq(_bal(address(sla)), 0);
        assertEq(sla.totalEscrowed(), 0);
    }

    function test_Roles_ReleaseWithProviderArgOfThirdPartyCannotRedirectFunds() public {
        // attacker passes their own address as provider (and even has a verifier-signed message for it) -> rejected
        F memory f = _f(id);
        f.prov = stranger;
        _expectRejected(f, _sigF(VERIFIER_PK, f), ArcSLA.ProviderMismatch.selector);
        assertEq(_bal(stranger), SEED);
        _assertStillActive(id);
    }

    // ------------------------------------------------------------ double settlement

    function test_Double_ReleaseTwiceOnlyFirstSettles() public {
        F memory f = _f(id);
        bytes memory sig = _sigF(VERIFIER_PK, f);
        _releaseF(f, sig, submitter);
        _expectRejected(f, sig, ArcSLA.AgreementNotActive.selector);
        // even with a fresh, independently valid signature
        f.ev = keccak256("second evidence");
        _expectRejected(f, _sigF(VERIFIER_PK, f), ArcSLA.AgreementNotActive.selector);
        assertEq(_bal(provider), SEED + AMOUNT);
        assertEq(sla.totalEscrowed(), 0);
    }

    function test_Double_RefundTwiceOnlyFirstSettles() public {
        vm.warp(uint256(deadline) + 1);
        uint256 c0 = _bal(customer);
        _refund(id);
        vm.expectRevert(ArcSLA.AgreementNotActive.selector);
        vm.prank(customer);
        sla.refund(id);
        assertEq(_bal(customer), c0 + AMOUNT);
        assertEq(sla.totalEscrowed(), 0);
    }

    function test_Double_ReleaseAfterRefundReverts() public {
        F memory f = _f(id);
        bytes memory sig = _sigF(VERIFIER_PK, f);
        vm.warp(uint256(deadline) + 1);
        _refund(id);
        vm.warp(T0);
        _expectRejected(f, sig, ArcSLA.AgreementNotActive.selector);
        assertEq(_bal(provider), SEED, "provider never paid");
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Refunded));
    }

    function test_Double_RefundAfterReleaseReverts() public {
        _release(id, exp);
        vm.warp(uint256(deadline) + 1);
        vm.expectRevert(ArcSLA.AgreementNotActive.selector);
        vm.prank(customer);
        sla.refund(id);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
        assertFalse(sla.isRefundable(id));
    }

    function test_Double_TwoDifferentValidSignaturesOnlyFirstSettles() public {
        bytes32 ev2 = keccak256("another evidence");
        F memory f1 = _f(id);
        F memory f2 = _f(id);
        f2.ev = ev2;
        bytes memory sig1 = _sigF(VERIFIER_PK, f1);
        bytes memory sig2 = _sigF(VERIFIER_PK, f2);

        _releaseF(f2, sig2, stranger); // second one goes first
        _expectRejected(f1, sig1, ArcSLA.AgreementNotActive.selector);
        ArcSLA.Agreement memory a = sla.getAgreement(id);
        assertEq(a.evidenceHash, ev2, "first settlement's evidence is final");
        assertEq(_bal(provider), SEED + AMOUNT, "paid once");
        assertEq(sla.totalEscrowed(), 0);
    }

    function test_Double_CrossAgreementIsolation() public {
        uint256 b = _create();
        uint256 c = _create();
        ArcSLA.Agreement memory bBefore = sla.getAgreement(b);
        ArcSLA.Agreement memory cBefore = sla.getAgreement(c);

        _release(id, exp);

        assertEq(sla.totalEscrowed(), 2 * AMOUNT);
        _assertSame(sla.getAgreement(b), bBefore);
        _assertSame(sla.getAgreement(c), cBefore);

        // refunding c later must not touch b or the already-released id
        vm.warp(uint256(deadline) + 1);
        _refund(c);
        _assertSame(sla.getAgreement(b), bBefore);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
        assertEq(sla.totalEscrowed(), AMOUNT);
        assertEq(_bal(address(sla)), AMOUNT);
    }

    function _assertSame(ArcSLA.Agreement memory x, ArcSLA.Agreement memory y) internal pure {
        assertEq(x.customer, y.customer);
        assertEq(x.provider, y.provider);
        assertEq(x.verifier, y.verifier);
        assertEq(x.amount, y.amount);
        assertEq(x.deadline, y.deadline);
        assertEq(x.specHash, y.specHash);
        assertEq(uint8(x.status), uint8(y.status));
        assertEq(x.createdAt, y.createdAt);
        assertEq(x.evidenceHash, y.evidenceHash);
    }
}
