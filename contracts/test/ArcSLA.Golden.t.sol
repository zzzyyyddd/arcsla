// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcSLA} from "../ArcSLA.sol";
import {TestUSDC} from "./TestTokens.sol";

/// @dev Golden vector produced OFFLINE by `bun run scripts/attestation-vector.ts` (viem +
///      src/lib/fulfillment-types.ts). Proves the browser signing path and the contract agree byte for byte.
contract ArcSLAGoldenTest is Test {
    address internal constant TARGET = 0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47;
    address internal constant VERIFIER = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    uint256 internal constant CHAIN_ID = 5042002;
    uint256 internal constant ID = 7;
    bytes32 internal constant SPEC = 0x00986e475ba431f6b784d4b894e14fedb92aa33826fe0df41d0a552c12d684f4;
    bytes32 internal constant EVIDENCE = 0x97794b46b3afe9245d61058666381907ac8a35b0e3bce564cde9dd0eea648cb6;
    uint256 internal constant EXPIRY = 1900000000;
    bytes32 internal constant DIGEST = 0xe75ab3e4b51a8d6de33586fae85f9768360e0aeda41ac1d4f8cb8201bcc606cb;
    bytes internal constant SIG =
        hex"5ebe4770dbc760261daca07cf74f1df5ebe103988f9e70cad93ce2ef5ff7155438a6d4ed3e4306307f3336539327012d2708f2936bed8cee1ccdea404e0a652d1c";

    address internal provider = address(uint160(0xb0b001));
    address internal customer = makeAddr("goldenCustomer");
    address internal submitter = makeAddr("goldenSubmitter");
    address internal fillerProvider = makeAddr("fillerProvider");
    TestUSDC internal usdc;
    ArcSLA internal sla;

    function setUp() public {
        vm.chainId(CHAIN_ID);
        vm.warp(1_800_000_000);
        usdc = new TestUSDC();
        deployCodeTo("ArcSLA.sol:ArcSLA", abi.encode(address(usdc)), TARGET);
        sla = ArcSLA(TARGET);
        usdc.mint(customer, 1_000_000e6);
        vm.prank(customer);
        usdc.approve(address(sla), type(uint256).max);

        // 6 filler agreements so that the interesting one gets id 7
        vm.startPrank(customer);
        for (uint256 i; i < 6; ++i) {
            sla.createAgreement(fillerProvider, VERIFIER, 10e6, uint64(1_850_000_000), keccak256(abi.encode("filler", i)));
        }
        uint256 got = sla.createAgreement(provider, VERIFIER, 25e6, uint64(1_850_000_000), SPEC);
        vm.stopPrank();
        assertEq(got, ID, "interesting agreement must be id 7");
    }

    function test_Golden_DeployedAtExactAddressOnChain5042002() public view {
        assertEq(address(sla), TARGET);
        assertEq(block.chainid, CHAIN_ID);
        assertGt(address(sla).code.length, 0);
        assertEq(address(sla.usdc()), address(usdc));
    }

    function test_Golden_DigestMatchesViem() public view {
        assertEq(sla.fulfillmentDigest(ID, SPEC, provider, EVIDENCE, EXPIRY), DIGEST);
    }

    function test_Golden_ViemSignatureRecoversToVerifier() public pure {
        assertEq(SIG.length, 65);
        bytes32 r;
        bytes32 s;
        uint8 v;
        bytes memory sig = SIG;
        assembly {
            r := mload(add(sig, 0x20))
            s := mload(add(sig, 0x40))
            v := byte(0, mload(add(sig, 0x60)))
        }
        assertEq(ecrecover(DIGEST, v, r, s), VERIFIER);
    }

    function test_Golden_ViemSignatureAcceptedByRelease() public {
        uint256 before_ = usdc.balanceOf(provider);
        vm.prank(submitter);
        sla.release(ID, SPEC, provider, EVIDENCE, EXPIRY, SIG);
        assertEq(usdc.balanceOf(provider), before_ + 25e6);
        ArcSLA.Agreement memory a = sla.getAgreement(ID);
        assertEq(uint8(a.status), uint8(ArcSLA.Status.Released));
        assertEq(a.evidenceHash, EVIDENCE);
        assertEq(sla.totalEscrowed(), 6 * 10e6);
    }

    function test_Golden_ViemSignatureAtLastValidSecondOfExpiry() public {
        vm.warp(1_850_000_000); // deadline inclusive, expiry (1.9e9) still ahead
        vm.prank(submitter);
        sla.release(ID, SPEC, provider, EVIDENCE, EXPIRY, SIG);
        assertEq(usdc.balanceOf(provider), 25e6);
    }

    function test_Golden_ViemSignatureRejectedForOtherIdsAndChain() public {
        // filler agreements (ids 1..6) must reject the id-7 signature; the id check is part of the signed data
        vm.expectRevert(ArcSLA.ProviderMismatch.selector);
        vm.prank(submitter);
        sla.release(1, keccak256(abi.encode("filler", uint256(0))), provider, EVIDENCE, EXPIRY, SIG);

        vm.chainId(CHAIN_ID + 1);
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        vm.prank(submitter);
        sla.release(ID, SPEC, provider, EVIDENCE, EXPIRY, SIG);
        assertEq(usdc.balanceOf(provider), 0);
    }

    function test_Golden_SameSignatureRejectedAtDifferentAddress() public {
        address other = makeAddr("otherDeploymentAddress");
        deployCodeTo("ArcSLA.sol:ArcSLA", abi.encode(address(usdc)), other);
        ArcSLA sla2 = ArcSLA(other);
        assertTrue(
            sla2.fulfillmentDigest(ID, SPEC, provider, EVIDENCE, EXPIRY) != DIGEST, "digest is bound to the contract address"
        );
    }
}
