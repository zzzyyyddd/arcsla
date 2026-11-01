# ArcSLA network configuration (Arc Testnet and Arc Mainnet)

Arc Testnet and Arc Mainnet are two separate configurations in one app. This page describes how the network is chosen, what follows from that choice, and how to select it for production. Nothing here deploys or signs anything.

## The two registered deployments

Registered in `src/lib/networks.ts`, one entry per network, public data only:

| | Arc Testnet | Arc Mainnet |
| --- | --- | --- |
| Chain ID | 5042002 | 5042 |
| RPC | https://rpc.testnet.arc.io | https://rpc.mainnet.arc.io |
| Explorer | https://explorer.testnet.arc.io | https://explorer.arc.io |
| ArcSLA contract | 0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47 | 0x5F040Bc617666359C543bfFbE25DD00c4FfCbdAC |
| Deployment block | 69654812 | 28741163 |
| USDC (ERC-20, 6 decimals) | 0x3600000000000000000000000000000000000000 | 0x3600000000000000000000000000000000000000 |
| Native gas | USDC, 18 decimals | USDC, 18 decimals |

Chain, RPC, explorer and USDC come from the generated registry (`src/onchain-facts.ts`). The contract address and deployment block come from `src/lib/networks.ts`.

## How the network is selected

The choice is made once, when the page loads, in this order:
1. `?network=testnet` or `?network=mainnet` in the URL. It is remembered in the browser.
2. The visitor's saved choice from the **Testnet / Mainnet** selector in the header. Choosing a network saves it and reloads the page. Switching to mainnet asks for confirmation first.
3. `VITE_DEFAULT_NETWORK` (`testnet` or `mainnet`), set when the site is built.
4. The older `VITE_ARC_CHAIN_ID` (`5042` selects mainnet, `5042002` testnet).
5. Arc Testnet.

Because the page reloads on every switch, everything restarts on the new network: contract reads and writes, signing domain, explorer links, event scans, the write guard and wallet network checks. Nothing is shared between networks.

## What is protected

- The contract address is taken only from the registry entry of the selected network. A `VITE_ARCSLA_ADDRESS` that differs from it (for example the testnet contract on mainnet) is reported as a configuration problem and disables every transaction and signature.
- A wallet on another chain is told to switch; transaction buttons stay disabled, and the transaction hook refuses to open the wallet.
- On every load the app reads the contract onchain and requires: code present, name `ArcSLA` version `1`, a signing domain bound to the selected chain and to that address, and `usdc()` equal to the official USDC. Anything else disables transactions and signing.
- Mainnet mode shows a real-funds warning and requires a tick-box acknowledgement before any transaction; the header selector shows Mainnet in red.
- `VITE_USDC_ADDRESS` is rejected if it differs from the official address.
- Optional proof-of-concept limits apply on mainnet only: `VITE_MAX_AGREEMENT_USDC` (for example `0.01`) and `VITE_MAX_DEADLINE_HOURS` (for example `2`). They are enforced by the app only; the contract has no limits.

## Selecting the network for production

Pick one when you build the site:
- **Opens on testnet, visitors can switch (default):** build with nothing set. The mainnet option is one click away.
- **Opens on mainnet, visitors can still switch to testnet:** build with `VITE_DEFAULT_NETWORK=mainnet`. For a controlled proof of concept also set `VITE_MAX_AGREEMENT_USDC=0.01` and `VITE_MAX_DEADLINE_HOURS=2`.
- **Share a direct link:** `https://<your-site>/?network=mainnet` or `?network=testnet`.

Locally: `bun run dev` follows `.env`; `bun run dev:mainnet` loads `.env.mainnet` (template `.env.mainnet.example`).

## Checks

- `bun run test:network` runs 13 offline tests of the selection and guard rules (no RPC, no wallet).
- `scripts/verify-deploy.sh --tx 0x25c9ec657b34e9c91a7c4a836b9b5352a0b0cfb7472071ca26da0289db1e7e66` re-verifies the mainnet deployment read-only.

## Not verified

The mainnet escrow lifecycle (approve, create, release or refund) has not been run. It is to be tested through the public website with manual wallet confirmation. Mainnet mode has not been exercised in a real browser with a wallet. The earlier testnet check "wrong `VITE_ARCSLA_ADDRESS` shows Contract check failed" (U2 in the testnet evidence) was run on the previous configuration model; with the registry, a wrong override now shows a "Configuration problem" banner instead, and the onchain contract check still guards the registered address.


## Deadline presets and validation (mainnet caps)

With `VITE_MAX_DEADLINE_HOURS` set (mainnet only), the Create form:
- disables the deadline presets that exceed it (with a tooltip and a note), and adds a preset for the maximum itself;
- limits the date picker to the maximum and shows an inline error as soon as a typed or pasted deadline is too far away or too close;
- keeps "Allow USDC" and "Create & fund" disabled while the deadline (or any other field) is invalid;
- re-checks the deadline and amount against the chain clock at the moment you click, so nothing reaches the wallet if it became invalid in between.

Arc Testnet has no maximum, so its presets and 7-day deadlines are unchanged. These limits are interface safety rails; the contract itself only requires a deadline in the future. Tests: `bun run test:create` (22 offline tests).


## Guided Demo step 9: read-only rejection test

The step takes the original signed attestation of a settled (released) agreement from the chain: it decodes the signature from the release transaction's calldata and checks locally that it recovers to the agreement's verifier. It then changes one byte and asks the contract's own verification, through read-only `eth_call` simulations, whether it would accept it.

A released agreement is no longer Active and the contract checks the status before the signature, so on the real state every attempt only answers `AgreementNotActive`. To reach the signature check, the simulation runs against a temporary, hypothetical Active copy of the agreement (an RPC state override) at the time of the original release. That copy exists only inside the call: nothing is sent, no wallet prompt appears, no USDC moves, and the real agreement is unchanged. The page labels what is onchain evidence, what is a read-only simulation, and what is only a note stored in the browser.

If the release transaction or its signature cannot be read, the page shows "Test unavailable: original signature required" and step 9 stays open. Completion is recorded in the browser only after the control (original signature, accepted) and the tampered signature (rejected with `InvalidSigner`) are both observed. The record is stored per network.


## Guided Demo progress follows one journey, not the connected wallet

A journey is the set of agreements that share the same customer and verifier. The connected wallet only chooses which journey is shown (it must be the customer, verifier or provider of it) and never decides whether an onchain step is complete, so switching customer, verifier and provider wallets keeps the same progress.

- **Onchain steps (1, 2, 4, 5, 6, 7, 8):** agreement states, events and transaction receipts. The settlement transaction (6) and the refund (8) also need a successful receipt, and a refund must have happened after the deadline.
- **Verifier wallet (3):** complete once the contract has accepted the verifier's signature, or, before any release, once that wallet has been connected in this browser (labelled as recorded in the browser).
- **Rejection test (9):** always browser-local and counted separately from the onchain steps.
- **No guessing:** with no wallet, or a wallet that took no part, the page shows the recorded public journey and says so. Missing events or receipts keep a step open with the reason shown.
