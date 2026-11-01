// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArcSLA} from "../ArcSLA.sol";
import {ArcSLATestBase} from "./ArcSLA.Base.t.sol";

/// @dev Adversarial fixture: every role has a real private key; adds raw-digest signing helpers.
///      Contains no test functions (inherited by many files).
abstract contract ArcSLAAdvBase is ArcSLATestBase {
    uint256 internal customerPk;
    uint256 internal providerPk;
    uint256 internal submitterPk;
    uint256 internal strangerPk;
    uint256 internal constant RANDOM_PK = 0xDEADBEEF1234;

    uint256 internal providerStart; // provider's token balance before any release (0 unless a test seeds it)
    uint256 internal exp;
    uint256 internal id;

    struct F {
        uint256 id;
        bytes32 spec;
        address prov;
        bytes32 ev;
        uint256 exp;
    }

    bytes32 internal constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    string internal constant FULFILL_TYPE =
        "Fulfillment(uint256 agreementId,bytes32 specHash,address provider,bytes32 evidenceHash,uint256 expiry)";

    function setUp() public virtual override {
        // keyed actors must be in place before the base fixture mints / approves for them
        (customer, customerPk) = makeAddrAndKey("customer");
        (provider, providerPk) = makeAddrAndKey("provider");
        (submitter, submitterPk) = makeAddrAndKey("submitter");
        (stranger, strangerPk) = makeAddrAndKey("stranger");
        super.setUp();
        exp = T0 + 1 days;
        id = _create();
    }

    function _f(uint256 id_) internal view returns (F memory) {
        return F(id_, SPEC, provider, EVIDENCE, exp);
    }

    function _rsv(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sigF(uint256 pk, F memory f) internal view returns (bytes memory) {
        return _sign(sla, pk, f.id, f.spec, f.prov, f.ev, f.exp);
    }

    function _structHash(string memory typeStr, F memory f) internal pure returns (bytes32) {
        return keccak256(abi.encode(keccak256(bytes(typeStr)), f.id, f.spec, f.prov, f.ev, f.exp));
    }

    function _domainHash(string memory name, string memory ver, uint256 cid, address vc)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, keccak256(bytes(name)), keccak256(bytes(ver)), cid, vc));
    }

    function _manualDigest(string memory typeStr, string memory name, string memory ver, uint256 cid, address vc, F memory f)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked("\x19\x01", _domainHash(name, ver, cid, vc), _structHash(typeStr, f)));
    }

    /// @dev Submit `f` with `sig` as `submitter` and expect revert `err`.
    function _expectRejected(F memory f, bytes memory sig, bytes4 err) internal {
        vm.expectRevert(err);
        vm.prank(submitter);
        sla.release(f.id, f.spec, f.prov, f.ev, f.exp, sig);
    }

    function _assertStillActive(uint256 id_) internal view {
        assertEq(uint8(_status(id_)), uint8(ArcSLA.Status.Active), "must still be Active");
        assertEq(usdc.balanceOf(provider), providerStart, "provider must be unpaid");
    }

    function _releaseF(F memory f, bytes memory sig, address by) internal {
        vm.prank(by);
        sla.release(f.id, f.spec, f.prov, f.ev, f.exp, sig);
    }
}
