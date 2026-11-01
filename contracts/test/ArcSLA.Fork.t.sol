// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcSLA} from "../ArcSLA.sol";

interface IDecimals {
    function decimals() external view returns (uint8);
}

/// @dev OPTIONAL live-state test against the real Arc Testnet USDC (0x3600...). Skips unless
///      ARC_FORK_RPC is set, so the default `forge test` stays hermetic. Run with
///      ARC_FORK_RPC=https://rpc.testnet.arc.io. Uses a read-only local fork; nothing is broadcast.
///      KNOWN LIMIT: standard Foundry cannot execute Arc's USDC blocklist precompile at
///      0x1800000000000000000000000000000000000001 (it fails with StackUnderflow inside transferFrom), so
///      this test fails under plain `forge`. Run it with Arc Foundry (`arc-forge`, see docs.arc.io). It has
///      NOT passed yet, and is not counted as a pass anywhere.
contract ArcSLAForkTest is Test {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint256 internal constant VERIFIER_PK = 0xA11CE5;
    uint256 internal constant AMOUNT = 1e6;
    /// @dev Public Arc Testnet wallet from the project's lifecycle evidence. It is IMPERSONATED on a local
    ///      fork only (no key, nothing is sent to the real chain). Needed because `deal` cannot find a
    ///      storage slot in Arc's native USDC.
    address internal constant FUNDED_TESTNET_WALLET = 0xCfEfEc595970C6850777ac44A99Dd949fAc472A6;

    bool internal forked;

    function setUp() public {
        string memory rpc = vm.envOr("ARC_FORK_RPC", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
    }

    modifier onlyFork() {
        if (!forked) vm.skip(true);
        _;
    }

    function test_Fork_RealUsdc_CreateReleaseAndRefundLifecycle() public onlyFork {
        assertGt(ARC_USDC.code.length, 0, "USDC must exist on the fork");
        assertEq(IDecimals(ARC_USDC).decimals(), 6);

        ArcSLA sla = new ArcSLA(IERC20(ARC_USDC));
        address verifier = vm.addr(VERIFIER_PK);
        address customer = FUNDED_TESTNET_WALLET;
        if (IERC20(ARC_USDC).balanceOf(customer) < 2 * AMOUNT) vm.skip(true);
        address provider = makeAddr("forkProvider");

        vm.prank(customer);
        IERC20(ARC_USDC).approve(address(sla), type(uint256).max);

        uint64 dl = uint64(block.timestamp + 1 days);
        vm.startPrank(customer);
        uint256 a = sla.createAgreement(provider, verifier, AMOUNT, dl, keccak256("fork.spec"));
        uint256 b = sla.createAgreement(provider, verifier, AMOUNT, dl, keccak256("fork.spec"));
        vm.stopPrank();
        assertEq(IERC20(ARC_USDC).balanceOf(address(sla)), 2 * AMOUNT);

        bytes32 ev = keccak256("fork.evidence");
        bytes32 digest = sla.fulfillmentDigest(a, keccak256("fork.spec"), provider, ev, block.timestamp + 1 hours);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(VERIFIER_PK, digest);
        sla.release(a, keccak256("fork.spec"), provider, ev, block.timestamp + 1 hours, abi.encodePacked(r, s, v));
        assertEq(IERC20(ARC_USDC).balanceOf(provider), AMOUNT);

        vm.warp(uint256(dl) + 1);
        vm.prank(customer);
        sla.refund(b);
        assertEq(IERC20(ARC_USDC).balanceOf(address(sla)), 0);
        assertEq(sla.totalEscrowed(), 0);
    }
}
