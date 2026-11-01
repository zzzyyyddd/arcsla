# ArcSLA deployment readiness checklist

Status as of 2026-10-30. Update this file yourself as items change. **A passing test suite is not mainnet readiness.** Do not tick an item you have not verified yourself. Mainnet transactions are irreversible and involve real funds; read the warning at the top of `docs/MAINNET_DEPLOYMENT.md` first.

Overall status: **NOT READY for mainnet.** See "Open blockers".

## 1. Testnet evidence
| Item | Status | Detail |
| --- | --- | --- |
| Contract deployed on Arc Testnet | Done | `0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47`, tx `0xa94ee19a400f3c863362c0fbab49cf40abbef7772bb8d5a1c02210bd214df0c6`, block 69654812 |
| Release (EIP-712) succeeded | Done (user-provided, re-read from the chain) | `0xc3f34d15b779d2c570e8f8f513593bd25eb6f1487534007eb4a5a08b98f194c3` |
| Refund after deadline succeeded | Done (user-provided, re-read from the chain) | `0x84315c8040879c04147375471694d395db007b70afeadf798fe1a9f3b2f53e9e` |
| Invalid-signature rejection observed on testnet | Open | Only a simulation exists (Verifier console). No onchain record. |
| Issuer-blocklist behavior observed | Open | Not exercised anywhere. |

## 2. Automated tests
| Item | Status | Detail |
| --- | --- | --- |
| Hermetic `forge test` | 202 passed, 0 failed, 1 skipped (203 total) | Includes the deploy-script guard test. |
| Frontend lint and typecheck | Passing | `bun run check` |
| Frontend production build | Passing | `bunx vite build` |
| Fork test against real Arc USDC | **Blocked, not passed** | `contracts/test/ArcSLA.Fork.t.sol` fails under standard Foundry because Arc's USDC calls a blocklist precompile (`0x1800…0001`) that plain `forge` cannot execute (`StackUnderflow`). It needs Arc Foundry (`arc-forge`), which is not installed in the Arc Studio sandbox. Run it yourself: `ARC_FORK_RPC=https://rpc.testnet.arc.io arc-forge test --match-path 'contracts/test/ArcSLA.Fork.t.sol'`. Record the result here. |
| Browser/wallet end-to-end test | Open | No automated browser test exists. Use the manual smoke test. |

## 3. Review and audit
| Item | Status | Detail |
| --- | --- | --- |
| Internal tool-assisted review | Done | `docs/SECURITY_REVIEW.md`. Not an audit certification. |
| **Independent professional audit** | **Not done** | Required before real users or meaningful value. Auditor / report / commit hash: ______ |
| Findings accepted by you | Open | Verifier trust, issuer blocklist on provider or customer, no admin or pause, 65-byte signatures only, unbounded deadlines. Sign off: ______ |
| `contracts/ArcSLA.sol` hash recorded | Open until you confirm | At preparation time (2026-10-30, unchanged since the testnet deployment) `sha256sum contracts/ArcSLA.sol` = `3002abab63b21a7bc525d4953d4b13c83612f3d8c300525737c98e56f11f8730`. Recompute it yourself; it must match what was reviewed and what you deploy. |

## 4. Wallet funding
| Item | Status | Detail |
| --- | --- | --- |
| Deployer wallet created (keystore or hardware, no raw key in shell history) | Open | Address: ______ |
| Deployer funded with mainnet gas USDC | Open | No public mainnet faucet. Arc's docs say to request gas USDC through your Circle point of contact. Expected cost about 0.03 USDC; budget more than the 0.072 USDC conservative estimate. |
| Customer, provider, independent verifier wallets ready | Open | Three distinct wallets. Customer needs the demo amount plus gas. |
| Demo amount decided | Open | An amount you can afford to lose: ______ |

## 5. Contract verification (after any deployment)
| Item | Status | Detail |
| --- | --- | --- |
| Official network facts re-verified by you against `docs.arc.io` | Open | Chain ID 5042, RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io`, USDC `0x3600…0000` |
| Non-broadcast dry run from your machine | Open | Procedure in `docs/MAINNET_DEPLOYMENT.md` section 4. Preparation dry run (standard Foundry, default sender) succeeded on 2026-10-30. |
| `usdc()` equals the official USDC | Open until deployed | `cast call <ARCSLA> "usdc()(address)"` |
| `eip712Domain()` shows ArcSLA, 1, chain 5042, own address | Open until deployed | |
| Source verified on explorer, bytecode matches local build | Open until deployed | |

## 6. Transaction evidence (mainnet)
Not started. Nothing has been deployed or sent on Arc Mainnet.

| Step | Tx hash | Explorer link | Verified |
| --- | --- | --- | --- |
| Deployment | | | |
| Approve | | | |
| Create agreement | | | |
| Verifier release | | | |
| Second agreement + refund after deadline | | | |

Record full detail in `docs/MAINNET_EVIDENCE_CHECKLIST.md`.

## Open blockers
1. No independent professional audit.
2. Fork test against real Arc USDC has not passed (needs Arc Foundry).
3. No mainnet gas funding for a deployer wallet.
4. Your own review gate (`docs/MAINNET_DEPLOYMENT.md` section 6) not yet completed.
5. Acceptance of the documented residual risks not yet recorded.
