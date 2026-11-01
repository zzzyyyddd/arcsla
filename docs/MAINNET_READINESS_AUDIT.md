# ArcSLA mainnet readiness review

> **Note (2026-10-31):** written before the network selector. The frontend configuration findings (I-1 and the mainnet checklist lines about `VITE_ARC_CHAIN_ID`) are superseded by `docs/NETWORK_CONFIGURATION.md`: the chain is now chosen from two registered networks, not from any chain in the registry.


Date: 2026-10-30 · Scope: `contracts/ArcSLA.sol`, `contracts/script/DeployArcSLA.s.sol`, the frontend (`src/`), the existing Foundry suite and the Arc Testnet evidence.

> **This is not an independent audit and not a guarantee of security.** It is an internal, tool-assisted review: two automated reviewers at the deepest tier, Slither, the existing Foundry suite, and a manual read of the frontend and deployment script. No human third-party auditor has reviewed ArcSLA. Nothing was deployed, signed, approved or transferred for this review, `ArcSLA.sol` was not modified, and all existing testnet evidence is untouched.

## 1. Decision

| Question | Decision |
| --- | --- |
| Public production launch on Arc Mainnet | **NO-GO** |
| Controlled mainnet proof of concept with a minimal amount of real USDC | **CONDITIONAL GO to consider**, only if every condition in section 8 is met and the owner accepts the residual risks in section 9. Nothing here authorises a deployment; explicit approval is required first. |

Why the two differ: a proof of concept limits the loss to an amount you choose, uses wallets and a verifier you control, and exists to produce mainnet evidence. A public launch exposes strangers' funds to risks that this review cannot rule out: no independent audit, a single trusted verifier key per agreement, issuer-level freezes that no contract code can undo, and no admin or pause to react to a defect after deployment.

## 2. Mainnet parameter validation

Checked read-only against the live endpoints on 2026-10-30. Nothing was sent.

| Parameter | Expected | Observed | Result |
| --- | --- | --- | --- |
| Chain ID | 5042 | `eth_chainId` = `0x13b2` (5042) | Match |
| RPC | `https://rpc.mainnet.arc.io` | Answers; latest block `0x1b4a8fa` (28,616,954) | Match |
| Explorer | `https://explorer.arc.io` | Per the app registry and Arc docs (not fetched in this run) | Documented only |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` | Has code (1,798 bytes, a proxy) | Match |
| ERC-20 decimals | 6 | `decimals()` = 6, `symbol()` = "USDC" | Match |
| Native USDC gas decimals | 18 | Two sampled accounts show native balance = ERC-20 balance × 10^12 (`0x5B12…1Ef42`: 400000000000000000 wei vs 400000; `0x…0001`: 2000000000000000002 wei vs 2000000) | Match |
| Gas price | at least 20 gwei floor per Arc docs | `eth_gasPrice` = `0x5d21dba00` = 25 gwei | Consistent |
| App registry (`src/onchain-facts.ts`) | same values | chain 5042, native 18, USDC 6, same address and RPC | Match |

Gas accounting check: the testnet create transaction used 247,616 gas at 25 gwei and its receipt fee is 0.0061904 USDC, which equals 247,616 × 25 gwei at 18 decimals. At the same price a deployment of about 1.49M gas costs roughly 0.037 USDC, an approval about 0.0014 USDC, a create about 0.0062 USDC, a release about 0.0027 to 0.0033 USDC and a refund about 0.0017 USDC. These are estimates from testnet gas, not measured on mainnet.

ArcSLA never reads or credits native balance, never uses `msg.value`, and has no receive function. All amounts are 6-decimal ERC-20 units, so the 6 vs 18 decimal difference cannot enter its accounting. The frontend uses `parseUsdc` and `formatUsdc` for every amount, never displays the native balance, and has no hand-written decimal conversion.

## 3. Findings

No CRITICAL or HIGH findings were confirmed. "Confirmed" means reproducible with a test; every item below is a documented trade-off, an external dependency or a hardening suggestion rather than an exploitable defect.

| ID | Severity | Title | Status |
| --- | --- | --- | --- |
| M-1 | MEDIUM | Issuer blocklist can freeze funds, including every escrow at once | Accepted external risk, mitigate operationally |
| M-2 | MEDIUM | Trusted single-key verifier: compromise or collusion releases funds irreversibly | Accepted design risk, mitigate operationally |
| M-3 | MEDIUM | Mainnet behaviour of Arc USDC not exercised in a pre-deployment fork test | Open, must close or consciously accept |
| L-1 | LOW | Customer-selected deadline is uncapped (self-lock) | Accepted, UI warns above 30 days |
| L-2 | LOW | 64-byte ERC-2098 compact signatures are rejected | Accepted, interoperability only |
| L-3 | LOW | Donated or forced USDC is unrecoverable | Accepted, no-admin design |
| L-4 | LOW | Custom errors carry no context parameters | Accepted, diagnostics only |
| L-5 | LOW | Brief read-only reentrancy window in `createAgreement` | Accepted, affects only third-party integrators |
| L-6 | LOW | Timely attestation can miss the deadline through inclusion delay or censorship | Accepted, inherent to an inclusion-time cutoff |
| L-7 | LOW (frontend) | Wallet and ENS lookups use the library's default public Ethereum RPC | Open, privacy only |
| L-8 | LOW (frontend) | Event history scan relies on a public RPC with a range cap and rate limiting | Open, availability only |
| I-1 | INFO | `VITE_ARC_CHAIN_ID` accepts any chain in the registry | Mitigated by the contract check |
| I-2 | INFO | No explorer source verification for any ArcSLA deployment yet | Checklist item |

### M-1 Issuer blocklist can freeze funds (MEDIUM, accepted external risk)
All agreements share one custody address, and USDC on Arc enforces an issuer blocklist.
- If ArcSLA's own address is blocklisted, release and refund both revert for every active agreement, whatever the signatures and deadlines. Accounting stays intact because every revert is atomic, but the funds are inaccessible until the issuer acts.
- A blocklisted provider cannot receive a release (the customer can still refund after the deadline). A customer blocklisted after funding cannot receive a refund until unblocked.
- Reproduce with the existing tests: `forge test --match-test test_Token_ContractItselfBlocklisted_BothSettlementsRevertAtomically -vv`, `--match-test test_Token_ProviderBlocklisted_ReleaseRevertsAtomically_RefundStillWorksAfterDeadline`, `--match-test test_Token_CustomerBlocklisted_RefundRevertsAtomically_SucceedsAfterUnblock`.
- Remediation requirement: no contract change can bypass an issuer restriction. Treat issuer cooperation as an operational prerequisite, cap the value placed in escrow, and for a proof of concept use only funds you can afford to have frozen.

### M-2 Trusted single-key verifier (MEDIUM, accepted design risk)
The verifier is an ordinary signing key. A compromised or colluding verifier can sign a valid attestation, and the release to the stored provider is irreversible. An EIP-712 signature proves only that the verifier signed, not that any service was delivered. A verifier that never signs causes a refund only after the deadline; there is no early cancellation or dispute step. Smart-contract wallets cannot be verifiers (ECDSA only).
- Remediation requirement: use a dedicated verifier key that holds no other value, never reuse a key that touches other funds, and choose short deadlines. Decide, before any public use, whether a threshold or dispute mechanism is required; that is a rule change and would need a new contract version.

### M-3 No pre-deployment test against Arc's real USDC behaviour (MEDIUM, open)
Arc's USDC calls a blocklist precompile that plain Foundry cannot execute (`StackUnderflow` at `0x1800…0001` in the fork attempt), so the fork test cannot pass without Arc's own Foundry fork. The mitigating evidence is real testnet transactions on the same USDC design: create, release and refund all succeeded (agreements #1 to #4). What is not covered: any mainnet-specific difference, and the blocklist revert paths against real USDC.
- Remediation requirement: run `ArcSLA.Fork.t.sol` with Arc's Foundry against Arc Mainnet or Testnet and record the result, or consciously accept the gap and mitigate it with the smoke test in section 8.

### L-1 Uncapped deadline
A customer can choose a deadline up to `type(uint64).max`, locking their own funds with no early cancellation. Only the funding customer chooses it. The UI warns above 30 days but does not forbid it. Remediation: acceptable for a proof of concept; for production consider a UI hard cap, or a maximum in a future contract version.

### L-2 Compact signatures rejected
`release` accepts canonical 65-byte signatures only. A 64-byte ERC-2098 signature reverts with `InvalidSigner` and can be expanded to 65 bytes off-chain. Wallets and the app produce 65-byte signatures (golden test proves the browser path). Reproduce: `forge test --match-test Compact -vv`.

### L-3 Unrecoverable donations
Tokens sent directly to the contract are never credited and cannot be withdrawn. `totalEscrowed` counts only active agreements and the invariant balance ≥ escrow holds. Reproduce: `forge test --match-test test_Accounting_Donation -vv`.

### L-4 Error context
`AmountMismatch`, `InvalidSigner`, `AgreementNotActive` and others take no parameters, which makes production diagnosis harder. Changing them changes the ABI and requires a new deployment; not required for safety.

### L-5 Read-only reentrancy window in `createAgreement`
It stores the agreement and `totalEscrowed` before pulling the tokens, so a contract called from a token callback during the pull could briefly read an Active agreement whose funds have not yet arrived. ArcSLA's own functions are guarded, and USDC has no transfer callbacks. Reproduce: `forge test --match-test test_Hooks_CreatePullCallback_ReadOnlyViewShowsTransientPrePullState -vv`.

### L-6 Deadline-boundary inclusion risk
Release is valid at `timestamp <= deadline` and refund only at `timestamp > deadline`, so the windows never overlap. A signed attestation that is not included before the deadline cannot settle, and signing early does not reserve a payout. Remediation: sign and submit with comfortable margin; the 60-minute deadline used for T1 shows the intended practice.

### L-7 Default public Ethereum RPC in the wallet config
`src/config.ts` registers `http()` with the library default endpoint for Ethereum mainnet (needed for ENS names). If ENS lookups run, the connected address can reach that public endpoint. Privacy impact only. Remediation: set an RPC you trust for that chain, or remove ENS resolution if unused.

### L-8 Event scan availability
The history view scans events from the deploy block through the public Arc RPC. On the testnet RPC, `eth_getLogs` rejected a 20,000-block range, accepted 10,000, and returned a rate-limit error (-32005) under bursts. The scanner starts at 10,000 blocks, halves on error and the contract reads still work, but a long history on mainnet could be slow. Remediation: keep `VITE_ARCSLA_DEPLOY_BLOCK` accurate and consider a dedicated RPC for a public site.

### I-1 and I-2
`VITE_ARC_CHAIN_ID` accepts any chain in the registry. The write guard still requires the configured address to be an ArcSLA v1 contract on that chain (name, version, chain ID, own address and the expected USDC), otherwise every transaction and signing control is blocked. No explorer verification exists for mainnet because nothing is deployed there.

## 4. Attack-surface review

| Area | Result | Basis |
| --- | --- | --- |
| Reentrancy and double settlement | No issue | `nonReentrant` on all three state-changing functions, status updated before transfer, malicious provider and customer hook tests, terminal states, 7 invariants |
| Unauthorized release | No issue | Only a signature by the stored verifier over the agreement's id, spec hash, provider, evidence hash and expiry settles; any submitter pays the stored provider only |
| Unauthorized refund | No issue | Customer only, strictly after the deadline; checked after the status check |
| Replay across chains, contracts, agreements | No issue | EIP-712 domain binds name, version, chain ID and contract; the digest includes the agreement id; tests for second deployment, chain-ID change, other agreement, golden vector from the browser signing path |
| Malleability and expiry | No issue | OZ `tryRecover` rejects high-s and bad `v`; all 65 byte flips rejected; expiry boundary tests |
| Deadline and timestamp edge cases | No issue | Boundary tests at deadline, deadline+1, expiry and `createdAt+1`; fuzz proves release and refund are never both possible |
| USDC transfer and approval safety | No issue | SafeERC20, balance-delta check (`AmountMismatch`), fee-on-transfer, inflating, no-return and false-returning token tests; the app approves the exact amount only, never an unlimited allowance |
| Fund locking and refund availability | Accepted risk (M-1, L-1) | Atomic reverts keep state consistent; refund always available after the deadline unless the issuer blocks a party |
| Malicious provider, customer, verifier | Design risk (M-2) | Provider and customer cannot re-enter or redirect funds; the verifier is trusted by design |
| Wrong network and wrong contract | Protected | Guard checks RPC chain ID, code at address, `eip712Domain`, `usdc()`; blocks transactions and signing; tested in logic and observed in the browser (U2b partial) |
| Frontend transaction safety | No issue found | All writes go through the guarded button and hook; chain ID passed on every write; mainnet banner and acknowledgement; no secrets, no private-key handling, no unlimited approvals, no raw HTML rendering |
| Decimal conversion and gas accounting | No issue | Section 2 |

## 5. Test results

| Check | Result |
| --- | --- |
| `forge test` (full suite, 16 suites, no network) | **202 passed, 0 failed, 1 skipped (203)**. Includes 7 + 3 invariant tests (256 runs; 32,768 and 128,000 calls each, 0 reverts) |
| The 1 skipped test | The optional Arc fork test; it did not pass when run against real USDC (section 3, M-3) |
| `forge build` | Compiler run successful |
| Slither | 5 results, none High. 1 Medium `unused-return` (the result of `ECDSA.tryRecover` is intentionally checked through its error output) and 4 Low `timestamp` (the deadline comparisons are the intended behaviour). All judged false positives |
| Source reviewers (two, deepest tier) | One Medium (issuer freeze of the shared custody address, M-1) and one Low (error context, L-4); the functional reviewer found no material issue |
| `bun run check` (lint + typecheck) | 0 errors, 0 warnings |
| `vite build` | Built successfully |
| Arc Testnet adversarial evidence | Preserved unchanged in `docs/TESTNET_ADVERSARIAL_EVIDENCE.md` (59 PASS, 0 FAIL, 1 BLOCKED, 2 NOT RUN at last update) |

Compiler artifact for the deployment hash check: `contracts/ArcSLA.sol` sha256 `3002abab63b21a7bc525d4953d4b13c83612f3d8c300525737c98e56f11f8730`; creation bytecode 6,997 bytes (sha256 `65d7b89c…d05`), runtime bytecode 5,898 bytes (sha256 `a90ee98b…169`); solc 0.8.28, EVM `cancun`, optimizer 200 runs.

## 6. Limitations of this review

- Not an independent audit; no human third-party auditor, no formal verification.
- The test environment is not Arc's EVM: real USDC's precompile paths were not executed in any Foundry test. The real-token evidence is the Arc Testnet transactions only.
- Nothing is deployed on Arc Mainnet. No mainnet ArcSLA behaviour has been observed, and the mainnet USDC was checked with read-only calls only.
- The frontend's mainnet path has not been exercised in a browser against a deployed mainnet contract. The wrong-contract protection was observed on testnet in a partial manual check (refund controls and clicks on disabled buttons were not checked).
- Gas figures for mainnet are estimates from testnet usage and the current gas price.
- The two automated source reviews and Slither are tool-assisted and can miss issues.

## 7. Remediation requirements

Required before any mainnet transaction:
1. Owner records an explicit decision on the accepted risks in section 9.
2. Re-verify chain ID, RPC, explorer and the USDC address against `docs.arc.io` immediately before deploying (section 2 is a point-in-time check).
3. Deploy only from the owner's own wallet, outside Arc Studio, with a non-broadcast dry run first (`docs/MAINNET_DEPLOYMENT.md`).
4. Confirm the compiled bytecode matches the hashes in section 5 on the owner's machine.

Required before any public production launch (in addition):
5. Independent professional audit of the contract, deploy script and frontend integration.
6. Close or formally accept M-3 by running the fork test with Arc's Foundry.
7. A written procedure for an issuer freeze of the ArcSLA address and for a compromised verifier key.
8. A decision on a deadline cap and on a threshold or dispute mechanism for verifiers (this changes contract rules and needs a new version and a new review).
9. A dedicated RPC for the public site and for the ENS lookup (L-7, L-8).

## 8. Mainnet checklist (proof of concept)

Nothing below has been done. Each item needs the owner's confirmation.

- [ ] Explicit written approval to deploy, from the owner, after reading this report.
- [ ] Amount at risk fixed in advance, small enough to lose entirely (for example well under 1 USDC per agreement), and total exposure written down.
- [ ] Deployer wallet, a separate customer wallet, provider wallet and a **fresh verifier key that holds nothing else**. No private keys or seed phrases shared with Arc Studio.
- [ ] Gas USDC in the deployer, customer and verifier-or-submitter wallets (no public faucet on mainnet; Arc's docs point to a Circle contact).
- [ ] Sources, hashes and tests: `sha256sum contracts/ArcSLA.sol` matches section 5; `forge clean && forge build && forge test` passes locally.
- [ ] Non-broadcast dry run of `contracts/script/DeployArcSLA.s.sol` against `https://rpc.mainnet.arc.io` succeeds and prints chain 5042.
- [ ] Deploy with the owner's wallet; record the transaction hash and block.
- [ ] Verify onchain: `usdc()` equals `0x3600…0000`, `eip712Domain()` returns name `ArcSLA`, version `1`, chain 5042 and the deployed address, `agreementCount()` is 0.
- [ ] Set `VITE_ARC_CHAIN_ID=5042`, `VITE_ARCSLA_ADDRESS` and `VITE_ARCSLA_DEPLOY_BLOCK` in a separate environment; confirm the red mainnet banner and a passing contract check.
- [ ] Smoke test with short deadlines: create and fund the minimum amount; wrong-signer and tampered-signature simulations (no transaction); valid attestation and release; duplicate release simulation; a second agreement refunded after its deadline; duplicate refund simulation.
- [ ] Record every transaction hash, block, gas used and the explorer link; record simulations separately from real transactions, as in the testnet evidence file.
- [ ] Do not announce or share the app publicly, and do not accept third-party funds.

## 9. Residual risks the owner must accept for a proof of concept

Issuer freeze or blocklist of any party or of the contract (M-1); a compromised or dishonest verifier (M-2); no independent audit; mainnet-specific USDC behaviour untested before deployment (M-3); no admin, pause or upgrade path, so a defect found later cannot be patched in place; uncapped self-selected deadlines (L-1).

## 10. Status

This review is complete. **No deployment, signature, approval or transfer has been made or prepared beyond the existing scripts, and none will be without your explicit approval.**
