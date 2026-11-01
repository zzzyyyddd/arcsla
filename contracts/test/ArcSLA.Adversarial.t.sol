// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLAAdvBase} from "./ArcSLA.AdvBase.t.sol";

/// @dev Signature forgery, tampering, malleability, encoding and replay attacks on release().
contract ArcSLAAdversarialTest is ArcSLAAdvBase {
    bytes4 internal immutable INVALID_SIGNER = ArcSLA.InvalidSigner.selector;

    // ------------------------------------------------------------ control

    function test_Sig_Control_ManualDigestMatchesContractAndIsAccepted() public {
        F memory f = _f(id);
        bytes32 d = _manualDigest(FULFILL_TYPE, "ArcSLA", "1", block.chainid, address(sla), f);
        assertEq(d, sla.fulfillmentDigest(f.id, f.spec, f.prov, f.ev, f.exp));
        _releaseF(f, _rsv(VERIFIER_PK, d), submitter);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
        assertEq(usdc.balanceOf(provider), AMOUNT);
    }

    // ------------------------------------------------------------ non-verifier roles

    function _roleRejected(uint256 pk) internal {
        F memory f = _f(id);
        _expectRejected(f, _sigF(pk, f), INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_CustomerSignatureRejected() public {
        _roleRejected(customerPk);
    }

    function test_Sig_ProviderSignatureRejected() public {
        _roleRejected(providerPk);
    }

    function test_Sig_SubmitterSignatureRejected() public {
        _roleRejected(submitterPk);
    }

    function test_Sig_StrangerSignatureRejected() public {
        _roleRejected(strangerPk);
    }

    function test_Sig_RandomKeySignatureRejected() public {
        _roleRejected(RANDOM_PK);
    }

    function test_Sig_OtherSignerKeyRejected() public {
        _roleRejected(OTHER_PK);
    }

    // ------------------------------------------------------------ single-field mutation: sign mutated, submit original

    function test_Sig_SignedOverMutatedAgreementId_SubmitOriginalRejected() public {
        _create(); // id 2 exists with identical terms
        F memory f = _f(id);
        F memory m = _f(2);
        _expectRejected(f, _sigF(VERIFIER_PK, m), INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_SignedOverMutatedSpecHash_SubmitOriginalRejected() public {
        F memory f = _f(id);
        F memory m = _f(id);
        m.spec = SPEC ^ bytes32(uint256(1));
        _expectRejected(f, _sigF(VERIFIER_PK, m), INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_SignedOverMutatedProvider_SubmitOriginalRejected() public {
        F memory f = _f(id);
        F memory m = _f(id);
        m.prov = stranger;
        _expectRejected(f, _sigF(VERIFIER_PK, m), INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_SignedOverMutatedEvidenceHash_SubmitOriginalRejected() public {
        F memory f = _f(id);
        F memory m = _f(id);
        m.ev = EVIDENCE ^ bytes32(uint256(1));
        _expectRejected(f, _sigF(VERIFIER_PK, m), INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_SignedOverMutatedExpiry_SubmitOriginalRejected() public {
        F memory f = _f(id);
        F memory m = _f(id);
        m.exp = exp + 1;
        _expectRejected(f, _sigF(VERIFIER_PK, m), INVALID_SIGNER);
        m.exp = exp - 1;
        _expectRejected(f, _sigF(VERIFIER_PK, m), INVALID_SIGNER);
        _assertStillActive(id);
    }

    // ------------------------------------------------------------ single-field mutation: sign original, submit mutated

    function test_Sig_SignedOriginal_SubmitMutatedAgreementIdRejected() public {
        _create();
        F memory f = _f(id);
        bytes memory sig = _sigF(VERIFIER_PK, f);
        _expectRejected(_f(2), sig, INVALID_SIGNER);
        assertEq(uint8(_status(2)), uint8(ArcSLA.Status.Active));
        _expectRejected(_f(99), sig, ArcSLA.AgreementNotFound.selector);
        _assertStillActive(id);
    }

    function test_Sig_SignedOriginal_SubmitMutatedSpecHashRejected() public {
        F memory f = _f(id);
        bytes memory sig = _sigF(VERIFIER_PK, f);
        f.spec = SPEC ^ bytes32(uint256(1));
        _expectRejected(f, sig, ArcSLA.SpecHashMismatch.selector);
        _assertStillActive(id);
    }

    function test_Sig_SignedOriginal_SubmitMutatedProviderRejected() public {
        F memory f = _f(id);
        bytes memory sig = _sigF(VERIFIER_PK, f);
        f.prov = stranger;
        _expectRejected(f, sig, ArcSLA.ProviderMismatch.selector);
        _assertStillActive(id);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_Sig_SignedOriginal_SubmitMutatedEvidenceHashRejected() public {
        F memory f = _f(id);
        bytes memory sig = _sigF(VERIFIER_PK, f);
        f.ev = EVIDENCE ^ bytes32(uint256(1));
        _expectRejected(f, sig, INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_SignedOriginal_SubmitMutatedExpiryRejected() public {
        F memory f = _f(id);
        bytes memory sig = _sigF(VERIFIER_PK, f);
        f.exp = exp + 1;
        _expectRejected(f, sig, INVALID_SIGNER);
        f.exp = exp - 1;
        _expectRejected(f, sig, INVALID_SIGNER);
        f.exp = type(uint256).max; // extending the attestation lifetime must not be possible
        _expectRejected(f, sig, INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_SignedMutatedSpecOrProvider_SubmittedMatchingStillFailsAgreementCheck() public {
        F memory m = _f(id);
        m.spec = SPEC ^ bytes32(uint256(1));
        _expectRejected(m, _sigF(VERIFIER_PK, m), ArcSLA.SpecHashMismatch.selector);
        m = _f(id);
        m.prov = stranger;
        _expectRejected(m, _sigF(VERIFIER_PK, m), ArcSLA.ProviderMismatch.selector);
        _assertStillActive(id);
    }

    // ------------------------------------------------------------ wrong EIP-712 domain / type

    function test_Sig_WrongTypehashStringRejected() public {
        F memory f = _f(id);
        string memory bad =
            "Fulfillment(uint256 agreementId,bytes32 specHash,address provider,bytes32 evidenceHash,uint256 expires)";
        bytes32 d = _manualDigest(bad, "ArcSLA", "1", block.chainid, address(sla), f);
        _expectRejected(f, _rsv(VERIFIER_PK, d), INVALID_SIGNER);
        string memory bad2 =
            "fulfillment(uint256 agreementId,bytes32 specHash,address provider,bytes32 evidenceHash,uint256 expiry)";
        d = _manualDigest(bad2, "ArcSLA", "1", block.chainid, address(sla), f);
        _expectRejected(f, _rsv(VERIFIER_PK, d), INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_WrongDomainNameRejected() public {
        F memory f = _f(id);
        bytes32 d = _manualDigest(FULFILL_TYPE, "ArcSLA2", "1", block.chainid, address(sla), f);
        _expectRejected(f, _rsv(VERIFIER_PK, d), INVALID_SIGNER);
        d = _manualDigest(FULFILL_TYPE, "arcsla", "1", block.chainid, address(sla), f);
        _expectRejected(f, _rsv(VERIFIER_PK, d), INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_WrongDomainVersionRejected() public {
        F memory f = _f(id);
        bytes32 d = _manualDigest(FULFILL_TYPE, "ArcSLA", "2", block.chainid, address(sla), f);
        _expectRejected(f, _rsv(VERIFIER_PK, d), INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_WrongVerifyingContractRejected() public {
        F memory f = _f(id);
        bytes32 d = _manualDigest(FULFILL_TYPE, "ArcSLA", "1", block.chainid, address(usdc), f);
        _expectRejected(f, _rsv(VERIFIER_PK, d), INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_WrongChainIdRejected() public {
        F memory f = _f(id);
        bytes32 d = _manualDigest(FULFILL_TYPE, "ArcSLA", "1", block.chainid + 1, address(sla), f);
        _expectRejected(f, _rsv(VERIFIER_PK, d), INVALID_SIGNER);
        d = _manualDigest(FULFILL_TYPE, "ArcSLA", "1", 1, address(sla), f);
        _expectRejected(f, _rsv(VERIFIER_PK, d), INVALID_SIGNER);
        _assertStillActive(id);
    }

    // ------------------------------------------------------------ prefixing / raw digests

    function test_Sig_EIP191PersonalSignPrefixedDigestRejected() public {
        F memory f = _f(id);
        bytes32 d = sla.fulfillmentDigest(f.id, f.spec, f.prov, f.ev, f.exp);
        bytes32 prefixed = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", d));
        _expectRejected(f, _rsv(VERIFIER_PK, prefixed), INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_RawUnprefixedStructHashSignedRejected() public {
        F memory f = _f(id);
        // signing the bare struct hash (no \x19\x01 || domainSeparator) must not authorise anything
        _expectRejected(f, _rsv(VERIFIER_PK, _structHash(FULFILL_TYPE, f)), INVALID_SIGNER);
        // nor a bare hash of the fields without the typehash
        bytes32 bare = keccak256(abi.encode(f.id, f.spec, f.prov, f.ev, f.exp));
        _expectRejected(f, _rsv(VERIFIER_PK, bare), INVALID_SIGNER);
        bare = keccak256(abi.encodePacked(f.id, f.spec, f.prov, f.ev, f.exp));
        _expectRejected(f, _rsv(VERIFIER_PK, bare), INVALID_SIGNER);
        _assertStillActive(id);
    }

    // ------------------------------------------------------------ bit flips / malleability / encodings

    function test_Sig_EveryByteFlippedRejected_XOR01() public {
        _flipAll(0x01);
    }

    function test_Sig_EveryByteFlippedRejected_XORFF() public {
        _flipAll(0xFF);
    }

    function _flipAll(uint8 mask) internal {
        F memory f = _f(id);
        bytes memory good = _sigF(VERIFIER_PK, f);
        assertEq(good.length, 65);
        for (uint256 i; i < 65; ++i) {
            bytes memory bad = abi.encodePacked(good); // fresh copy (memory arrays alias)
            bad[i] = bytes1(uint8(bad[i]) ^ mask);
            vm.expectRevert(INVALID_SIGNER);
            vm.prank(submitter);
            sla.release(f.id, f.spec, f.prov, f.ev, f.exp, bad);
        }
        _assertStillActive(id);
        // control: the unmodified signature is accepted
        _releaseF(f, good, submitter);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
    }

    function test_Sig_HighSMalleatedRejected() public {
        F memory f = _f(id);
        bytes32 d = sla.fulfillmentDigest(f.id, f.spec, f.prov, f.ev, f.exp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_PK, d);
        bytes32 sHigh = bytes32(SECP_N - uint256(s));
        uint8 vFlip = v == 27 ? 28 : 27;
        // (r, N-s, flipped v) recovers the SAME signer in raw ecrecover; the contract must refuse it
        assertEq(ecrecover(d, vFlip, r, sHigh), verifier, "malleated twin is raw-valid");
        _expectRejected(f, abi.encodePacked(r, sHigh, vFlip), INVALID_SIGNER);
        _expectRejected(f, abi.encodePacked(r, sHigh, v), INVALID_SIGNER);
        _assertStillActive(id);
        _releaseF(f, abi.encodePacked(r, s, v), submitter);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
    }

    function test_Sig_HighSMalleatedTwinCannotBeUsedAfterOriginalSettles() public {
        F memory f = _f(id);
        bytes32 d = sla.fulfillmentDigest(f.id, f.spec, f.prov, f.ev, f.exp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_PK, d);
        _releaseF(f, abi.encodePacked(r, s, v), submitter);
        _expectRejected(f, abi.encodePacked(r, bytes32(SECP_N - uint256(s)), v == 27 ? uint8(28) : uint8(27)), ArcSLA.AgreementNotActive.selector);
        assertEq(usdc.balanceOf(provider), AMOUNT);
    }

    /// @dev FINDING (spec deviation, not a vulnerability): the premise "EIP-2098 compact signatures are
    ///      accepted" does NOT hold with OpenZeppelin 5.6.1 `ECDSA.tryRecoverCalldata`, which only
    ///      supports 65-byte signatures. A valid 64-byte compact signature is rejected as InvalidSigner
    ///      and the agreement is untouched; the same signature in 65-byte form settles exactly once.
    function test_Sig_EIP2098CompactEncoding_RejectedAsInvalidSigner_Then65ByteSettlesOnce() public {
        F memory f = _f(id);
        bytes32 d = sla.fulfillmentDigest(f.id, f.spec, f.prov, f.ev, f.exp);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_PK, d);
        assertTrue(uint256(s) < (1 << 255), "low-s needed for compact form");
        bytes32 vs = bytes32(uint256(s) | (uint256(v - 27) << 255));
        bytes memory compact = abi.encodePacked(r, vs);
        assertEq(compact.length, 64);

        _expectRejected(f, compact, INVALID_SIGNER);
        _assertStillActive(id);

        _releaseF(f, abi.encodePacked(r, s, v), submitter);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Released));
        _expectRejected(f, compact, ArcSLA.AgreementNotActive.selector);
        _expectRejected(f, abi.encodePacked(r, s, v), ArcSLA.AgreementNotActive.selector);
        assertEq(usdc.balanceOf(provider), AMOUNT);
    }

    function test_Sig_AllZeroSignaturesRejected() public {
        F memory f = _f(id);
        _expectRejected(f, new bytes(65), INVALID_SIGNER);
        _expectRejected(f, new bytes(64), INVALID_SIGNER);
        _expectRejected(f, abi.encodePacked(bytes32(0), bytes32(0), uint8(27)), INVALID_SIGNER);
        _expectRejected(f, abi.encodePacked(bytes32(0), bytes32(0), uint8(28)), INVALID_SIGNER);
        _assertStillActive(id);
    }

    function test_Sig_WrongLengthSignaturesRejected() public {
        F memory f = _f(id);
        bytes memory good = _sigF(VERIFIER_PK, f);
        uint256[8] memory lens = [uint256(0), 1, 32, 63, 66, 97, 130, 1000];
        for (uint256 i; i < lens.length; ++i) {
            _expectRejected(f, new bytes(lens[i]), INVALID_SIGNER);
        }
        // valid signature with an extra trailing byte / truncated by one byte / doubled
        _expectRejected(f, abi.encodePacked(good, uint8(0)), INVALID_SIGNER);
        _expectRejected(f, abi.encodePacked(good, good), INVALID_SIGNER);
        bytes memory trunc = new bytes(64);
        for (uint256 i; i < 64; ++i) trunc[i] = good[i];
        _expectRejected(f, trunc, INVALID_SIGNER);
        _assertStillActive(id);
    }

    // ------------------------------------------------------------ replay

    function test_Replay_SameSignatureAfterReleaseRejectedAsNotActive() public {
        F memory f = _f(id);
        bytes memory sig = _sigF(VERIFIER_PK, f);
        _releaseF(f, sig, submitter);
        _expectRejected(f, sig, ArcSLA.AgreementNotActive.selector);
        assertEq(usdc.balanceOf(provider), AMOUNT, "paid exactly once");
    }

    function test_Replay_SameSignatureOnSecondAgreementWithDifferentIdRejected() public {
        uint256 id2 = _create(); // identical spec / provider / verifier, different id
        F memory f = _f(id);
        bytes memory sig = _sigF(VERIFIER_PK, f);
        _releaseF(f, sig, submitter);
        _expectRejected(_f(id2), sig, INVALID_SIGNER);
        assertEq(uint8(_status(id2)), uint8(ArcSLA.Status.Active));
        assertEq(sla.totalEscrowed(), AMOUNT);
    }

    function test_Replay_SameSignatureOnSecondAgreementRejectedEvenBeforeFirstSettles() public {
        uint256 id2 = _create();
        bytes memory sig = _sigF(VERIFIER_PK, _f(id));
        _expectRejected(_f(id2), sig, INVALID_SIGNER);
        assertEq(uint8(_status(id2)), uint8(ArcSLA.Status.Active));
    }

    function test_Replay_AcrossSecondDeploymentRejected() public {
        ArcSLA sla2 = new ArcSLA(usdc);
        vm.prank(customer);
        usdc.approve(address(sla2), type(uint256).max);
        vm.prank(customer);
        uint256 id2 = sla2.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);
        assertEq(id2, id);
        bytes memory sig = _sigF(VERIFIER_PK, _f(id));
        F memory f = _f(id2);
        vm.expectRevert(INVALID_SIGNER);
        vm.prank(submitter);
        sla2.release(f.id, f.spec, f.prov, f.ev, f.exp, sig);
        assertEq(uint8(sla2.getAgreement(id2).status), uint8(ArcSLA.Status.Active));
        assertEq(usdc.balanceOf(provider), 0);
    }

    function test_Replay_AcrossChainIdChangeRejectedThenRestoredChainAccepts() public {
        F memory f = _f(id);
        bytes memory sig = _sigF(VERIFIER_PK, f);
        uint256 original = block.chainid;
        vm.chainId(original + 1);
        _expectRejected(f, sig, INVALID_SIGNER);
        vm.chainId(1);
        _expectRejected(f, sig, INVALID_SIGNER);
        _assertStillActive(id);
        vm.chainId(original);
        _releaseF(f, sig, submitter);
        assertEq(usdc.balanceOf(provider), AMOUNT);
    }

    function test_Replay_AfterRefundRejectedAsNotActive() public {
        F memory f = _f(id);
        bytes memory sig = _sigF(VERIFIER_PK, f);
        vm.warp(uint256(deadline) + 1);
        _refund(id);
        vm.warp(T0); // even rewinding the clock cannot revive a refunded agreement
        _expectRejected(f, sig, ArcSLA.AgreementNotActive.selector);
        assertEq(usdc.balanceOf(provider), 0);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Refunded));
    }
}
