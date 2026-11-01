# ArcSLA controlled mainnet proof of concept (0.01 USDC): preparation and checklist

> **Update (2026-10-31):** network and contract selection changed. The app now registers each network's contract in `src/lib/networks.ts` and selects the network with `?network=`, the header selector or `VITE_DEFAULT_NETWORK`. See `docs/NETWORK_CONFIGURATION.md`. Where this document mentions `VITE_ARCSLA_ADDRESS`, read it as that registry.


Status: **PREPARED, NOT EXECUTED. Verdict: BLOCKED on items only you can do** (section 9). Nothing has been deployed, signed, approved, transferred or broadcast. `ArcSLA.sol` and the Arc Testnet deployment are unchanged.

> Warning: Transactions on mainnet involve real funds and, once submitted, are irreversible. Arc Studio may generate or edit code or configuration that references mainnet, but Arc Studio does not deploy to, transact on, sign for, fund, or otherwise interact with mainnet on your behalf. Any code used for mainnet must be independently reviewed, tested, validated, deployed, and operated by you outside of Arc Studio. You are solely responsible for any losses, errors, or other consequences resulting from your use of any code, configuration, or output generated or edited through Arc Studio in connection with mainnet. Before proceeding, you should first use testnet, obtain an independent professional audit, and carefully review all wallet addresses, contract addresses, chain settings, permissions, and other configuration details. Only continue to mainnet after you have completed your independent review and have determined that you want to proceed.

This is an internal, tool-assisted preparation. It is not an independent audit and guarantees nothing about security. See `docs/MAINNET_READINESS_AUDIT.md` for the risk review. Any "approval" you give in the chat cannot make Arc Studio deploy to mainnet: its deploy tooling is testnet-only. You deploy yourself, outside Arc Studio, from your own wallet.

## 1. Verified mainnet parameters (read-only RPC calls on 2026-10-30)

| Item | Expected | Observed |
| --- | --- | --- |
| Chain ID | 5042 | `eth_chainId` = `0x13b2` = 5042 |
| RPC | `https://rpc.mainnet.arc.io` | Answers; block 28,618,014; base fee 20 gwei; gas price 25 gwei |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` | Has contract code (a proxy); `symbol()` = USDC |
| ERC-20 decimals | 6 | `decimals()` = 6 |
| Native gas decimals | 18 | Two sampled accounts: native balance (wei) = ERC-20 balance x 10^12 (e.g. 400000 units = 0.4 USDC = 4 x 10^17 wei). Native and ERC-20 are one pool, so never add them |
| Explorer | `https://explorer.arc.io` | From the app registry and Arc docs (not fetched in this run) |
| Registry agreement | n/a | `src/onchain-facts.ts` has the same chain ID, RPC, USDC address, 6 and 18 decimals |

## 2. Contract addresses are network-specific

- The Arc Testnet ArcSLA `0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47` appears only in: `.env` (testnet), testnet-only evidence scripts and docs, the golden-vector test, and one deny-list constant in `src/lib/env.ts`.
- The running app reads the contract address only from `VITE_ARCSLA_ADDRESS`. **New:** on a mainnet configuration the app now treats the testnet address as a configuration error and blocks every transaction and signing action. Checked in a Bun run of the shipped `env.ts` (scenario A below).
- The mainnet profile lives in a separate git-ignored `.env.mainnet` (template: `.env.mainnet.example`, with the address left empty), loaded only by `bun run dev:mainnet`. The existing `.env` and `bun run dev` stay on Arc Testnet.
- The `/create?preset=` testnet wallets are now ignored when the app is on mainnet.

## 3. Frontend verification

Checked by running the shipped modules under different environments (Bun, no network) plus the live checks already on record. Scenarios:

| Scenario | Result |
| --- | --- |
| Default (no mainnet env) | Arc Testnet 5042002, domain chain 5042002, no issues |
| Mainnet + the testnet ArcSLA address | Blocked: "VITE_ARCSLA_ADDRESS is the Arc Testnet deployment..." |
| Mainnet + empty address | Blocked: address not set |
| Mainnet + a mainnet address + caps | No issues; chain 5042, RPC and explorer from the registry, USDC `0x3600...`, native decimals 18, caps 10000 units (0.01 USDC) and 7200 s, EIP-712 domain `ArcSLA` / `1` / 5042 / that address |
| Mainnet + `VITE_USDC_ADDRESS` override | Blocked: "differs from the official USDC address" |
| Invalid cap values | Blocked with a specific message each |
| Wallet on another network while the app is on mainnet | Blocked: "Switch your wallet to Arc." |
| Mainnet, warning not acknowledged | Blocked until the checkbox is ticked |

Also relevant, from the code and earlier tests:
- **Network switching:** every transaction button goes through one shared guard, which offers a switch button and refuses to open a wallet prompt on the wrong chain. Contract check (code at the address, name `ArcSLA`, version `1`, chain, address, USDC) runs before any write or signature.
- **EIP-712 domain:** built from the configured chain ID and address, and verified against the contract's own `eip712Domain()` by the guard; a viem-signed golden vector is accepted by the contract (test `ArcSLA.Golden`).
- **Verifier selection:** entered manually; there is no default verifier on mainnet. The form refuses verifier equal to provider, customer, the ArcSLA or USDC contract. The verifier must be an ordinary wallet (no smart-contract wallet support).
- **Deadline:** must be in the future; warning above 30 days. **New (mainnet profile):** hard UI cap from `VITE_MAX_DEADLINE_HOURS` (set to 2).
- **Transaction safety:** exact-amount approvals only (no unlimited approval), amount parsed with the shared USDC helper, amount capped by `VITE_MAX_AGREEMENT_USDC` (set to 0.01). These two caps are enforced by the app only; the contract has no limits, so anyone using other tooling can create larger agreements.
- Not verified: a rendered browser run in mainnet mode, and a real wallet connection on mainnet.

## 4. Minimum escrow check

`ArcSLA.sol` rejects only a zero amount (`ZeroAmount`); there is no minimum. 0.01 USDC is 10,000 units at 6 decimals. New tests `ArcSLAPocAmountTest` (3, all pass) create, release and refund an agreement of exactly 10,000 units with the real accounting checks, and confirm that 1 unit is accepted and 0 is rejected.

## 5. Gas estimates (Arc Mainnet gas price right now: 25 gwei; floor 20 gwei)

Native gas has 18 decimals, so cost in USDC = gas x gas price (wei) / 10^18.

| Step | Gas | Source | At 25 gwei | At 20 gwei | At 50 gwei (2x) |
| --- | --- | --- | --- | --- | --- |
| Deploy ArcSLA | 1,375,814 | `eth_estimateGas` on mainnet with the actual compiled creation bytecode + constructor argument (7,029 bytes) | 0.0344 USDC | 0.0275 | 0.0688 |
| Deploy ArcSLA, upper bound | 1,772,969 | Foundry's dry-run estimate with its safety buffer (it assumed 42 gwei and labels the unit "ETH"; the unit is USDC) | 0.0443 | 0.0355 | 0.0886 |
| Deploy, testnet actual | 1,492,793 | Confirmed testnet deployment | 0.0373 | 0.0299 | 0.0746 |
| Approve 0.01 USDC | 56,012 | `eth_estimateGas` on mainnet, placeholder spender (first-time allowance write) | 0.0014 | 0.0011 | 0.0028 |
| Create and fund | UNAVAILABLE on mainnet | Needs the deployed mainnet contract. Proxy: 247,616 gas measured on Arc Testnet | 0.0062 | 0.0050 | 0.0124 |
| Release | UNAVAILABLE on mainnet | Proxy: 108,634 gas measured on Arc Testnet | 0.0027 | 0.0022 | 0.0054 |
| Refund | UNAVAILABLE on mainnet | Proxy: 68,350 gas measured on Arc Testnet | 0.0017 | 0.0014 | 0.0034 |

The testnet figures are a proxy only; mainnet may differ. The deploy gas limit to set in your tool: 1,800,000 (the cost is gas used, not the limit).

## 6. Recommended minimum balances (with safety margin)

Real USDC on Arc Mainnet in each wallet (one pool; do not add native and ERC-20 views). Margins cover a 2x gas price (50 gwei) and about 50% extra on usage.

| Wallet | Needs | Recommended minimum | Why |
| --- | --- | --- | --- |
| Deployer (fresh, used only for the deployment) | Deploy gas only | **0.10 USDC** | Worst-case deploy 1.8M gas at 50 gwei = 0.09 USDC |
| Customer | 0.01 escrow + approve + create + release (or refund) gas | **0.05 USDC** | Gas 56k + 248k + 109k = about 413k, which is 0.010 USDC at 25 gwei and 0.021 at 50 gwei; plus 0.01 escrow; margin |
| Provider | Nothing: it only receives | **0 USDC** | Must not be blocklisted by the issuer. Use a wallet you control to recover the 0.01 |
| Verifier | Nothing to sign; gas only if it submits the release | **0 USDC** (or **0.01 USDC** if the verifier itself submits the release) | EIP-712 signing is offchain and free. Let the customer wallet submit the release so the verifier key never holds funds |

Total at risk: about 0.15 to 0.16 USDC, of which 0.01 is the escrow and the rest is gas. If you deploy from the customer wallet instead, it needs at least 0.15 USDC, but a separate deployer is cleaner.

## 7. Controlled mainnet configuration (no keys in files)

1. Copy `.env.mainnet.example` to `.env.mainnet` (git-ignored). It sets chain 5042, `VITE_MAX_AGREEMENT_USDC=0.01`, `VITE_MAX_DEADLINE_HOURS=2`, and leaves `VITE_ARCSLA_ADDRESS` and `VITE_ARCSLA_DEPLOY_BLOCK` empty until you have deployed.
2. After your deployment, fill in the new mainnet address and the deployment block, then run `bun run dev:mainnet` (this replaces the testnet dev server on port 5173; stop it and run `bun run dev` to return to testnet).
3. Never put a private key, seed phrase or API secret in any `.env*` file. Use a Foundry keystore or a hardware wallet for the deployer.

## 8. Deployment checklist and abort conditions

You perform all of these outside Arc Studio. Stop at the first failed item.

**A. Before deploying (all abortable at no cost):**
1. Re-read the warning above and `docs/MAINNET_READINESS_AUDIT.md`; accept in writing that there is no independent audit and the residual risks (issuer blocklist freeze, trusted single verifier, no rollback).
2. On your own machine: `forge clean && forge build && forge test`. `sha256sum contracts/ArcSLA.sol` must equal `3002abab63b21a7bc525d4953d4b13c83612f3d8c300525737c98e56f11f8730`; the `deployedBytecode` of the artifact must hash to `a90ee98b897385670eb8eb555b242e88c95ade3b8d8e9a6e7ed76306c8a5d169` (compiler 0.8.28, evm cancun, optimizer 200 runs).
3. Re-check chain ID 5042, RPC, explorer and USDC address against `docs.arc.io` yourself.
4. Run the non-broadcast dry run from `docs/MAINNET_DEPLOYMENT.md` section 4 with your deployer address. Expect "Arc Mainnet", chain 5042, SIMULATION COMPLETE.
5. Fund the wallets in section 6. Confirm balances on the explorer.
6. Optional but recommended: run the fork test with Arc's own Foundry (`arc-forge`); plain Foundry cannot run Arc USDC's blocklist precompile.
7. **ABORT if:** any parameter differs, a hash differs, the dry run fails, the gas price is above 50 gwei (wait), a wallet is underfunded, you do not control the verifier key, or any item is unclear.

**B. Deploy (irreversible once broadcast):**
8. Broadcast with your keystore or hardware wallet, gas limit 1,800,000, `maxFeePerGas` at or above the 20 gwei floor.
9. Immediately verify with read calls: the code exists; `usdc()` = `0x3600...0000`; `eip712Domain()` returns name `ArcSLA`, version `1`, chain ID 5042 and verifying contract = the new address; `agreementCount()` = 0.
10. **If any of step 9 differs:** do not use the contract. It cannot be fixed or removed (see "No rollback"). The sunk cost is the deployment gas, about 0.04 USDC.

**C. Configure and smoke test (exactly one agreement of 0.01 USDC):**
11. Fill `.env.mainnet`, run `bun run dev:mainnet`, connect the customer wallet, tick the real-funds acknowledgement.
12. Allow 0.01 USDC, create one agreement: 0.01 USDC, a provider and verifier wallet you control, deadline 30 to 60 minutes.
13. Read-only checks: simulate an early refund (expect `RefundNotAvailable`); sign with a non-verifier wallet and check (expect `InvalidSigner`).
14. Sign with the verifier wallet, check it is accepted, submit the release from the customer wallet before the deadline.
15. Simulate a duplicate release (expect `AgreementNotActive`). Record every transaction hash and explorer link using `docs/MAINNET_EVIDENCE_CHECKLIST.md`.
16. **ABORT the smoke test and wait for the deadline (then refund as the customer) if:** the signature check fails, the release reverts, the gas price spikes above 50 gwei, or the deadline is close.

**D. Do not do:** create a second agreement, raise the caps, or share the app publicly before reviewing the evidence.

### No rollback
ArcSLA is immutable: no owner, admin, pause, upgrade or sweep. A deployed contract **cannot be rolled back, paused, patched, or removed**. The only ways funds leave escrow are the two rules built into the contract: release to the provider with the verifier's valid signature at or before the deadline, or refund to the customer strictly after the deadline. "Abort" after deployment therefore means: stop using that address and, if an agreement exists, wait for the deadline and refund (or release if the signature is available). If the issuer blocks a party or the ArcSLA address itself, the funds can stay stuck until the issuer acts; the 0.01 USDC amount exists to cap that loss. A fix would require a new deployment at a new address.

## 9. Verdict: BLOCKED (preparation is complete)

Code and configuration side: ready. The remaining blockers are yours:
1. **Real USDC on Arc Mainnet in the deployer and customer wallets** (about 0.15 USDC in total); no faucet exists for mainnet.
2. **You must perform the mainnet deployment yourself**, outside Arc Studio.
3. **No independent audit** exists; you must knowingly accept that.
4. **Arc-native fork test not run** (needs Arc's Foundry); accept or run it.
5. **Mainnet frontend path unexercised** in a real browser and wallet; the smoke test is where that happens.
6. **Your explicit go-ahead** and your confirmation that the verifier, provider and customer wallets are yours and not blocklisted.

This is a controlled proof of concept only. It is not a public launch, and nothing here makes ArcSLA ready for other people's funds.
