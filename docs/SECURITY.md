# ArcSLA security model and trust assumptions

Version 1 is an immutable contract: no owner, no admin, no fees, no proxy, no pause, no upgrade path.

## What the contract guarantees

- Escrowed USDC can leave the contract only two ways:
  1. To the agreement's **provider**, in `release`, if a valid EIP-712 signature from the agreement's **verifier** is submitted at or before the deadline and at or before the attestation expiry.
  2. To the agreement's **customer**, in `refund`, strictly after the deadline, if the agreement is still Active.
- `release` and `refund` are mutually exclusive in status (Active becomes Released or Refunded exactly once) and in time (release up to and including the deadline, refund only after it).
- Status is updated before tokens move (checks, effects, interactions) and all three state-changing functions are `nonReentrant`.
- Signatures are bound to the agreement ID, specification hash, provider, evidence hash and expiry, and to this contract and chain through the EIP-712 domain. A signature cannot be replayed on another agreement, another ArcSLA deployment, or another chain ID. Settled agreements cannot be settled again.
- Token transfers use SafeERC20. Funding measures the balance change and reverts unless exactly the agreed amount arrived.
- No external call is needed to execute a valid release or refund beyond the USDC token itself.

## What you must trust

| Assumption | Consequence if it fails |
| --- | --- |
| **The verifier tells the truth.** | A signature proves only that the verifier signed. It does **not** prove the offchain service was delivered. A dishonest or compromised verifier can release funds for undelivered work. A verifier who never signs leaves the provider unpaid; the customer is refunded after the deadline. |
| **Verifier and provider do not collude** (and the customer picked an independent verifier). | Colluding verifier and provider can release the escrow to the provider. |
| **The verifier's key is safe.** | A stolen verifier key can sign attestations for that verifier's active agreements. |
| **The USDC token behaves as a standard ERC-20.** | Issuer-level blacklisting or pausing can make a release or refund revert. The revert is atomic (the agreement stays Active) and retryable later, but a release can no longer happen after the deadline. A token that re-enters is blocked by the reentrancy guard. |
| **Chain timestamps are approximately honest.** | Deadlines and expiries use `block.timestamp`, so block producers have small influence at the exact boundary. |

## Design choices worth knowing

- Verifier signatures are plain ECDSA, 65 bytes. 64-byte EIP-2098 compact signatures are rejected; expand them to 65 bytes.
- A customer blocked by the USDC issuer cannot receive a refund until unblocked, and a blocked provider cannot receive a release (the customer can then refund after the deadline).
- Tokens sent to the contract outside `createAgreement` are stranded and never affect accounting.
- Verifier signatures are plain ECDSA (65-byte) signatures. Smart-contract wallets (ERC-1271) are not supported as verifiers in v1.
- The release window includes the deadline second; the refund window begins one second later.
- A refund can only be requested by the customer account. Anyone may submit a valid release.
- The customer, provider and verifier must be three distinct accounts, and none may be the contract or the token.
- The contract rejects native value: there is no `receive` or `fallback`.

## Verification status

- Automated tests: see the README and `docs/SECURITY_REVIEW.md` for the exact results of the latest run.
- A balanced automated review and Slither found no high or medium issues. This is not a substitute for an independent professional audit, which you should obtain before any mainnet use.

## Reporting

Treat any suspected defect as sensitive. Do not deploy to mainnet until an independent audit is complete.
