// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLATestBase} from "./ArcSLA.Base.t.sol";
import {FlexToken, FeeToken} from "./TestTokens.sol";

contract ArcSLASecurityTest is ArcSLATestBase {
    uint256 internal exp;

    function setUp() public override {
        super.setUp();
        exp = T0 + 1 days;
    }

    // ------------------------------------------------------------- EIP-712

    function test_EIP712_FulfillmentDigestMatchesIndependentComputation() public view {
        bytes32 domainTypehash =
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        bytes32 domainSep =
            keccak256(abi.encode(domainTypehash, keccak256("ArcSLA"), keccak256("1"), block.chainid, address(sla)));
        bytes32 fulfillmentTypehash = keccak256(
            "Fulfillment(uint256 agreementId,bytes32 specHash,address provider,bytes32 evidenceHash,uint256 expiry)"
        );
        bytes32 structHash = keccak256(abi.encode(fulfillmentTypehash, uint256(7), SPEC, provider, EVIDENCE, exp));
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));

        assertEq(sla.FULFILLMENT_TYPEHASH(), fulfillmentTypehash);
        assertEq(sla.domainSeparator(), domainSep);
        assertEq(sla.fulfillmentDigest(7, SPEC, provider, EVIDENCE, exp), expected);
    }

    function test_EIP712_DomainSeparatorChangesWithChainId() public {
        bytes32 before_ = sla.domainSeparator();
        vm.chainId(block.chainid + 1);
        assertTrue(sla.domainSeparator() != before_);
    }

    // ------------------------------------------------------------- replay

    function test_Replay_SignatureAgainstSecondDeploymentRejected() public {
        ArcSLA sla2 = _deployFor(usdc);
        uint256 id1 = _create();
        uint256 id2 = _createOn(sla2, customer);
        assertEq(id1, id2);

        bytes memory sig = _goodSig(id1, exp);
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        vm.prank(submitter);
        sla2.release(id2, SPEC, provider, EVIDENCE, exp, sig);
        assertEq(uint8(sla2.getAgreement(id2).status), uint8(ArcSLA.Status.Active));

        // control: the same signature still works on the deployment it was made for
        _submit(id1, SPEC, provider, EVIDENCE, exp, sig);
        assertEq(uint8(_status(id1)), uint8(ArcSLA.Status.Released));
    }

    function test_Replay_SignatureFromSecondDeploymentRejectedOnFirst() public {
        ArcSLA sla2 = _deployFor(usdc);
        uint256 id1 = _create();
        _createOn(sla2, customer);
        bytes memory sig2 = _sign(sla2, VERIFIER_PK, id1, SPEC, provider, EVIDENCE, exp);
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id1, SPEC, provider, EVIDENCE, exp, sig2);
    }

    function test_Replay_SignatureAcrossChainIdRejected() public {
        uint256 id1 = _create();
        bytes memory sig = _goodSig(id1, exp);

        vm.chainId(block.chainid + 1);
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id1, SPEC, provider, EVIDENCE, exp, sig);
        assertEq(uint8(_status(id1)), uint8(ArcSLA.Status.Active));

        // control: a fresh signature on the new chain id is accepted (domain recomputed)
        bytes memory sigNew = _goodSig(id1, exp);
        _submit(id1, SPEC, provider, EVIDENCE, exp, sigNew);
        assertEq(uint8(_status(id1)), uint8(ArcSLA.Status.Released));
    }

    // ------------------------------------------------------------- token failures

    function test_TokenFailure_ReleaseRevertsAtomicallyWhenTransferReverts() public {
        FlexToken tok = new FlexToken();
        ArcSLA s = _deployFor(tok);
        uint256 id = _createOn(s, customer);
        bytes memory sig = _sign(s, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp);

        tok.setFlags(true, false, false, false);
        vm.expectRevert(bytes("transfer blocked"));
        vm.prank(submitter);
        s.release(id, SPEC, provider, EVIDENCE, exp, sig);

        ArcSLA.Agreement memory a = s.getAgreement(id);
        assertEq(uint8(a.status), uint8(ArcSLA.Status.Active));
        assertEq(a.evidenceHash, bytes32(0));
        assertEq(s.totalEscrowed(), AMOUNT);
        assertEq(tok.balanceOf(address(s)), AMOUNT);

        // retryable once the token unblocks
        tok.setFlags(false, false, false, false);
        vm.prank(submitter);
        s.release(id, SPEC, provider, EVIDENCE, exp, sig);
        assertEq(tok.balanceOf(provider), AMOUNT);
    }

    function test_TokenFailure_ReleaseRevertsWhenTransferReturnsFalse() public {
        FlexToken tok = new FlexToken();
        ArcSLA s = _deployFor(tok);
        uint256 id = _createOn(s, customer);
        bytes memory sig = _sign(s, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp);

        tok.setFlags(false, false, true, false);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tok)));
        vm.prank(submitter);
        s.release(id, SPEC, provider, EVIDENCE, exp, sig);
        assertEq(uint8(s.getAgreement(id).status), uint8(ArcSLA.Status.Active));
        assertEq(s.totalEscrowed(), AMOUNT);
    }

    function test_TokenFailure_RefundRevertsAtomicallyWhenTransferReverts() public {
        FlexToken tok = new FlexToken();
        ArcSLA s = _deployFor(tok);
        uint256 id = _createOn(s, customer);
        vm.warp(uint256(deadline) + 1);

        tok.setFlags(true, false, false, false);
        vm.expectRevert(bytes("transfer blocked"));
        vm.prank(customer);
        s.refund(id);

        assertEq(uint8(s.getAgreement(id).status), uint8(ArcSLA.Status.Active));
        assertEq(s.totalEscrowed(), AMOUNT);
        assertEq(tok.balanceOf(address(s)), AMOUNT);

        tok.setFlags(false, false, false, false);
        vm.prank(customer);
        s.refund(id);
        assertEq(uint8(s.getAgreement(id).status), uint8(ArcSLA.Status.Refunded));
    }

    function test_TokenFailure_RefundRevertsWhenTransferReturnsFalse() public {
        FlexToken tok = new FlexToken();
        ArcSLA s = _deployFor(tok);
        uint256 id = _createOn(s, customer);
        vm.warp(uint256(deadline) + 1);
        tok.setFlags(false, false, true, false);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tok)));
        vm.prank(customer);
        s.refund(id);
        assertEq(uint8(s.getAgreement(id).status), uint8(ArcSLA.Status.Active));
    }

    function test_TokenFailure_CreateRevertsWhenTransferFromReverts() public {
        FlexToken tok = new FlexToken();
        ArcSLA s = _deployFor(tok);
        tok.setFlags(false, true, false, false);
        vm.expectRevert(bytes("transferFrom blocked"));
        vm.prank(customer);
        s.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);
        assertEq(s.agreementCount(), 0);
        assertEq(s.totalEscrowed(), 0);
        vm.expectRevert(ArcSLA.AgreementNotFound.selector);
        s.getAgreement(1);
    }

    function test_TokenFailure_CreateRevertsWhenTransferFromReturnsFalse() public {
        FlexToken tok = new FlexToken();
        ArcSLA s = _deployFor(tok);
        tok.setFlags(false, false, false, true);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tok)));
        vm.prank(customer);
        s.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);
        assertEq(s.agreementCount(), 0);
        assertEq(s.totalEscrowed(), 0);
        vm.expectRevert(ArcSLA.AgreementNotFound.selector);
        s.getAgreement(1);
    }

    function test_TokenFailure_FeeOnTransferTokenRevertsAmountMismatch() public {
        FeeToken tok = new FeeToken();
        ArcSLA s = _deployFor(tok);
        vm.expectRevert(ArcSLA.AmountMismatch.selector);
        vm.prank(customer);
        s.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);
        assertEq(s.agreementCount(), 0);
        assertEq(s.totalEscrowed(), 0);
        assertEq(tok.balanceOf(address(s)), 0);
    }
}
