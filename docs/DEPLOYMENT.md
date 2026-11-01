# Deploying ArcSLA

ArcSLA has one constructor argument: the USDC token address. There is no owner to configure.

## 1. Build and test

```bash
bun install
forge build
forge test
```

## 2. Choose the token address

Take the USDC address for your chain from `src/onchain-facts.ts` (`getUsdc(chainId).address`), and confirm it independently against Circle's official documentation before deploying. On Arc, USDC is a native-gas-token ERC-20 predeploy with 6 decimals. Never paste an address from an unverified source.

## 3. Deploy

### Arc Testnet from Arc Studio
Ask Arc Studio to deploy `ArcSLA` to Arc Testnet. It runs a rehearsal on a fork of the chain, then deploys with the USDC address above as the only argument.

### Arc Testnet or any chain from your own machine

```bash
USDC_ADDRESS=<verified usdc address> \
forge script contracts/script/DeployArcSLA.s.sol:DeployArcSLA \
  --rpc-url "$RPC_URL" --account <foundry-keystore-name> --broadcast
```

Use a Foundry keystore (`cast wallet import`) or a hardware wallet. Never pass a raw private key on the command line in a shared environment. The script refuses to run if the token address has no code on the target chain.

Alternative scripts bundled with Arc Studio (`bun run deploy:self`, `bun run compass:deploy`) deploy from a Circle developer-controlled wallet; see `scripts/` for their flags.

## 4. Point the frontend at the contract

1. Note the contract address and the deployment block from the transaction receipt.
2. Copy `.env.example` to `.env` and set:
   - `VITE_ARCSLA_ADDRESS`
   - `VITE_ARCSLA_DEPLOY_BLOCK`
   - `VITE_ARC_CHAIN_ID` (default 5042002)
3. Restart the dev server. Vite reads `.env` only at startup.

## 5. Refresh the ABI after any contract change

```bash
forge build
bun run abi:export
```

This rewrites `contracts/abi/ArcSLA.abi.json` and `src/contracts/ArcSLA.abi.ts` from the compiled artifact.

## 6. Smoke test on testnet

1. Fund two or three wallets with Arc Testnet USDC (gas is paid in USDC too).
2. Customer: create a 1 USDC agreement with a 10 minute deadline (Create page).
3. Verifier wallet: sign an attestation and release (Verifier console).
4. Customer: create another agreement, wait for the deadline, claim the refund (Refund console).
5. Verifier console: run "Test a tampered signature" and confirm the contract rejects it.
6. Record the transaction hashes. They are your evidence.

## Moving beyond testnet

Mainnet involves real funds and irreversible transactions. Complete an independent professional audit first, deploy from your own wallet outside Arc Studio, and follow `docs/MAINNET_DEPLOYMENT.md`, `docs/DEPLOYMENT_READINESS.md` and `docs/MAINNET_EVIDENCE_CHECKLIST.md`.
