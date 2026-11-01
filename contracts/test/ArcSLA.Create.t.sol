// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLATestBase} from "./ArcSLA.Base.t.sol";

contract ArcSLACreateTest is ArcSLATestBase {
    function _expectCreateRevert(
        bytes4 sel,
        address prov,
        address ver,
        uint256 amt,
        uint64 dl,
        bytes32 spec
    ) internal {
        vm.expectRevert(sel);
        vm.prank(customer);
        sla.createAgreement(prov, ver, amt, dl, spec);
    }

    // ---------------------------------------------------------------- constructor

    function test_Constructor_StoresTokenAndDomain() public view {
        assertEq(address(sla.usdc()), address(usdc));
        assertEq(sla.agreementCount(), 0);
        assertEq(sla.totalEscrowed(), 0);
    }

    function test_Constructor_RevertsOnZeroToken() public {
        vm.expectRevert(ArcSLA.ZeroAddress.selector);
        new ArcSLA(IERC20(address(0)));
    }

    // ------------------------------------------------------------ creation + funding

    function test_Create_FundsEscrowAndStoresTerms() public {
        uint256 custBefore = usdc.balanceOf(customer);
        uint256 slaBefore = usdc.balanceOf(address(sla));

        vm.expectEmit(true, true, true, true, address(sla));
        emit ArcSLA.AgreementCreated(1, customer, provider, verifier, AMOUNT, deadline, SPEC, uint64(T0));
        uint256 id = _create();

        assertEq(id, 1);
        assertEq(usdc.balanceOf(customer), custBefore - AMOUNT);
        assertEq(usdc.balanceOf(address(sla)), slaBefore + AMOUNT);
        assertEq(sla.agreementCount(), 1);
        assertEq(sla.totalEscrowed(), AMOUNT);

        ArcSLA.Agreement memory a = sla.getAgreement(id);
        assertEq(a.customer, customer);
        assertEq(a.provider, provider);
        assertEq(a.verifier, verifier);
        assertEq(a.amount, AMOUNT);
        assertEq(a.deadline, deadline);
        assertEq(a.specHash, SPEC);
        assertEq(uint8(a.status), uint8(ArcSLA.Status.Active));
        assertEq(a.createdAt, uint64(T0));
        assertEq(a.evidenceHash, bytes32(0));
    }

    function test_Create_SequentialIdsAndCumulativeEscrow() public {
        uint256 id1 = _create();
        uint256 id2 = _create();
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(sla.agreementCount(), 2);
        assertEq(sla.totalEscrowed(), 2 * AMOUNT);
        assertEq(usdc.balanceOf(address(sla)), 2 * AMOUNT);
    }

    function test_Create_DeadlineOneSecondInFutureAccepted() public {
        vm.prank(customer);
        uint256 id = sla.createAgreement(provider, verifier, AMOUNT, uint64(T0 + 1), SPEC);
        assertEq(sla.getAgreement(id).deadline, uint64(T0 + 1));
    }

    // ------------------------------------------------------------------ rejections

    function test_Create_RevertsOnZeroAmount() public {
        _expectCreateRevert(ArcSLA.ZeroAmount.selector, provider, verifier, 0, deadline, SPEC);
    }

    function test_Create_RevertsOnZeroProvider() public {
        _expectCreateRevert(ArcSLA.ZeroAddress.selector, address(0), verifier, AMOUNT, deadline, SPEC);
    }

    function test_Create_RevertsOnZeroVerifier() public {
        _expectCreateRevert(ArcSLA.ZeroAddress.selector, provider, address(0), AMOUNT, deadline, SPEC);
    }

    function test_Create_RevertsOnPastDeadline() public {
        _expectCreateRevert(ArcSLA.InvalidDeadline.selector, provider, verifier, AMOUNT, uint64(T0 - 1), SPEC);
    }

    function test_Create_RevertsOnDeadlineEqualToNow() public {
        _expectCreateRevert(ArcSLA.InvalidDeadline.selector, provider, verifier, AMOUNT, uint64(T0), SPEC);
    }

    function test_Create_RevertsOnZeroDeadline() public {
        _expectCreateRevert(ArcSLA.InvalidDeadline.selector, provider, verifier, AMOUNT, 0, SPEC);
    }

    function test_Create_RevertsOnZeroSpecHash() public {
        _expectCreateRevert(ArcSLA.ZeroSpecHash.selector, provider, verifier, AMOUNT, deadline, bytes32(0));
    }

    function test_Create_RevertsWhenProviderIsCustomer() public {
        _expectCreateRevert(ArcSLA.InvalidParties.selector, customer, verifier, AMOUNT, deadline, SPEC);
    }

    function test_Create_RevertsWhenVerifierIsCustomer() public {
        _expectCreateRevert(ArcSLA.InvalidParties.selector, provider, customer, AMOUNT, deadline, SPEC);
    }

    function test_Create_RevertsWhenVerifierIsProvider() public {
        _expectCreateRevert(ArcSLA.InvalidParties.selector, provider, provider, AMOUNT, deadline, SPEC);
    }

    function test_Create_RevertsWhenProviderOrVerifierIsContractOrToken() public {
        _expectCreateRevert(ArcSLA.InvalidParties.selector, address(sla), verifier, AMOUNT, deadline, SPEC);
        _expectCreateRevert(ArcSLA.InvalidParties.selector, provider, address(sla), AMOUNT, deadline, SPEC);
        _expectCreateRevert(ArcSLA.InvalidParties.selector, address(usdc), verifier, AMOUNT, deadline, SPEC);
        _expectCreateRevert(ArcSLA.InvalidParties.selector, provider, address(usdc), AMOUNT, deadline, SPEC);
    }

    function test_Create_RevertsWithoutAllowance() public {
        usdc.mint(stranger, AMOUNT);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(sla), 0, AMOUNT)
        );
        vm.prank(stranger);
        sla.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);

        assertEq(sla.agreementCount(), 0);
        assertEq(sla.totalEscrowed(), 0);
        assertEq(usdc.balanceOf(address(sla)), 0);
    }

    function test_Create_RevertsWithInsufficientAllowance() public {
        usdc.mint(stranger, AMOUNT);
        vm.prank(stranger);
        usdc.approve(address(sla), AMOUNT - 1);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(sla), AMOUNT - 1, AMOUNT)
        );
        vm.prank(stranger);
        sla.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);
        assertEq(sla.agreementCount(), 0);
    }

    function test_Create_RevertsWithInsufficientBalance() public {
        vm.prank(stranger);
        usdc.approve(address(sla), AMOUNT);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, stranger, 0, AMOUNT)
        );
        vm.prank(stranger);
        sla.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);
        assertEq(sla.agreementCount(), 0);
    }

    // ------------------------------------------------------------ view helpers

    function test_IsRefundable_FalseBeforeTrueAfterDeadlineFalseWhenSettled() public {
        uint256 id = _create();
        assertFalse(sla.isRefundable(id));
        vm.warp(deadline);
        assertFalse(sla.isRefundable(id));
        vm.warp(uint256(deadline) + 1);
        assertTrue(sla.isRefundable(id));
        _refund(id);
        assertFalse(sla.isRefundable(id));
    }

    function test_ViewFunctions_RevertForNonexistentAgreement() public {
        vm.expectRevert(ArcSLA.AgreementNotFound.selector);
        sla.getAgreement(1);
        vm.expectRevert(ArcSLA.AgreementNotFound.selector);
        sla.isRefundable(0);
    }
}
