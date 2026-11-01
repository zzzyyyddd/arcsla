// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLATestBase} from "./ArcSLA.Base.t.sol";

contract ArcSLAReleaseTest is ArcSLATestBase {
    uint256 internal id;
    uint256 internal exp;

    function setUp() public override {
        super.setUp();
        id = _create();
        exp = T0 + 1 days;
    }

    // ------------------------------------------------------------------ happy paths

    function test_Release_ByThirdPartySubmitterPaysProvider() public {
        bytes memory sig = _goodSig(id, exp);
        uint256 provBefore = usdc.balanceOf(provider);
        uint256 subBefore = usdc.balanceOf(submitter);

        vm.expectEmit(true, true, true, true, address(sla));
        emit ArcSLA.AgreementReleased(id, provider, verifier, AMOUNT, SPEC, EVIDENCE, exp, submitter, uint64(T0));
        _submit(id, SPEC, provider, EVIDENCE, exp, sig);

        ArcSLA.Agreement memory a = sla.getAgreement(id);
        assertEq(uint8(a.status), uint8(ArcSLA.Status.Released));
        assertEq(a.evidenceHash, EVIDENCE);
        assertEq(usdc.balanceOf(provider), provBefore + AMOUNT);
        assertEq(usdc.balanceOf(submitter), subBefore, "submitter earns nothing");
        assertEq(usdc.balanceOf(address(sla)), 0);
        assertEq(sla.totalEscrowed(), 0);
    }

    function test_Release_AtExactlyDeadlineSucceeds() public {
        uint256 e = uint256(deadline) + 1 days;
        vm.warp(deadline);
        _release(id, e);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
        assertEq(usdc.balanceOf(provider), AMOUNT);
    }

    function test_Release_AtExactlyAttestationExpirySucceeds() public {
        vm.warp(exp);
        _release(id, exp);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
    }

    function test_Release_OnlySettlesTargetAgreementAmount() public {
        uint256 id2 = _create();
        _release(id, exp);
        assertEq(sla.totalEscrowed(), AMOUNT);
        assertEq(uint8(_status(id2)), uint8(ArcSLA.Status.Active));
        assertEq(usdc.balanceOf(address(sla)), AMOUNT);
    }

    // ------------------------------------------------------------------ signer checks

    function test_Release_RevertsInvalidSignerWhenSignedByNonVerifier() public {
        bytes memory sig = _sign(sla, OTHER_PK, id, SPEC, provider, EVIDENCE, exp);
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, EVIDENCE, exp, sig);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Active));
    }

    function test_Release_RevertsInvalidSignerWhenSignedByCustomerOrProviderKey() public {
        (address cAddr, uint256 cPk) = makeAddrAndKey("customerKey");
        assertTrue(cAddr != verifier);
        bytes memory sig = _sign(sla, cPk, id, SPEC, provider, EVIDENCE, exp);
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, EVIDENCE, exp, sig);
    }

    function test_Release_RevertsOnGarbage65ByteSignature() public {
        bytes memory sig = abi.encodePacked(bytes32(uint256(1)), bytes32(uint256(2)), uint8(27));
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, EVIDENCE, exp, sig);
    }

    function test_Release_RevertsOnInvalidVByte() public {
        bytes memory good = _goodSig(id, exp);
        good[64] = bytes1(uint8(5));
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, EVIDENCE, exp, good);
    }

    function test_Release_RevertsOnEmptySignature() public {
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, EVIDENCE, exp, "");
    }

    function test_Release_RevertsOnWrongLengthSignature() public {
        bytes memory sig = hex"deadbeefcafebabe0102030405";
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, EVIDENCE, exp, sig);
    }

    function test_Release_RevertsOnTruncatedValidSignature() public {
        bytes memory good = _goodSig(id, exp);
        bytes memory cut = new bytes(64);
        for (uint256 i; i < 64; ++i) cut[i] = good[i];
        // 64-byte input is read as an EIP-2098 compact signature: must not authorise release.
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, EVIDENCE, exp, cut);
    }

    function test_Release_RevertsOnMalleatedHighSSignature() public {
        bytes memory good = _goodSig(id, exp);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(good, 32))
            s := mload(add(good, 64))
            v := byte(0, mload(add(good, 96)))
        }
        assertLe(uint256(s), SECP_N / 2, "precondition: low-s");
        bytes memory mal = abi.encodePacked(r, bytes32(SECP_N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, EVIDENCE, exp, mal);
    }

    // ------------------------------------------------------------- term mismatches

    function test_Release_RevertsSpecHashMismatch() public {
        bytes32 wrong = keccak256("other spec");
        bytes memory sig = _sign(sla, VERIFIER_PK, id, wrong, provider, EVIDENCE, exp);
        vm.expectRevert(ArcSLA.SpecHashMismatch.selector);
        _submit(id, wrong, provider, EVIDENCE, exp, sig);
    }

    function test_Release_RevertsProviderMismatch() public {
        bytes memory sig = _sign(sla, VERIFIER_PK, id, SPEC, stranger, EVIDENCE, exp);
        vm.expectRevert(ArcSLA.ProviderMismatch.selector);
        _submit(id, SPEC, stranger, EVIDENCE, exp, sig);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_Release_SignatureOverDifferentProviderRejected() public {
        // Verifier signed for `stranger`; submitter claims the real provider.
        bytes memory sig = _sign(sla, VERIFIER_PK, id, SPEC, stranger, EVIDENCE, exp);
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, EVIDENCE, exp, sig);
    }

    function test_Release_SignatureOverDifferentEvidenceRejected() public {
        bytes memory sig = _goodSig(id, exp);
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, keccak256("forged evidence"), exp, sig);
    }

    function test_Release_SignatureOverDifferentExpiryRejected() public {
        bytes memory sig = _goodSig(id, exp);
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, EVIDENCE, exp + 1, sig);
    }

    function test_Release_SignatureForAgreementAFailsOnAgreementB() public {
        uint256 idB = _create();
        bytes memory sigForA = _goodSig(id, exp);
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(idB, SPEC, provider, EVIDENCE, exp, sigForA);
        assertEq(uint8(_status(idB)), uint8(ArcSLA.Status.Active));
        // the signature still works for its own agreement
        _submit(id, SPEC, provider, EVIDENCE, exp, sigForA);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
    }

    function test_Release_RevertsAgreementNotFoundForNonexistentId() public {
        bytes memory sig = _goodSig(99, exp);
        vm.expectRevert(ArcSLA.AgreementNotFound.selector);
        _submit(99, SPEC, provider, EVIDENCE, exp, sig);
    }

    function test_Release_RevertsAgreementNotFoundForIdZero() public {
        bytes memory sig = _goodSig(0, exp);
        vm.expectRevert(ArcSLA.AgreementNotFound.selector);
        _submit(0, SPEC, provider, EVIDENCE, exp, sig);
    }

    function test_Release_RevertsZeroEvidenceHash() public {
        bytes memory sig = _sign(sla, VERIFIER_PK, id, SPEC, provider, bytes32(0), exp);
        vm.expectRevert(ArcSLA.ZeroEvidenceHash.selector);
        _submit(id, SPEC, provider, bytes32(0), exp, sig);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Active));
    }

    // ------------------------------------------------------------------ timing

    function test_Release_RevertsAttestationExpired() public {
        uint256 e = T0 + 1 hours;
        bytes memory sig = _goodSig(id, e);
        vm.warp(e + 1);
        vm.expectRevert(ArcSLA.AttestationExpired.selector);
        _submit(id, SPEC, provider, EVIDENCE, e, sig);
    }

    function test_Release_RevertsDeadlinePassed() public {
        uint256 e = uint256(deadline) + 30 days;
        bytes memory sig = _goodSig(id, e);
        vm.warp(uint256(deadline) + 1);
        vm.expectRevert(ArcSLA.DeadlinePassed.selector);
        _submit(id, SPEC, provider, EVIDENCE, e, sig);
        assertEq(usdc.balanceOf(provider), 0);
    }

    // ------------------------------------------------------------ replays within a contract

    function test_Release_DoubleReleaseReverts() public {
        _release(id, exp);
        bytes memory sig = _goodSig(id, exp);
        vm.expectRevert(ArcSLA.AgreementNotActive.selector);
        _submit(id, SPEC, provider, EVIDENCE, exp, sig);
        assertEq(usdc.balanceOf(provider), AMOUNT, "paid only once");
    }
}
