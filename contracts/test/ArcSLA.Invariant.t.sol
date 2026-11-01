// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcSLA} from "../ArcSLA.sol";
import {TestUSDC} from "./TestTokens.sol";

/// @dev Drives bounded create / release / refund / time-warp actions against ArcSLA.
contract ArcSLAHandler is Test {
    ArcSLA public sla;
    TestUSDC public usdc;
    uint256 public immutable verifierPk;
    address public verifier;
    address[3] public customers;
    address[3] public providers;
    address public submitter = address(0x5B);

    uint256 public ghostCreated;
    uint256 public ghostReleased;
    uint256 public ghostRefunded;

    constructor(ArcSLA sla_, TestUSDC usdc_, uint256 verifierPk_) {
        sla = sla_;
        usdc = usdc_;
        verifierPk = verifierPk_;
        verifier = vm.addr(verifierPk_);
        for (uint256 i; i < 3; ++i) {
            customers[i] = address(uint160(0xC0000 + i));
            providers[i] = address(uint160(0xD0000 + i));
            usdc.mint(customers[i], 1e30);
            vm.prank(customers[i]);
            usdc.approve(address(sla), type(uint256).max);
        }
    }

    function create(uint256 cSeed, uint256 pSeed, uint256 amount, uint256 dlOffset, bytes32 spec) external {
        amount = bound(amount, 1, 1e12);
        dlOffset = bound(dlOffset, 1, 10 days);
        if (spec == bytes32(0)) spec = bytes32(uint256(1));
        vm.prank(customers[cSeed % 3]);
        sla.createAgreement(providers[pSeed % 3], verifier, amount, uint64(block.timestamp + dlOffset), spec);
        ++ghostCreated;
    }

    function release(uint256 idSeed, bytes32 evidence, uint256 expOffset) external {
        uint256 n = sla.agreementCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        ArcSLA.Agreement memory a = sla.getAgreement(id);
        if (a.status != ArcSLA.Status.Active || block.timestamp > a.deadline) return;
        if (evidence == bytes32(0)) evidence = bytes32(uint256(1));
        uint256 expiry = block.timestamp + bound(expOffset, 0, 1 days);
        bytes32 digest = sla.fulfillmentDigest(id, a.specHash, a.provider, evidence, expiry);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(verifierPk, digest);
        vm.prank(submitter);
        sla.release(id, a.specHash, a.provider, evidence, expiry, abi.encodePacked(r, s, v));
        ++ghostReleased;
    }

    function refund(uint256 idSeed) external {
        uint256 n = sla.agreementCount();
        if (n == 0) return;
        uint256 id = bound(idSeed, 1, n);
        ArcSLA.Agreement memory a = sla.getAgreement(id);
        if (a.status != ArcSLA.Status.Active || block.timestamp <= a.deadline) return;
        vm.prank(a.customer);
        sla.refund(id);
        ++ghostRefunded;
    }

    function warp(uint256 dt) external {
        skip(bound(dt, 0, 4 days));
    }
}

contract ArcSLAInvariantTest is Test {
    uint256 internal constant VERIFIER_PK = 0xA11CE5;
    ArcSLA internal sla;
    TestUSDC internal usdc;
    ArcSLAHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new TestUSDC();
        sla = new ArcSLA(IERC20(address(usdc)));
        handler = new ArcSLAHandler(sla, usdc, VERIFIER_PK);
        targetContract(address(handler));
        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = ArcSLAHandler.create.selector;
        selectors[1] = ArcSLAHandler.release.selector;
        selectors[2] = ArcSLAHandler.refund.selector;
        selectors[3] = ArcSLAHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
    }

    function _activeSum() internal view returns (uint256 sum) {
        uint256 n = sla.agreementCount();
        for (uint256 id = 1; id <= n; ++id) {
            ArcSLA.Agreement memory a = sla.getAgreement(id);
            if (a.status == ArcSLA.Status.Active) sum += a.amount;
        }
    }

    function invariant_TokenBalanceCoversTotalEscrowed() public view {
        assertGe(usdc.balanceOf(address(sla)), sla.totalEscrowed());
    }

    function invariant_TotalEscrowedEqualsSumOfActiveAgreements() public view {
        assertEq(sla.totalEscrowed(), _activeSum());
    }

    function invariant_AgreementCountMatchesHandlerCreations() public view {
        assertEq(sla.agreementCount(), handler.ghostCreated());
        assertLe(handler.ghostReleased() + handler.ghostRefunded(), handler.ghostCreated());
    }
}
