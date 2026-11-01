// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcSLA} from "../ArcSLA.sol";
import {MintableERC20, TestUSDC} from "./TestTokens.sol";

/// @dev Shared fixture. NOTE: never put a call (even a view) in the argument list of a call that
///      follows vm.prank / vm.expectRevert / vm.expectEmit - it would consume the cheatcode.
abstract contract ArcSLATestBase is Test {
    uint256 internal constant T0 = 1_700_000_000;
    uint256 internal constant VERIFIER_PK = 0xA11CE5;
    uint256 internal constant OTHER_PK = 0xB0B5;
    uint256 internal constant AMOUNT = 1_000e6;
    bytes32 internal constant SPEC = keccak256("arcsla.spec.v1");
    bytes32 internal constant EVIDENCE = keccak256("arcsla.evidence.v1");
    // secp256k1 group order
    uint256 internal constant SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    TestUSDC internal usdc;
    ArcSLA internal sla;

    address internal verifier;
    address internal otherSigner;
    address internal customer = makeAddr("customer");
    address internal provider = makeAddr("provider");
    address internal submitter = makeAddr("submitter");
    address internal stranger = makeAddr("stranger");
    uint64 internal deadline;

    function setUp() public virtual {
        vm.warp(T0);
        verifier = vm.addr(VERIFIER_PK);
        otherSigner = vm.addr(OTHER_PK);
        deadline = uint64(T0 + 7 days);
        usdc = new TestUSDC();
        sla = new ArcSLA(IERC20(address(usdc)));
        usdc.mint(customer, 1e30);
        vm.prank(customer);
        usdc.approve(address(sla), type(uint256).max);
    }

    /// @dev Deploy an ArcSLA over an arbitrary test token and fund + approve `customer`.
    function _deployFor(MintableERC20 tok) internal returns (ArcSLA s) {
        s = new ArcSLA(IERC20(address(tok)));
        tok.mint(customer, 1e30);
        vm.prank(customer);
        tok.approve(address(s), type(uint256).max);
    }

    function _create() internal returns (uint256) {
        return _createOn(sla, customer);
    }

    function _createOn(ArcSLA s, address cust) internal returns (uint256) {
        vm.prank(cust);
        return s.createAgreement(provider, verifier, AMOUNT, deadline, SPEC);
    }

    function _sign(ArcSLA s, uint256 pk, uint256 id, bytes32 spec, address prov, bytes32 ev, uint256 exp)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = s.fulfillmentDigest(id, spec, prov, ev, exp);
        (uint8 v, bytes32 r, bytes32 ss) = vm.sign(pk, digest);
        return abi.encodePacked(r, ss, v);
    }

    /// @dev Valid verifier signature for the default terms on `sla`.
    function _goodSig(uint256 id, uint256 exp) internal view returns (bytes memory) {
        return _sign(sla, VERIFIER_PK, id, SPEC, provider, EVIDENCE, exp);
    }

    /// @dev Release on `sla` as `submitter` with arbitrary arguments.
    function _submit(uint256 id, bytes32 spec, address prov, bytes32 ev, uint256 exp, bytes memory sig) internal {
        vm.prank(submitter);
        sla.release(id, spec, prov, ev, exp, sig);
    }

    /// @dev Fully valid release as `submitter`.
    function _release(uint256 id, uint256 exp) internal {
        bytes memory sig = _goodSig(id, exp);
        _submit(id, SPEC, provider, EVIDENCE, exp, sig);
    }

    function _refund(uint256 id) internal {
        vm.prank(customer);
        sla.refund(id);
    }

    function _status(uint256 id) internal view returns (ArcSLA.Status) {
        return sla.getAgreement(id).status;
    }
}
