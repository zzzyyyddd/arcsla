// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLATestBase} from "./ArcSLA.Base.t.sol";
import {FlexToken} from "./TestTokens.sol";
import {BlocklistToken, NoReturnToken, ShortPullToken, InflatingToken} from "./TestTokens2.sol";

/// @dev Hostile / quirky ERC-20 behaviour: blocklists, pauses, missing return values, short and
///      inflated pulls, and direct donations.
contract ArcSLATokenFailureTest is ArcSLATestBase {
    uint256 internal exp;

    function setUp() public override {
        super.setUp();
        exp = T0 + 1 days;
    }

    function _snap(ArcSLA s, uint256 id_) internal view returns (ArcSLA.Agreement memory a) {
        a = s.getAgreement(id_);
    }

    function _assertUntouched(ArcSLA s, IERC20 tok, uint256 id_, uint256 escrowed) internal view {
        ArcSLA.Agreement memory a = s.getAgreement(id_);
        assertEq(uint8(a.status), uint8(ArcSLA.Status.Active), "status unchanged");
        assertEq(a.evidenceHash, bytes32(0), "evidence unchanged");
        assertEq(s.totalEscrowed(), escrowed, "totalEscrowed unchanged");
        assertEq(tok.balanceOf(address(s)), escrowed, "contract balance unchanged");
    }

    // ------------------------------------------------------------ blocklist

    function test_Token_ProviderBlocklisted_ReleaseRevertsAtomically_RefundStillWorksAfterDeadline() public {
        BlocklistToken tok = new BlocklistToken();
        ArcSLA s = _deployFor(tok);
        uint256 id = _createOn(s, customer);
        bytes memory sig = _sign(s, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp);

        tok.setBlocked(provider, true);
        vm.expectRevert(bytes("recipient blocklisted"));
        vm.prank(submitter);
        s.release(id, SPEC, provider, EVIDENCE, exp, sig);
        _assertUntouched(s, tok, id, AMOUNT);
        assertEq(tok.balanceOf(provider), 0);

        // customer is not locked in: after the deadline the refund works despite the blocked provider
        vm.warp(uint256(deadline) + 1);
        uint256 c0 = tok.balanceOf(customer);
        vm.prank(customer);
        s.refund(id);
        assertEq(tok.balanceOf(customer), c0 + AMOUNT);
        assertEq(uint8(s.getAgreement(id).status), uint8(ArcSLA.Status.Refunded));
        assertEq(s.totalEscrowed(), 0);
    }

    function test_Token_ProviderUnblockedBeforeDeadline_ReleaseRetrySucceeds() public {
        BlocklistToken tok = new BlocklistToken();
        ArcSLA s = _deployFor(tok);
        uint256 id = _createOn(s, customer);
        bytes memory sig = _sign(s, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp);
        tok.setBlocked(provider, true);
        vm.expectRevert(bytes("recipient blocklisted"));
        vm.prank(submitter);
        s.release(id, SPEC, provider, EVIDENCE, exp, sig);
        tok.setBlocked(provider, false);
        vm.prank(submitter);
        s.release(id, SPEC, provider, EVIDENCE, exp, sig);
        assertEq(tok.balanceOf(provider), AMOUNT);
    }

    function test_Token_CustomerBlocklisted_RefundRevertsAtomically_SucceedsAfterUnblock() public {
        BlocklistToken tok = new BlocklistToken();
        ArcSLA s = _deployFor(tok);
        uint256 id = _createOn(s, customer);
        vm.warp(uint256(deadline) + 1);

        tok.setBlocked(customer, true);
        vm.expectRevert(bytes("recipient blocklisted"));
        vm.prank(customer);
        s.refund(id);
        _assertUntouched(s, tok, id, AMOUNT);
        assertTrue(s.isRefundable(id));

        tok.setBlocked(customer, false);
        uint256 c0 = tok.balanceOf(customer);
        vm.prank(customer);
        s.refund(id);
        assertEq(tok.balanceOf(customer), c0 + AMOUNT);
        assertEq(s.totalEscrowed(), 0);
    }

    function test_Token_ContractItselfBlocklisted_BothSettlementsRevertAtomically() public {
        BlocklistToken tok = new BlocklistToken();
        ArcSLA s = _deployFor(tok);
        uint256 id = _createOn(s, customer);
        bytes memory sig = _sign(s, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp);
        tok.setBlocked(address(s), true);
        vm.expectRevert(bytes("sender blocklisted"));
        vm.prank(submitter);
        s.release(id, SPEC, provider, EVIDENCE, exp, sig);
        vm.warp(uint256(deadline) + 1);
        vm.expectRevert(bytes("sender blocklisted"));
        vm.prank(customer);
        s.refund(id);
        _assertUntouched(s, tok, id, AMOUNT);
        tok.setBlocked(address(s), false);
        vm.prank(customer);
        s.refund(id);
        assertEq(uint8(s.getAgreement(id).status), uint8(ArcSLA.Status.Refunded));
    }

    // ------------------------------------------------------------ pause

    function test_Token_TransferPaused_ReleaseReverts_ThenUnpausedRetryWorks() public {
        BlocklistToken tok = new BlocklistToken();
        ArcSLA s = _deployFor(tok);
        uint256 id = _createOn(s, customer);
        bytes memory sig = _sign(s, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp);

        tok.setPaused(true);
        vm.expectRevert(bytes("paused"));
        vm.prank(submitter);
        s.release(id, SPEC, provider, EVIDENCE, exp, sig);
        _assertUntouched(s, tok, id, AMOUNT);

        tok.setPaused(false);
        vm.prank(submitter);
        s.release(id, SPEC, provider, EVIDENCE, exp, sig);
        assertEq(tok.balanceOf(provider), AMOUNT);
        assertEq(uint8(s.getAgreement(id).status), uint8(ArcSLA.Status.Released));
    }

    function test_Token_TransferPaused_RefundReverts_ThenUnpausedRetryWorks() public {
        BlocklistToken tok = new BlocklistToken();
        ArcSLA s = _deployFor(tok);
        uint256 id = _createOn(s, customer);
        vm.warp(uint256(deadline) + 1);
        tok.setPaused(true);
        vm.expectRevert(bytes("paused"));
        vm.prank(customer);
        s.refund(id);
        _assertUntouched(s, tok, id, AMOUNT);
        tok.setPaused(false);
        vm.prank(customer);
        s.refund(id);
        assertEq(uint8(s.getAgreement(id).status), uint8(ArcSLA.Status.Refunded));
    }

    function test_Token_PausedCreateRevertsWithNoState() public {
        BlocklistToken tok = new BlocklistToken();
        ArcSLA s = _deployFor(tok);
        tok.setPaused(true);
        vm.expectRevert(bytes("paused"));
        vm.prank(customer);
        s.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);
        assertEq(s.agreementCount(), 0);
        assertEq(s.totalEscrowed(), 0);
    }

    // ------------------------------------------------------------ return-value quirks

    function test_Token_UsdtStyleNoReturnValueWorksViaSafeERC20() public {
        NoReturnToken tok = new NoReturnToken();
        ArcSLA s = new ArcSLA(IERC20(address(tok)));
        tok.mint(customer, 10 * AMOUNT);
        vm.prank(customer);
        tok.approve(address(s), type(uint256).max);

        vm.startPrank(customer);
        uint256 a = s.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);
        uint256 b = s.createAgreement(provider, verifier, AMOUNT, uint64(T0 + 1 hours), SPEC);
        vm.stopPrank();
        assertEq(tok.balanceOf(address(s)), 2 * AMOUNT);

        bytes memory sig = _sign(s, VERIFIER_PK, a, SPEC, provider, EVIDENCE, exp);
        vm.prank(submitter);
        s.release(a, SPEC, provider, EVIDENCE, exp, sig);
        assertEq(tok.balanceOf(provider), AMOUNT);

        vm.warp(T0 + 2 hours);
        vm.prank(customer);
        s.refund(b);
        assertEq(tok.balanceOf(address(s)), 0);
        assertEq(s.totalEscrowed(), 0);
    }

    function test_Token_ReturnsFalse_ReleaseRefundAndCreateAllRevert() public {
        FlexToken tok = new FlexToken();
        ArcSLA s = _deployFor(tok);
        uint256 id = _createOn(s, customer);
        bytes memory sig = _sign(s, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp);
        bytes memory err = abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(tok));

        tok.setFlags(false, false, true, true);
        vm.expectRevert(err);
        vm.prank(submitter);
        s.release(id, SPEC, provider, EVIDENCE, exp, sig);
        vm.warp(uint256(deadline) + 1);
        vm.expectRevert(err);
        vm.prank(customer);
        s.refund(id);
        vm.expectRevert(err);
        vm.prank(customer);
        s.createAgreement(provider, verifier, AMOUNT, uint64(block.timestamp + 1 days), SPEC);

        _assertUntouched(s, tok, id, AMOUNT);
        assertEq(s.agreementCount(), 1);
    }

    // ------------------------------------------------------------ amount mismatch on pull

    function test_Token_TransferFromMovesLessThanAmountRevertsAmountMismatch() public {
        ShortPullToken tok = new ShortPullToken();
        ArcSLA s = _deployFor(tok);
        vm.expectRevert(ArcSLA.AmountMismatch.selector);
        vm.prank(customer);
        s.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);
        assertEq(s.agreementCount(), 0);
        assertEq(s.totalEscrowed(), 0);
        assertEq(tok.balanceOf(address(s)), 0);
    }

    function test_Token_TransferFromMovesMoreThanAmountRevertsAmountMismatch() public {
        InflatingToken tok = new InflatingToken();
        ArcSLA s = _deployFor(tok);
        uint256 c0 = tok.balanceOf(customer);
        vm.expectRevert(ArcSLA.AmountMismatch.selector);
        vm.prank(customer);
        s.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);
        assertEq(s.agreementCount(), 0);
        assertEq(s.totalEscrowed(), 0);
        assertEq(tok.balanceOf(address(s)), 0, "inflation rolled back");
        assertEq(tok.balanceOf(customer), c0);
    }

    // ------------------------------------------------------------ donations

    function _bal() internal view returns (uint256) {
        return usdc.balanceOf(address(sla));
    }

    function test_Accounting_DonationBeforeCreateDoesNotBreakCreateOrSettlement() public {
        usdc.mint(address(sla), 123_456);
        uint256 id = _create();
        assertEq(_bal(), 123_456 + AMOUNT);
        assertEq(sla.totalEscrowed(), AMOUNT);
        _release(id, exp);
        assertEq(sla.totalEscrowed(), 0);
        assertEq(_bal(), 123_456, "donation stays stranded; nothing else");
        assertEq(usdc.balanceOf(provider), AMOUNT);
    }

    function test_Accounting_DonationBetweenCreateAndSettlementPaysExactAmount() public {
        uint256 a = _create();
        uint256 b = _create();
        usdc.mint(address(sla), 777e6);
        assertGe(_bal(), sla.totalEscrowed());
        assertEq(sla.totalEscrowed(), 2 * AMOUNT);

        _release(a, exp);
        assertEq(usdc.balanceOf(provider), AMOUNT, "provider gets exactly the agreement amount, not the donation");
        assertEq(sla.totalEscrowed(), AMOUNT);
        assertGe(_bal(), sla.totalEscrowed());

        vm.warp(uint256(deadline) + 1);
        uint256 c0 = usdc.balanceOf(customer);
        _refund(b);
        assertEq(usdc.balanceOf(customer), c0 + AMOUNT, "customer gets exactly the agreement amount");
        assertEq(sla.totalEscrowed(), 0);
        assertEq(_bal(), 777e6);
    }

    function testFuzz_Accounting_DonationsNeverBreakAccounting(uint96 d1, uint96 d2, bool doRelease) public {
        usdc.mint(address(sla), d1);
        uint256 id = _create();
        usdc.mint(address(sla), d2);
        uint256 escrowedBefore = sla.totalEscrowed();
        assertEq(escrowedBefore, AMOUNT);
        assertGe(_bal(), escrowedBefore);
        if (doRelease) {
            _release(id, exp);
            assertEq(usdc.balanceOf(provider), AMOUNT);
        } else {
            vm.warp(uint256(deadline) + 1);
            uint256 c0 = usdc.balanceOf(customer);
            _refund(id);
            assertEq(usdc.balanceOf(customer), c0 + AMOUNT);
        }
        assertEq(sla.totalEscrowed(), 0);
        assertEq(_bal(), uint256(d1) + uint256(d2));
    }
}
