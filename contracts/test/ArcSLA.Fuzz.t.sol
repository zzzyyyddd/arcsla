// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLATestBase} from "./ArcSLA.Base.t.sol";

contract ArcSLAFuzzTest is ArcSLATestBase {
    function _supplyHeld(address who) internal view returns (uint256) {
        return usdc.balanceOf(customer) + usdc.balanceOf(provider) + usdc.balanceOf(address(sla))
            + usdc.balanceOf(who);
    }

    function testFuzz_CreateAgreement_StoresTermsAndEscrowsExactAmount(
        uint256 amount,
        uint256 dlOffset,
        bytes32 spec,
        address prov,
        address ver
    ) public {
        amount = bound(amount, 1, 1e29);
        dlOffset = bound(dlOffset, 1, 3650 days);
        vm.assume(spec != bytes32(0));
        vm.assume(prov != address(0) && ver != address(0) && prov != ver);
        vm.assume(prov != customer && ver != customer);
        vm.assume(prov != address(sla) && ver != address(sla) && prov != address(usdc) && ver != address(usdc));
        uint64 dl = uint64(block.timestamp + dlOffset);

        uint256 custBefore = usdc.balanceOf(customer);
        vm.prank(customer);
        uint256 id = sla.createAgreement(prov, ver, amount, dl, spec);

        ArcSLA.Agreement memory a = sla.getAgreement(id);
        assertEq(a.amount, amount);
        assertEq(a.provider, prov);
        assertEq(a.verifier, ver);
        assertEq(a.deadline, dl);
        assertEq(a.specHash, spec);
        assertEq(usdc.balanceOf(customer), custBefore - amount);
        assertEq(usdc.balanceOf(address(sla)), amount);
        assertEq(sla.totalEscrowed(), amount);
    }

    function testFuzz_CreateAgreement_DeadlineNotInFutureReverts(uint64 dl) public {
        dl = uint64(bound(dl, 0, T0));
        vm.expectRevert(ArcSLA.InvalidDeadline.selector);
        vm.prank(customer);
        sla.createAgreement(provider, verifier, AMOUNT, dl, SPEC);
    }

    function testFuzz_Release_ConservesAmount(
        uint256 amount,
        bytes32 evidence,
        address anySubmitter,
        uint256 warpOff,
        uint256 expOff
    ) public {
        amount = bound(amount, 1, 1e29);
        vm.assume(evidence != bytes32(0));
        vm.assume(anySubmitter != address(sla) && anySubmitter != address(0));
        vm.assume(anySubmitter != provider && anySubmitter != customer);
        warpOff = bound(warpOff, 0, deadline - T0);
        expOff = bound(expOff, 0, 30 days);

        vm.prank(customer);
        uint256 id = sla.createAgreement(provider, verifier, amount, deadline, SPEC);

        vm.warp(T0 + warpOff);
        uint256 e = block.timestamp + expOff;
        uint256 heldBefore = usdc.balanceOf(customer) + usdc.balanceOf(provider) + usdc.balanceOf(address(sla));
        uint256 subBefore = usdc.balanceOf(anySubmitter);
        bytes memory sig = _sign(sla, VERIFIER_PK, id, SPEC, provider, evidence, e);

        vm.prank(anySubmitter);
        sla.release(id, SPEC, provider, evidence, e, sig);

        assertEq(usdc.balanceOf(provider), amount, "provider got exactly amount");
        assertEq(usdc.balanceOf(address(sla)), 0);
        assertEq(usdc.balanceOf(anySubmitter), subBefore, "submitter unaffected");
        assertEq(
            usdc.balanceOf(customer) + usdc.balanceOf(provider) + usdc.balanceOf(address(sla)), heldBefore
        );
        assertEq(sla.totalEscrowed(), 0);
        assertEq(sla.getAgreement(id).evidenceHash, evidence);
    }

    function testFuzz_Refund_ConservesAmount(uint256 amount, uint256 lateness) public {
        amount = bound(amount, 1, 1e29);
        lateness = bound(lateness, 1, 3650 days);
        vm.prank(customer);
        uint256 id = sla.createAgreement(provider, verifier, amount, deadline, SPEC);
        uint256 custBefore = usdc.balanceOf(customer);

        vm.warp(uint256(deadline) + lateness);
        _refund(id);

        assertEq(usdc.balanceOf(customer), custBefore + amount);
        assertEq(usdc.balanceOf(address(sla)), 0);
        assertEq(sla.totalEscrowed(), 0);
    }

    function testFuzz_Release_RandomSignerRejected(uint256 pk, bytes32 evidence) public {
        pk = bound(pk, 1, SECP_N - 1);
        vm.assume(vm.addr(pk) != verifier);
        vm.assume(evidence != bytes32(0));
        uint256 id = _create();
        uint256 e = T0 + 1 days;
        bytes memory sig = _sign(sla, pk, id, SPEC, provider, evidence, e);

        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, evidence, e, sig);
        assertEq(uint8(_status(id)), uint8(ArcSLA.Status.Active));
        assertEq(usdc.balanceOf(provider), 0);
    }

    function testFuzz_Release_RandomBytesSignatureRejected(bytes memory sig) public {
        uint256 id = _create();
        uint256 e = T0 + 1 days;
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, EVIDENCE, e, sig);
    }

    function testFuzz_Release_TamperedEvidenceRejected(bytes32 evidence) public {
        vm.assume(evidence != bytes32(0) && evidence != EVIDENCE);
        uint256 id = _create();
        uint256 e = T0 + 1 days;
        bytes memory sig = _goodSig(id, e);
        vm.expectRevert(ArcSLA.InvalidSigner.selector);
        _submit(id, SPEC, provider, evidence, e, sig);
    }
}
