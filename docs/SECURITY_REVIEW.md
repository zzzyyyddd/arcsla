# ArcSLA pre-mainnet security review

Date: 2026-10-29. Scope: `contracts/ArcSLA.sol` (unchanged since the Arc Testnet deployment) and its frontend integration.

This is an internal, tool-assisted review. It is **not** an audit certification and not a substitute for an independent professional audit.

## Method
- Source review by two independent reviewers at the deepest tier (rule-based and behavior/adversary-based).
- Slither static analysis.
- Adversarial Foundry suite added to the existing suite (see below).
- Manual review of the frontend integration (typed-data signing, transaction flows, input validation, configuration).
- A golden vector: the browser signing path (viem, using the frontend's own typed-data definition) is produced by `scripts/attestation-vector.ts` and checked against the contract at the deployed address and chain ID.

## Results
| Check | Result |
| --- | --- |
| `forge test` | 201 passed, 0 failed, 1 skipped (202 total) |
| Skipped test | Optional fork test against real Arc Testnet USDC. Not run (needs `ARC_FORK_RPC`). Not counted as a pass. |
| Slither | No High. 1 Medium (`unused-return` on `ECDSA.tryRecover`, the error value is checked) and 4 Low (`timestamp`, intentional deadline logic). Reviewed as false positives. |
| `bun run check` (lint + typecheck) | 0 warnings, 0 errors |
| Contract changes | None. Deployed bytecode and source are unchanged. |

### Test suites
| Suite | Tests |
| --- | --- |
| Create / Release / Refund / Security / Reentrancy / Fuzz / Invariant (original) | 87 |
| Adversarial (signatures, tampering, replay, encodings) | 38 |
| Boundary (deadline and expiry timing) | 18 |
| Roles | 18 |
| Token failure | 14 |
| Hooks (callback reentrancy, read-only reentrancy) | 12 |
| Golden (viem vector) | 7 |
| Invariant2 (multi-actor, donations, conservation) | 7 |
| Fork (skipped) | 1 skipped |

## Findings and disposition
| # | Severity | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | High (design) | A provider blocked by the USDC issuer cannot receive a release. The release reverts atomically, funds stay escrowed, and the customer can refund after the deadline. | Accepted and documented. Fixing it needs a pull-payment credit model, which would change the requested atomic-release rules. |
| 2 | Medium | 64-byte EIP-2098 compact signatures are rejected with `InvalidSigner`. The same signature in 65-byte form works. | Accepted. Wallets and the frontend produce 65-byte signatures (verified by the golden vector). No funds at risk. |
| 3 | Info | A customer blocked by the issuer cannot receive a refund until unblocked. | Accepted and documented. Issuer-level dependency. |
| 4 | Info | Transient read-only reentrancy window inside `createAgreement`: state is stored before the token pull. Only a third-party contract reading ArcSLA from inside a token callback could be misled. | Accepted. ArcSLA's own functions are guarded. USDC has no transfer hooks. |
| 5 | Low | Custom errors carry no context parameters. | Not changed. It would alter the deployed ABI for diagnostics only. |
| 6 | Info | Donated or forced tokens are stranded in the contract. They never affect accounting or settlement. | Accepted. No recovery path by design (no admin). |
| 7 | Frontend | Create and Verifier forms accepted an all-zero hash and reserved contract addresses, which the contract then rejected. | Fixed: client-side validation. Also added a warning for deadlines more than 30 days away. |

No fund-loss, access-control, replay or accounting defect was confirmed.

## Arc Testnet lifecycle evidence (user-provided, independently checked)

The transaction hashes below were supplied by the project owner. On 2026-10-30 each was re-read from the Arc Testnet RPC (`https://rpc.testnet.arc.io`, chain ID 5042002) and the decoded ArcSLA events and contract state match. This is testnet evidence only; it says nothing about mainnet.

Contract: `0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47` (deployed in tx `0xa94ee19a400f3c863362c0fbab49cf40abbef7772bb8d5a1c02210bd214df0c6`, block 69654812).

| Lifecycle step | Tx hash | Block | Result read from the chain |
| --- | --- | --- | --- |
| Release (EIP-712 attestation) | [`0xc3f34d15b779d2c570e8f8f513593bd25eb6f1487534007eb4a5a08b98f194c3`](https://explorer.testnet.arc.io/tx/0xc3f34d15b779d2c570e8f8f513593bd25eb6f1487534007eb4a5a08b98f194c3) | 69658526 | Status success. `AgreementReleased` for agreement #1: 1.000000 USDC to provider `0x9E2c6c57996f4b321d411462DF0D4d634c3C69Fc`, signed by verifier `0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3`, submitted by the customer wallet `0xCfEfEc595970C6850777ac44A99Dd949fAc472A6`. Released before the agreement deadline. Agreement #1 now has status Released with the evidence hash stored. 133,622 gas. |
| Refund (after deadline) | [`0x84315c8040879c04147375471694d395db007b70afeadf798fe1a9f3b2f53e9e`](https://explorer.testnet.arc.io/tx/0x84315c8040879c04147375471694d395db007b70afeadf798fe1a9f3b2f53e9e) | 69664776 | Status success. `AgreementRefunded` for agreement #2: 1.000000 USDC back to customer `0xCfEfEc595970C6850777ac44A99Dd949fAc472A6`, recorded after the deadline. Agreement #2 now has status Refunded. 68,350 gas. |

Also read from the chain: `totalEscrowed()` is 0, so no testnet escrow remains outstanding.

Not covered by this evidence: a rejected (invalid-signature) transaction on testnet, issuer-blocklist behavior, and any mainnet behavior.

## Remaining risks before any mainnet use
1. **Verifier trust.** A dishonest, colluding or compromised verifier can release funds for undelivered work. A verifier that never signs means the customer waits until the deadline for a refund.
2. **USDC issuer controls.** Blocklisting a provider or customer can block a release or refund. Nothing in ArcSLA can route around it.
3. **Deadline lock.** A customer can set a very distant deadline and lock their own funds. The UI warns beyond 30 days; the contract does not cap it.
4. **Limited real-USDC evidence.** The local EVM cannot reproduce Arc's native-USDC rules or blocklist enforcement. One release and one refund have now succeeded on Arc Testnet (see the evidence section above), but issuer-blocklist behavior is still unexercised, the optional fork test has not been run, and nothing has run on mainnet.
5. **No independent audit.** The reviews here are automated or agent-assisted.
6. **No admin, no pause.** There is no emergency stop. A defect after deployment cannot be patched in place.
7. **Frontend not covered by automated browser tests.** It has lint, typecheck, a production build and a golden signing vector, but no end-to-end wallet test.

## Mainnet readiness
Not ready to be treated as production-ready. Contract logic held up under the adversarial suite with no confirmed vulnerability, but before a separate mainnet deployment you should:
- ~~run the full lifecycle on Arc Testnet and record the transactions~~ (release and refund recorded above);
- run the fork test against Arc Testnet (`ARC_FORK_RPC=<rpc> forge test --match-path 'contracts/test/ArcSLA.Fork.t.sol'`);
- obtain an independent professional audit;
- decide whether the issuer-blocklist and verifier-trust risks above are acceptable for your users;
- deploy from your own wallet outside Arc Studio and follow `docs/MAINNET_EVIDENCE_CHECKLIST.md`.
