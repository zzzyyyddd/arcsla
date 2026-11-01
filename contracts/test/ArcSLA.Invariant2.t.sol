// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ArcSLA} from "../ArcSLA.sol";
import {TestUSDC} from "./TestTokens.sol";

/// @dev Multi-actor adversarial handler: several customers / providers / verifiers with real keys,
///      valid and INVALID releases, premature / valid refunds, direct donations and time warps.
///      Every successful settlement is ghost-tracked; every attempt that MUST fail flags `badAccepted`
///      if it unexpectedly succeeds. All state checks run after every action (`_audit`).
contract ArcSLAHandler2 is Test {
    uint256 internal constant N = 3;
    uint256 internal constant SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
    uint256 internal constant INITIAL = 1e18;
    uint256 internal constant ATTACKER_PK = 0xBAD1BAD1;

    ArcSLA public sla;
    TestUSDC public usdc;

    uint256[N] public vPk;
    uint256[N] public cPk;
    uint256[N] public pPk;
    address[N] public verifiers;
    address[N] public customers;
    address[N] public providers;
    address public stranger = address(0x5712A9E6);

    // ghost accounting
    uint256 public totalCreated;
    uint256 public totalReleased;
    uint256 public totalRefunded;
    uint256 public totalDonated;
    mapping(address => uint256) public createdBy; // customer => sum created
    mapping(address => uint256) public refundedTo; // customer => sum refunded
    mapping(address => uint256) public releasedTo; // provider => sum released
    mapping(uint256 => uint8) public settleCount; // id => successful settlements observed by the handler
    mapping(uint256 => uint8) public lastStatus; // id => highest status ever observed

    // violation flags
    bool public regressed;
    bool public badAccepted;
    uint256 public calls;
    uint256 public okCreate;
    uint256 public okRelease;
    uint256 public okRefund;
    uint256 public rejectedInvalid;
    uint256 public rejectedPremature;

    constructor(ArcSLA sla_, TestUSDC usdc_) {
        sla = sla_;
        usdc = usdc_;
        for (uint256 i; i < N; ++i) {
            vPk[i] = 0xA110 + i;
            cPk[i] = 0xC110 + i;
            pPk[i] = 0xB110 + i;
            verifiers[i] = vm.addr(vPk[i]);
            customers[i] = vm.addr(cPk[i]);
            providers[i] = vm.addr(pPk[i]);
            usdc.mint(customers[i], INITIAL);
            vm.prank(customers[i]);
            usdc.approve(address(sla), type(uint256).max);
        }
    }

    // --------------------------------------------------------------- helpers

    function _pick(uint256 seed) internal view returns (uint256 id) {
        uint256 n = sla.agreementCount();
        if (n == 0) return 0;
        id = bound(seed, 1, n);
    }

    function _pkOf(address v) internal view returns (uint256) {
        for (uint256 i; i < N; ++i) if (verifiers[i] == v) return vPk[i];
        revert("unknown verifier");
    }

    function _actor(uint256 seed, ArcSLA.Agreement memory a) internal view returns (address) {
        uint256 k = seed % 5;
        if (k == 0) return a.customer;
        if (k == 1) return a.provider;
        if (k == 2) return a.verifier;
        if (k == 3) return stranger;
        return customers[(seed / 5) % N];
    }

    function _sig(uint256 pk, uint256 id, ArcSLA.Agreement memory a, bytes32 ev, uint256 expiry)
        internal
        view
        returns (uint8 v, bytes32 r, bytes32 s)
    {
        (v, r, s) = vm.sign(pk, sla.fulfillmentDigest(id, a.specHash, a.provider, ev, expiry));
    }

    modifier audited() {
        ++calls;
        _;
        _audit();
    }

    /// @dev status can only move Active(0) -> Released(1) | Refunded(2); never back, never sideways.
    function _audit() internal {
        uint256 n = sla.agreementCount();
        for (uint256 id = 1; id <= n; ++id) {
            uint8 st = uint8(sla.getAgreement(id).status);
            uint8 last = lastStatus[id];
            if (st < last || (last != 0 && st != last)) regressed = true;
            lastStatus[id] = st;
        }
    }

    // --------------------------------------------------------------- actions

    function create(uint256 cSeed, uint256 pSeed, uint256 vSeed, uint256 amount, uint256 dlOffset, bytes32 spec)
        external
        audited
    {
        amount = bound(amount, 1, 1e9);
        dlOffset = bound(dlOffset, 1, 5 days);
        if (spec == bytes32(0)) spec = bytes32(uint256(1));
        address c = customers[cSeed % N];
        if (usdc.balanceOf(c) < amount) return;
        vm.prank(c);
        sla.createAgreement(providers[pSeed % N], verifiers[vSeed % N], amount, uint64(block.timestamp + dlOffset), spec);
        totalCreated += amount;
        createdBy[c] += amount;
        ++okCreate;
    }

    function releaseValid(uint256 idSeed, bytes32 ev, uint256 expOff, uint256 whoSeed) external audited {
        uint256 id = _pick(idSeed);
        if (id == 0) return;
        ArcSLA.Agreement memory a = sla.getAgreement(id);
        if (a.status != ArcSLA.Status.Active || block.timestamp > a.deadline) return;
        if (ev == bytes32(0)) ev = bytes32(uint256(7));
        uint256 expiry = block.timestamp + bound(expOff, 0, 1 days);
        (uint8 v, bytes32 r, bytes32 s) = _sig(_pkOf(a.verifier), id, a, ev, expiry);
        address by = _actor(whoSeed, a);
        vm.prank(by);
        sla.release(id, a.specHash, a.provider, ev, expiry, abi.encodePacked(r, s, v));
        totalReleased += a.amount;
        releasedTo[a.provider] += a.amount;
        ++settleCount[id];
        ++okRelease;
    }

    function _sig65(uint256 pk, uint256 id, ArcSLA.Agreement memory a, bytes32 ev, uint256 expiry)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = _sig(pk, id, a, ev, expiry);
        return abi.encodePacked(r, s, v);
    }

    /// @dev Builds a signature that must NOT authorise release. `skipIt` for the one case that could be legitimate.
    function _forge(uint256 mode, uint256 id, ArcSLA.Agreement memory a, bytes32 ev, uint256 expiry, uint256 w)
        internal
        view
        returns (bytes memory sig, bytes32 submitEv, bool skipIt)
    {
        submitEv = ev;
        if (mode == 0) {
            sig = _sig65(ATTACKER_PK, id, a, ev, expiry); // attacker key
        } else if (mode == 1) {
            sig = _sig65(w % 2 == 0 ? cPk[w % N] : pPk[w % N], id, a, ev, expiry); // customer / provider role keys
        } else if (mode == 2) {
            uint256 j = (w % N + 1) % N;
            uint256 pk = verifiers[j] == a.verifier ? ATTACKER_PK : vPk[j]; // another verifier
            sig = _sig65(pk, id, a, ev, expiry);
        } else if (mode == 3) {
            sig = _sig65(_pkOf(a.verifier), id, a, ev, expiry); // right key, evidence tampered after signing
            submitEv = ev ^ bytes32(uint256(1) << (w % 256));
        } else if (mode == 4) {
            sig = abi.encodePacked(keccak256(abi.encode(ev, 1)), keccak256(abi.encode(ev, 2)), uint8(27 + (w % 2)));
        } else if (mode == 5) {
            uint256 len = w % 201;
            if (len == 65) len = 66;
            sig = new bytes(len); // wrong length
        } else if (mode == 6) {
            (uint8 v, bytes32 r, bytes32 s) = _sig(_pkOf(a.verifier), id, a, ev, expiry); // high-s twin
            sig = abi.encodePacked(r, bytes32(SECP_N - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        } else {
            // fully valid signature: only a MUST-revert case once the agreement can no longer settle by release
            if (a.status == ArcSLA.Status.Active && block.timestamp <= a.deadline) return (sig, ev, true);
            sig = _sig65(_pkOf(a.verifier), id, a, ev, expiry);
        }
    }

    /// @dev Every attempt here MUST revert, whatever the agreement's current state.
    function releaseInvalid(uint256 idSeed, uint256 mode, bytes32 ev, uint256 expOff, uint256 whoSeed)
        external
        audited
    {
        uint256 id = _pick(idSeed);
        if (id == 0) return;
        ArcSLA.Agreement memory a = sla.getAgreement(id);
        if (ev == bytes32(0)) ev = bytes32(uint256(9));
        uint256 expiry = block.timestamp + bound(expOff, 0, 1 days);
        (bytes memory sig, bytes32 submitEv, bool skipIt) = _forge(mode % 8, id, a, ev, expiry, whoSeed);
        if (skipIt) return;
        address by = _actor(whoSeed, a);
        vm.prank(by);
        try sla.release(id, a.specHash, a.provider, submitEv, expiry, sig) {
            badAccepted = true;
        } catch {
            ++rejectedInvalid;
        }
    }

    function refundPremature(uint256 idSeed, uint256 whoSeed) external audited {
        uint256 id = _pick(idSeed);
        if (id == 0) return;
        ArcSLA.Agreement memory a = sla.getAgreement(id);
        address by = _actor(whoSeed, a);
        bool shouldSucceed = a.status == ArcSLA.Status.Active && by == a.customer && block.timestamp > a.deadline;
        if (shouldSucceed) return; // that is refundValid's job
        vm.prank(by);
        try sla.refund(id) {
            badAccepted = true;
        } catch {
            ++rejectedPremature;
        }
    }

    function refundValid(uint256 idSeed) external audited {
        uint256 id = _pick(idSeed);
        if (id == 0) return;
        ArcSLA.Agreement memory a = sla.getAgreement(id);
        if (a.status != ArcSLA.Status.Active || block.timestamp <= a.deadline) return;
        vm.prank(a.customer);
        sla.refund(id);
        totalRefunded += a.amount;
        refundedTo[a.customer] += a.amount;
        ++settleCount[id];
        ++okRefund;
    }

    function donate(uint256 amount) external audited {
        amount = bound(amount, 0, 1e9);
        usdc.mint(address(sla), amount);
        totalDonated += amount;
    }

    function warp(uint256 dt) external audited {
        skip(bound(dt, 0, 3 days));
    }
}

contract ArcSLAInvariant2Test is Test {
    ArcSLA internal sla;
    TestUSDC internal usdc;
    ArcSLAHandler2 internal h;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new TestUSDC();
        sla = new ArcSLA(IERC20(address(usdc)));
        h = new ArcSLAHandler2(sla, usdc);
        targetContract(address(h));
        bytes4[] memory sel = new bytes4[](7);
        sel[0] = ArcSLAHandler2.create.selector;
        sel[1] = ArcSLAHandler2.releaseValid.selector;
        sel[2] = ArcSLAHandler2.releaseInvalid.selector;
        sel[3] = ArcSLAHandler2.refundPremature.selector;
        sel[4] = ArcSLAHandler2.refundValid.selector;
        sel[5] = ArcSLAHandler2.donate.selector;
        sel[6] = ArcSLAHandler2.warp.selector;
        targetSelector(FuzzSelector({addr: address(h), selectors: sel}));
    }

    /// @dev Coverage sanity (printed with -vv): how many of each action succeeded in the last run.
    function afterInvariant() public view {
        console2.log("calls", h.calls());
        console2.log("okCreate", h.okCreate());
        console2.log("okRelease", h.okRelease());
        console2.log("okRefund", h.okRefund());
        console2.log("rejectedInvalid", h.rejectedInvalid());
        console2.log("rejectedPremature", h.rejectedPremature());
    }

    function _sums() internal view returns (uint256 active, uint256 released, uint256 refunded) {
        uint256 n = sla.agreementCount();
        for (uint256 id = 1; id <= n; ++id) {
            ArcSLA.Agreement memory a = sla.getAgreement(id);
            if (a.status == ArcSLA.Status.Active) active += a.amount;
            else if (a.status == ArcSLA.Status.Released) released += a.amount;
            else refunded += a.amount;
        }
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 128
    function invariant_BalanceCoversEscrowAndEqualsEscrowPlusDonations() public view {
        uint256 bal = usdc.balanceOf(address(sla));
        assertGe(bal, sla.totalEscrowed(), "balance >= totalEscrowed");
        assertEq(bal, sla.totalEscrowed() + h.totalDonated(), "balance == escrow + donations (no leaks, no surprises)");
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 128
    function invariant_TotalEscrowedEqualsSumOfActiveAgreements() public view {
        (uint256 active,,) = _sums();
        assertEq(sla.totalEscrowed(), active);
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 128
    function invariant_ConservationCreatedEqualsEscrowedPlusReleasedPlusRefunded() public view {
        assertEq(h.totalCreated(), sla.totalEscrowed() + h.totalReleased() + h.totalRefunded());
        (uint256 active, uint256 released, uint256 refunded) = _sums();
        assertEq(h.totalCreated(), active + released + refunded, "on-chain statuses add up");
        assertEq(released, h.totalReleased(), "on-chain Released sum == ghost");
        assertEq(refunded, h.totalRefunded(), "on-chain Refunded sum == ghost");
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 128
    function invariant_StatusNeverRegressesAndSettlesAtMostOnce() public view {
        assertFalse(h.regressed(), "status regressed or changed after settlement");
        uint256 n = sla.agreementCount();
        for (uint256 id = 1; id <= n; ++id) {
            assertLe(h.settleCount(id), 1, "settled more than once");
            ArcSLA.Status st = sla.getAgreement(id).status;
            assertEq(h.settleCount(id) == 1, st != ArcSLA.Status.Active, "settleCount matches terminal status");
        }
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 128
    function invariant_NoInvalidAttemptEverSucceeded() public view {
        assertFalse(h.badAccepted(), "an attempt that must fail succeeded");
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 128
    function invariant_ProvidersReceivedExactlyReleasedAmounts() public view {
        uint256 sum;
        for (uint256 i; i < 3; ++i) {
            address p = h.providers(i);
            assertEq(usdc.balanceOf(p), h.releasedTo(p), "provider balance == released to provider");
            sum += usdc.balanceOf(p);
        }
        assertEq(sum, h.totalReleased());
    }

    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 128
    function invariant_CustomersNetEqualsRefundsOnlyAndOthersUntouched() public view {
        for (uint256 i; i < 3; ++i) {
            address c = h.customers(i);
            assertEq(usdc.balanceOf(c), 1e18 - h.createdBy(c) + h.refundedTo(c), "customer net");
            assertEq(usdc.balanceOf(h.verifiers(i)), 0, "verifier never receives funds");
        }
        assertEq(usdc.balanceOf(h.stranger()), 0, "stranger never receives funds");
    }
}
