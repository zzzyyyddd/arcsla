# ArcSLA — Circle Developer Grants Reviewer Brief

**Application concept:** extend an existing Arc-native USDC settlement MVP into reusable developer-facing payment infrastructure.

## Problem and approach

Digital-service payments need a transparent, programmable way to hold funds until an authorized fulfillment attestation or return funds after a deadline. ArcSLA offers an onchain USDC agreement with verifier-authorized EIP-712 release and deadline refund. It does not claim to independently verify service quality.

## What exists today

- Public [ArcSLA application](https://arc-studio-03513f4fbb9b478ebcce4c02.vercel.app/) and [mainnet demo](https://arc-studio-03513f4fbb9b478ebcce4c02.vercel.app/demo?network=mainnet).
- Arc Mainnet contract [`0x5F040Bc617666359C543bfFbE25DD00c4FfCbdAC`](https://explorer.arc.io/address/0x5F040Bc617666359C543bfFbE25DD00c4FfCbdAC?tab=contract).
- Real [USDC release](https://explorer.arc.io/tx/0x5aee3380c1c68652e7eca03a7b16bda20617976f90d6d99aa0bed46232f5ad5d) and [USDC refund](https://explorer.arc.io/tx/0x6abb3325713d120d1ad1a3949be3ba8df9a26c75b03a957735d2ef5f1245afb6).
- Public Solidity source, Foundry tests, React frontend and [security model](SECURITY.md).

## USDC integration — source walkthrough

- [`contracts/ArcSLA.sol` USDC declaration](../contracts/ArcSLA.sol): immutable `IERC20 usdc` initialized in the constructor.
- `createAgreement`: escrow funding via `usdc.safeTransferFrom` and exact-balance delta check.
- `release`: validates agreement and designated verifier's EIP-712 signature; transfers USDC to provider.
- `refund`: after expiry, returns USDC to customer.

The existing wallet connection is **not** proof of live Circle Wallets integration. Circle Wallets and SDK/API delivery are proposed work, not existing shipped functionality. No CCTP integration is claimed.

## Proposed $15,000 USDC milestones (subject to grant approval)

| Milestone | Proposed amount | Deliverables and acceptance evidence |
| --- | ---: | --- |
| 1. Wallet integration feasibility and implementation | $5,000 | Validate Circle Wallets network/API support, implement a supported user flow or document a technically justified alternative; integration tests and video |
| 2. Developer SDK/API | $5,000 | TypeScript integration surface for agreement creation, reading status, release/refund helpers; examples, tests, versioned docs |
| 3. Security hardening and pilot | $5,000 | Independent review plan and findings/remediation, operational documentation, external developer pilot attempt and honest usage report |

These are **proposed milestones**, not completed achievements or a promise of grant approval. Independent professional audit scope and budget must be agreed separately; a $5,000 milestone does not by itself guarantee a full audit.

## Adoption plan and evidence boundary

Target integration users: developer teams building escrowed digital services, milestone payments, and programmable service settlement on Arc. Initial outreach and a pilot remain future work. There is **no verified external user adoption** claimed.

## Limitations

- Trusted verifier model: signature attests authorization, not objective service delivery.
- No independent professional audit; do not use meaningful funds without further review.
- UI caps are not smart-contract-enforced.
- Existing public transactions show small-value mainnet behavior, not scaled production usage.

See [current project status](CURRENT_STATUS.md) and [Judge Guide](JUDGE_GUIDE.md).
