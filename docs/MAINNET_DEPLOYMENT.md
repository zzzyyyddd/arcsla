# ArcSLA mainnet deployment guide (preparation only)

> **Update (2026-10-31):** the frontend no longer reads `VITE_ARCSLA_ADDRESS` / `VITE_ARCSLA_DEPLOY_BLOCK`; see `docs/NETWORK_CONFIGURATION.md`.


> Warning: Transactions on mainnet involve real funds and, once submitted, are irreversible. Arc Studio may generate or edit code or configuration that references mainnet, but Arc Studio does not deploy to, transact on, sign for, fund, or otherwise interact with mainnet on your behalf. Any code used for mainnet must be independently reviewed, tested, validated, deployed, and operated by you outside of Arc Studio. You are solely responsible for any losses, errors, or other consequences resulting from your use of any code, configuration, or output generated or edited through Arc Studio in connection with mainnet. Before proceeding, you should first use testnet, obtain an independent professional audit, and carefully review all wallet addresses, contract addresses, chain settings, permissions, and other configuration details. Only continue to mainnet after you have completed your independent review and have determined that you want to proceed.

Nothing in this repository has been deployed to Arc Mainnet. ArcSLA has **not** had an independent professional audit. Passing tests is not a statement of mainnet readiness. Track readiness in `docs/DEPLOYMENT_READINESS.md`.

## 1. Network facts to re-verify yourself

Taken from Arc's official documentation (`docs.arc.io`, pages "RPC endpoints", "Connect to Arc", "Contract addresses", "Gas and fees") and read-only RPC calls on 2026-10-30. Open the pages again and confirm each value before you sign anything.

| Item | Value |
| --- | --- |
| Network | Arc Mainnet |
| Chain ID | `5042` (`0x13b2`) |
| Primary RPC | `https://rpc.mainnet.arc.io` (other providers are listed in the docs) |
| Explorer | `https://explorer.arc.io` |
| Native gas token | USDC (18 decimals natively) |
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000`, 6 decimals |
| Minimum `maxFeePerGas` | 20 gwei (protocol floor; ceiling 20,000 gwei) |
| Gas funding | There is no public mainnet faucet. Arc's documentation says to request gas USDC through your Circle point of contact. |

Read-only checks you can repeat (these send no transaction):

```bash
cast chain-id --rpc-url https://rpc.mainnet.arc.io                       # expect 5042
cast call 0x3600000000000000000000000000000000000000 "decimals()(uint8)" --rpc-url https://rpc.mainnet.arc.io   # expect 6
cast call 0x3600000000000000000000000000000000000000 "symbol()(string)"  --rpc-url https://rpc.mainnet.arc.io   # expect "USDC"
cast code 0x3600000000000000000000000000000000000000 --rpc-url https://rpc.mainnet.arc.io | head -c 80          # expect non-empty
```

Arc documents an Arc-specific Foundry fork (`arc-forge`, `arc-cast`, `arc-anvil`; install guide: `https://docs.arc.io/arc/tutorials/install-arc-foundry.md`) and notes that standard local EVMs cannot reproduce some Arc runtime behavior. The dry run below was produced with standard Foundry. Use `arc-forge` for your own run if you want Arc's documented tooling, and compare the results.

## 2. What the deploy script enforces

`contracts/script/DeployArcSLA.s.sol` refuses to continue unless all of these hold:

1. `block.chainid` is Arc Mainnet (5042) or Arc Testnet (5042002).
2. `USDC_ADDRESS` equals `0x3600000000000000000000000000000000000000`, has code, returns `decimals() == 6` and `symbol() == "USDC"` on the target chain.
3. On Arc Mainnet only, `ARCSLA_MAINNET_CONFIRM=DEPLOY-TO-ARC-MAINNET-5042`. This is required for the dry run too, so the dry run follows the exact production path.
4. After deployment, the new contract reports the expected `usdc()` and an EIP-712 domain whose chain ID and verifying contract match.

It reads no private key. These guards are covered by `contracts/test/DeployArcSLA.t.sol`.

## 3. Prepare your machine

1. Use your own machine and your own wallet, not Arc Studio's platform wallet.
2. Check out the exact commit you reviewed and confirm `contracts/ArcSLA.sol` is unchanged from the version you reviewed. Record its hash:
   ```bash
   sha256sum contracts/ArcSLA.sol
   ```
3. Build and test from clean:
   ```bash
   forge clean && forge build && forge test
   ```
4. Create a Foundry keystore so no raw key ever appears in a command or shell history:
   ```bash
   cast wallet import arcsla-mainnet-deployer --interactive
   ```
   Prefer a hardware wallet if you have one (`--ledger` or `--trezor`).
5. Fund the deployer with gas USDC (see the table above). It needs only a small amount; see the cost estimate.

## 4. Non-broadcast dry run (no transaction is sent)

```bash
export USDC_ADDRESS=0x3600000000000000000000000000000000000000
export ARCSLA_MAINNET_CONFIRM=DEPLOY-TO-ARC-MAINNET-5042

forge script contracts/script/DeployArcSLA.s.sol:DeployArcSLA \
  --rpc-url https://rpc.mainnet.arc.io \
  --account arcsla-mainnet-deployer --sender <your-deployer-address>
```

There is no `--broadcast`, so Foundry simulates against live mainnet state and nothing is signed or sent. Expected output:

- `Network: Arc Mainnet`, `Chain ID: 5042`, `USDC token: 0x3600…0000`
- `SIMULATION COMPLETE`
- A line starting `ArcSLA (simulated address unless broadcast)`. That address is only a simulation result and **not** your final address.

Result of the preparation dry run (standard Foundry, default sender, no key, 2026-10-30): script ran successfully on chain 5042 at block 28569521. Without the confirmation phrase it reverts with `Mainnet requires ARCSLA_MAINNET_CONFIRM=DEPLOY-TO-ARC-MAINNET-5042`. With a wrong USDC address it reverts with `USDC_ADDRESS is not the official Arc USDC address`.

## 5. Estimated cost

| Figure | Value | Basis |
| --- | --- | --- |
| Foundry dry-run estimate | 1,772,969 gas at 40.76 gwei, about 0.072 USDC | Foundry's conservative estimate. It labels the amount "ETH" because standard Foundry does not know Arc; the unit is USDC. |
| Expected actual cost | about 0.03 USDC | The same bytecode used 1,492,793 gas on Arc Testnet, at roughly 20.4 gwei (the mainnet RPC's gas price on 2026-10-30). |

These are estimates, not quotes. Fund the deployer with more than the conservative figure. Later transactions are far cheaper: on Arc Testnet a release used 133,622 gas and a refund 68,350 gas.

## 6. Manual review gate (do this before the real run)

Stop and complete every item. Do not continue if any answer is "no" or "unsure".

1. [ ] I re-read the warning at the top of this file.
2. [ ] I re-verified chain ID, RPC, explorer and USDC address against `docs.arc.io` myself.
3. [ ] `sha256sum contracts/ArcSLA.sol` matches the version I reviewed, and `forge test` passes locally.
4. [ ] I read `contracts/script/DeployArcSLA.s.sol` and understand each guard.
5. [ ] The non-broadcast dry run succeeded from my machine with my deployer address.
6. [ ] I understand ArcSLA has no owner, no pause and no upgrade path: a deployed defect cannot be patched.
7. [ ] I know the verifier is trusted and I have chosen an independent verifier for the demo.
8. [ ] I have completed (or knowingly accepted the absence of) an independent professional audit.
9. [ ] The amount I will use in the demo is one I can afford to lose.
10. [ ] I filled in `docs/DEPLOYMENT_READINESS.md`.

## 7. Deploy (only after step 6, and only by you)

The same command as the dry run with `--broadcast` added:

```bash
forge script contracts/script/DeployArcSLA.s.sol:DeployArcSLA \
  --rpc-url https://rpc.mainnet.arc.io \
  --account arcsla-mainnet-deployer --sender <your-deployer-address> \
  --broadcast
```

Then immediately:

1. Record the transaction hash, the contract address and the receipt's block number. Open the transaction on `https://explorer.arc.io`.
2. Verify the deployment independently:
   ```bash
   cast call <ARCSLA> "usdc()(address)" --rpc-url https://rpc.mainnet.arc.io          # must be 0x3600…0000
   cast call <ARCSLA> "eip712Domain()" --rpc-url https://rpc.mainnet.arc.io           # name ArcSLA, version 1, chainId 5042, verifyingContract <ARCSLA>
   cast call <ARCSLA> "agreementCount()(uint256)" --rpc-url https://rpc.mainnet.arc.io   # 0
   ```
3. Verify the source on the explorer if it supports it, and check the verified bytecode matches your local `forge build`.

## 8. Point the frontend at mainnet

The app defaults to Arc Testnet. To use mainnet, set all of these in `.env` (never commit it) and restart the dev server:

```
VITE_ARC_CHAIN_ID=5042
VITE_ARCSLA_ADDRESS=<mainnet ArcSLA address>
VITE_ARCSLA_DEPLOY_BLOCK=<mainnet deployment block>
```

Do **not** set `VITE_USDC_ADDRESS` on mainnet. The app refuses transactions if it differs from the official address.

Built-in safeguards when the chain is Arc Mainnet:
- A prominent real-funds banner is shown, and transactions stay disabled until you tick the acknowledgement.
- The app checks, with read-only calls, that the configured address has code, that it reports `ArcSLA`/`1`, an EIP-712 domain bound to chain 5042 and its own address, and the expected USDC token. If any check fails, every transaction and every signing button is disabled.
- Writes are also disabled if your wallet is on another network or the configuration is invalid.
- The header labels the network as MAINNET.

Remember: the testnet address in the repository is **not** valid on mainnet.

## 9. Mainnet smoke-test checklist

Use three separate wallets: customer, provider and an independent verifier. Use the smallest amount that is meaningful. Record every transaction hash. Do not skip a step or run steps in a different order.

### A. Before any transaction
- [ ] App header shows MAINNET and chain 5042; banner visible; acknowledgement ticked deliberately.
- [ ] No "Contract check failed" or "Configuration problem" notices.
- [ ] Customer wallet holds the test amount plus gas USDC.
- [ ] Record starting USDC balances of customer, provider and the ArcSLA contract.

### B. Agreement creation
- [ ] Create page: provider and verifier addresses pasted and double-checked character by character.
- [ ] Amount and short deadline (for example 1 hour) entered; specification hash noted.
- [ ] Approve exactly the agreement amount. Tx hash: ______ (explorer link: ______)
- [ ] Fund the agreement. Tx hash: ______; `AgreementCreated` event visible; agreement ID: ______
- [ ] Contract balance rose by exactly the amount; customer balance fell by the amount plus gas.

### C. EIP-712 settlement
- [ ] Switch to the verifier wallet. Open Verifier console for the agreement ID.
- [ ] "Recovered signer" equals the verifier, and "Digest vs contract" says Identical.
- [ ] Run "Check this signature" (simulation): contract would accept.
- [ ] Run "Test a tampered signature": contract rejects with `InvalidSigner` (simulation; no tx).
- [ ] Submit and release. Tx hash: ______; `AgreementReleased` event visible.
- [ ] Provider balance rose by exactly the amount; contract balance returned to its starting value; agreement shows Released with the evidence hash.
- [ ] A second submission of the same signature fails (simulation shows `AgreementNotActive`).

### D. Refund
- [ ] Create a second small agreement with a short deadline and do not attest it. Tx hashes: approve ______, fund ______
- [ ] Before the deadline, the refund button is not offered on the agreement page.
- [ ] After the deadline passes (strictly after), claim the refund from the customer wallet. Tx hash: ______; `AgreementRefunded` event visible.
- [ ] Customer balance returned (less gas); contract balance back to starting value; agreement shows Refunded.

### E. Explorer evidence
- [ ] Each hash above opens on `https://explorer.arc.io` with status Success.
- [ ] Screenshot or export each transaction page, the contract page and the event logs.
- [ ] `totalEscrowed()` is 0 after the test.
- [ ] Fill in `docs/MAINNET_EVIDENCE_CHECKLIST.md` with the hashes, balances and block timestamps.

### F. Stop conditions
Stop at once and do not fund more if: any balance differs from expectation, any transaction reverts unexpectedly, the app shows a contract-check failure, or anything on screen does not match what you intended to sign.

## 10. Cannot be undone

There is no admin key, pause or upgrade. If something goes wrong after deployment, the contract cannot be repaired; a fixed version would be a new deployment at a new address with an empty history.
