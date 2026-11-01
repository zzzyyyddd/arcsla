// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ArcSLA
 * @notice Pre-funded USDC settlement for digital services on Arc.
 * @dev The verifier is TRUSTED to attest fulfillment. An EIP-712 signature proves
 * only that the verifier signed the attestation, NOT that the offchain service
 * was actually delivered. Escrowed funds can only go to the provider with a valid
 * verifier signature on or before the deadline, or back to the customer after
 * the deadline. There is no owner or admin, no fees, no upgradeability and no pause.
 * A verifier that never signs causes funds to become refundable after the deadline;
 * the customer must call refund. A colluding verifier/provider can release funds
 * to the provider. The token (native USDC, with 6 decimals) is trusted: issuer-level
 * blacklist/pause restrictions can block transfers. A blocked release or refund
 * reverts atomically and is retryable, subject to the original deadline rules.
 * No external release/refund dependency exists beyond the token. Native value
 * transfers via normal calls are not accepted; there is no receive or fallback.
 */
contract ArcSLA is EIP712, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice An agreement's mutually exclusive settlement states.
    enum Status { Active, Released, Refunded }

    /// @notice The immutable terms and settlement record of an agreement.
    /// @param customer Account funding the agreement and entitled to its refund.
    /// @param provider Account entitled to a verified release.
    /// @param verifier Trusted ECDSA signer of fulfillment attestations.
    /// @param amount Escrowed token base units (6 decimals for native USDC).
    /// @param deadline Last timestamp at which release is permitted, inclusive.
    /// @param specHash Commitment to the offchain service specification.
    /// @param status Current settlement state.
    /// @param createdAt Timestamp of funding.
    /// @param evidenceHash Commitment to fulfillment evidence; zero until release.
    struct Agreement {
        address customer;
        address provider;
        address verifier;
        uint256 amount;
        uint64 deadline;
        bytes32 specHash;
        Status status;
        uint64 createdAt;
        bytes32 evidenceHash;
    }

    /// @notice A required address was zero.
    error ZeroAddress();
    /// @notice The requested escrow amount was zero.
    error ZeroAmount();
    /// @notice The deadline is not strictly in the future.
    error InvalidDeadline();
    /// @notice The specification commitment was zero.
    error ZeroSpecHash();
    /// @notice Parties overlap or the provider/verifier is this contract or token.
    error InvalidParties();
    /// @notice The token balance increase did not equal the agreed amount.
    error AmountMismatch();
    /// @notice The agreement ID does not exist.
    error AgreementNotFound();
    /// @notice The agreement has already been released or refunded.
    error AgreementNotActive();
    /// @notice The release deadline has passed.
    error DeadlinePassed();
    /// @notice The attestation has expired.
    error AttestationExpired();
    /// @notice The supplied specification differs from the agreement.
    error SpecHashMismatch();
    /// @notice The supplied provider differs from the agreement.
    error ProviderMismatch();
    /// @notice The fulfillment evidence commitment was zero.
    error ZeroEvidenceHash();
    /// @notice Signature recovery failed or recovered a different verifier.
    error InvalidSigner();
    /// @notice Only the agreement's customer may request its refund.
    error NotCustomer();
    /// @notice The refund deadline has not yet passed.
    error RefundNotAvailable();

    /// @notice Emitted after an agreement is funded in full.
    /// @param id Sequential agreement ID.
    /// @param customer Funding customer.
    /// @param provider Service provider.
    /// @param verifier Trusted attestation signer.
    /// @param amount Escrowed token base units.
    /// @param deadline Inclusive release deadline.
    /// @param specHash Service specification commitment.
    /// @param createdAt Funding timestamp.
    event AgreementCreated(
        uint256 indexed id,
        address indexed customer,
        address indexed provider,
        address verifier,
        uint256 amount,
        uint64 deadline,
        bytes32 specHash,
        uint64 createdAt
    );

    /// @notice Emitted after a verified release transfers tokens to the provider.
    /// @param id Agreement ID.
    /// @param provider Recipient of the escrow.
    /// @param verifier Signer authorizing release.
    /// @param amount Released token base units.
    /// @param specHash Service specification commitment.
    /// @param evidenceHash Fulfillment evidence commitment.
    /// @param attestationExpiry Inclusive attestation expiry timestamp.
    /// @param submitter Account submitting the attestation.
    /// @param releasedAt Settlement timestamp.
    event AgreementReleased(
        uint256 indexed id,
        address indexed provider,
        address indexed verifier,
        uint256 amount,
        bytes32 specHash,
        bytes32 evidenceHash,
        uint256 attestationExpiry,
        address submitter,
        uint64 releasedAt
    );

    /// @notice Emitted after expired escrow is returned to its customer.
    /// @param id Agreement ID.
    /// @param customer Refund recipient.
    /// @param amount Refunded token base units.
    /// @param refundedAt Settlement timestamp.
    event AgreementRefunded(uint256 indexed id, address indexed customer, uint256 amount, uint64 refundedAt);

    /// @notice Trusted settlement token, supplied at construction rather than hardcoded.
    IERC20 public immutable usdc;

    /// @notice EIP-712 fulfillment struct type hash.
    bytes32 public constant FULFILLMENT_TYPEHASH = keccak256(
        "Fulfillment(uint256 agreementId,bytes32 specHash,address provider,bytes32 evidenceHash,uint256 expiry)"
    );

    /// @dev Agreement records keyed by sequential IDs starting at one.
    mapping(uint256 => Agreement) private _agreements;

    /// @notice Number of agreements created, including settled agreements.
    uint256 public agreementCount;

    /// @notice Sum of amounts of Active agreements, in token base units.
    /// @dev Under the trusted token model, usdc.balanceOf(address(this)) >= totalEscrowed.
    uint256 public totalEscrowed;

    /// @notice Initializes the token and the ArcSLA version 1 signing domain.
    /// @param usdc_ Trusted settlement token (native USDC on Arc).
    constructor(IERC20 usdc_) EIP712("ArcSLA", "1") {
        if (address(usdc_) == address(0)) revert ZeroAddress();
        usdc = usdc_;
    }

    /// @notice Creates and fully funds an agreement using a prior token allowance.
    /// @param provider Service provider receiving any verified release.
    /// @param verifier Trusted ECDSA fulfillment signer.
    /// @param amount Token base units to escrow.
    /// @param deadline Inclusive release deadline, strictly in the future.
    /// @param specHash Nonzero service specification commitment.
    /// @return id Sequential agreement ID, starting at one.
    function createAgreement(
        address provider,
        address verifier,
        uint256 amount,
        uint64 deadline,
        bytes32 specHash
    ) external nonReentrant returns (uint256 id) {
        if (amount == 0) revert ZeroAmount();
        if (provider == address(0) || verifier == address(0)) revert ZeroAddress();
        if (deadline <= block.timestamp) revert InvalidDeadline();
        if (specHash == bytes32(0)) revert ZeroSpecHash();
        if (
            provider == msg.sender || verifier == msg.sender || verifier == provider
                || provider == address(this) || verifier == address(this)
                || provider == address(usdc) || verifier == address(usdc)
        ) revert InvalidParties();

        id = ++agreementCount;
        uint64 createdAt = uint64(block.timestamp);
        _agreements[id] = Agreement({
            customer: msg.sender,
            provider: provider,
            verifier: verifier,
            amount: amount,
            deadline: deadline,
            specHash: specHash,
            status: Status.Active,
            createdAt: createdAt,
            evidenceHash: bytes32(0)
        });
        totalEscrowed += amount;

        uint256 balanceBefore = usdc.balanceOf(address(this));
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        uint256 balanceAfter = usdc.balanceOf(address(this));
        if (balanceAfter < balanceBefore || balanceAfter - balanceBefore != amount) revert AmountMismatch();

        emit AgreementCreated(id, msg.sender, provider, verifier, amount, deadline, specHash, createdAt);
    }

    /// @notice Computes the chain- and contract-bound EIP-712 fulfillment digest.
    /// @dev Does not validate agreement existence or the supplied attestation terms.
    /// @param agreementId Agreement ID included in the attestation.
    /// @param specHash Service specification commitment.
    /// @param provider Provider included in the attestation.
    /// @param evidenceHash Fulfillment evidence commitment.
    /// @param expiry Inclusive attestation expiry timestamp.
    /// @return EIP-712 digest to sign directly, without a personal-message prefix.
    function fulfillmentDigest(
        uint256 agreementId,
        bytes32 specHash,
        address provider,
        bytes32 evidenceHash,
        uint256 expiry
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(FULFILLMENT_TYPEHASH, agreementId, specHash, provider, evidenceHash, expiry))
        );
    }

    /// @notice Returns the current chain- and contract-bound EIP-712 domain separator.
    /// @return Current domain separator.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Releases escrow upon a valid, timely verifier attestation; anyone may submit.
    /// @param agreementId Agreement to settle.
    /// @param specHash Must match the agreement specification commitment.
    /// @param provider Must match the stored provider.
    /// @param evidenceHash Nonzero commitment to fulfillment evidence.
    /// @param expiry Inclusive attestation expiry timestamp.
    /// @param signature Verifier's 65-byte ECDSA signature over fulfillmentDigest.
    function release(
        uint256 agreementId,
        bytes32 specHash,
        address provider,
        bytes32 evidenceHash,
        uint256 expiry,
        bytes calldata signature
    ) external nonReentrant {
        Agreement storage agreement = _getAgreement(agreementId);
        if (agreement.status != Status.Active) revert AgreementNotActive();
        if (block.timestamp > agreement.deadline) revert DeadlinePassed();
        if (block.timestamp > expiry) revert AttestationExpired();
        if (specHash != agreement.specHash) revert SpecHashMismatch();
        if (provider != agreement.provider) revert ProviderMismatch();
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceHash();
        {
            bytes32 digest = fulfillmentDigest(agreementId, specHash, provider, evidenceHash, expiry);
            (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(digest, signature);
            if (err != ECDSA.RecoverError.NoError || recovered != agreement.verifier) revert InvalidSigner();
        }

        agreement.status = Status.Released;
        agreement.evidenceHash = evidenceHash;
        totalEscrowed -= agreement.amount;
        usdc.safeTransfer(provider, agreement.amount);

        emit AgreementReleased(
            agreementId, provider, agreement.verifier, agreement.amount, specHash,
            evidenceHash, expiry, msg.sender, uint64(block.timestamp)
        );
    }

    /// @notice Returns expired active escrow to its customer; only that customer may call.
    /// @param agreementId Agreement to refund, strictly after its deadline.
    function refund(uint256 agreementId) external nonReentrant {
        Agreement storage agreement = _getAgreement(agreementId);
        if (agreement.status != Status.Active) revert AgreementNotActive();
        if (msg.sender != agreement.customer) revert NotCustomer();
        if (block.timestamp <= agreement.deadline) revert RefundNotAvailable();

        agreement.status = Status.Refunded;
        totalEscrowed -= agreement.amount;
        usdc.safeTransfer(agreement.customer, agreement.amount);

        emit AgreementRefunded(agreementId, agreement.customer, agreement.amount, uint64(block.timestamp));
    }

    /// @notice Returns all terms and settlement data for an existing agreement.
    /// @param agreementId Existing agreement ID.
    /// @return Complete agreement record; nonexistent IDs revert AgreementNotFound.
    function getAgreement(uint256 agreementId) external view returns (Agreement memory) {
        return _getAgreement(agreementId);
    }

    /// @notice Reports whether an existing agreement is active and past its deadline.
    /// @param agreementId Existing agreement ID; nonexistent IDs revert AgreementNotFound.
    /// @return Whether the customer may currently refund the agreement.
    function isRefundable(uint256 agreementId) external view returns (bool) {
        Agreement storage agreement = _getAgreement(agreementId);
        return agreement.status == Status.Active && block.timestamp > agreement.deadline;
    }

    /// @dev Looks up storage after rejecting zero and IDs beyond the sequential count.
    /// @param agreementId Agreement ID to look up.
    /// @return agreement Storage reference to the existing agreement.
    function _getAgreement(uint256 agreementId) private view returns (Agreement storage agreement) {
        if (agreementId == 0 || agreementId > agreementCount) revert AgreementNotFound();
        return _agreements[agreementId];
    }
}
