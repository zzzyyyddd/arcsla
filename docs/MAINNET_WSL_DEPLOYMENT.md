# Deploying ArcSLA to Arc Mainnet from Ubuntu WSL (manual procedure)

> Warning: Transactions on mainnet involve real funds and, once submitted, are irreversible. Arc Studio does not deploy to, transact on, sign for, fund, or otherwise interact with mainnet on your behalf. You run every command below yourself, on your own machine, outside Arc Studio, and you are solely responsible for the outcome. ArcSLA has had no independent professional audit. See `docs/MAINNET_READINESS_AUDIT.md` and `docs/MAINNET_POC_RUNBOOK.md`.

Nothing in this document has been executed against mainnet by Arc Studio. The helper script `scripts/mainnet-deploy.sh` was only run in its `dry` mode (read-only checks plus a non-broadcast simulation) from the Arc Studio sandbox to check that it works.

## What is deployed

| Item | Value |
| --- | --- |
| Contract | `ArcSLA` from `contracts/ArcSLA.sol` (unchanged; sha256 below) |
| Network | Arc Mainnet, chain ID **5042** |
| RPC | `https://rpc.mainnet.arc.io` |
| Constructor | `ArcSLA(IERC20 usdc_)`, one argument |
| Constructor argument | `0x3600000000000000000000000000000000000000` (Arc's official USDC ERC-20 interface, 6 decimals) |
| Transaction | one contract creation, value 0, no owner, no proxy |
| Signing | your Ledger/Trezor, a Foundry keystore, or Foundry's hidden interactive prompt |

Reference values for the reviewed build (the script checks them for you):

| Check | Expected |
| --- | --- |
| sha256 `contracts/ArcSLA.sol` | `3002abab63b21a7bc525d4953d4b13c83612f3d8c300525737c98e56f11f8730` |
| sha256 `contracts/script/DeployArcSLA.s.sol` | `70d981528818d2878271228aa57ca7b9cf04de321425188337468dfe9cb12162` |
| keccak256 creation bytecode (`.bytecode.object`) | `0xc02649f4e600b82612f426abc84f9185ef3d63c309d4cebbc76b13875ebdac09` (6,997 bytes) |
| keccak256 of the same without the 53-byte metadata tail | `0x36357998509624b5f44dd2336e737e8d9561b77c3a43f307e68dcefb88c68ee3` |
| keccak256 of the expected transaction input (bytecode + constructor argument) | `0x703740bf7eb34907b35ade3db9d7bab72833095d085f5ade407e6195b22c2ade` |
| Toolchain | solc 0.8.28, EVM `cancun`, optimizer on with 200 runs, OpenZeppelin 5.6.1, Foundry v1.7.1 |

The official USDC address comes from Arc's documentation (docs.arc.io, Contract addresses) and was read back from the mainnet RPC: it has code, `decimals()` returns 6 and `symbol()` returns `USDC`. Open the Arc docs page yourself and compare the address before you deploy.

## 1. Get the project into WSL (no path is assumed)

1. In Arc Studio open the **Code** panel and press **Download Code**. Your browser saves a `.zip` on Windows.
2. In Ubuntu WSL, work inside the Linux filesystem (your home folder), not under `/mnt/c`, because builds are slow and permissions break there:

```bash
mkdir -p ~/arcsla && cd ~/arcsla
ls /mnt/c/Users/*/Downloads/*.zip            # find your downloaded file
cp "/mnt/c/Users/YOUR_WINDOWS_USER/Downloads/YOUR_FILE.zip" ./project.zip
unzip -q project.zip -d src
```

3. Find the project root, the folder that contains `foundry.toml` (the zip may add one extra folder level):

```bash
PROJECT_DIR="$(dirname "$(find ~/arcsla/src -maxdepth 4 -name foundry.toml -not -path '*/node_modules/*' | head -n1)")"
echo "$PROJECT_DIR"
cd "$PROJECT_DIR" && pwd && ls
```

You must see `foundry.toml`, `contracts/`, `scripts/mainnet-deploy.sh` and `remappings.txt`. If `echo` prints just `.`, the search found nothing: re-check the unzip step.

## 2. Install the tools (once)

```bash
sudo apt update && sudo apt install -y unzip jq git curl python3 build-essential nodejs npm
curl -L https://foundry.paradigm.xyz | bash
source ~/.bashrc
foundryup --install v1.7.1
forge --version     # expect 1.7.1
cast --version
```

If `foundryup --install v1.7.1` is rejected by your version of `foundryup`, run plain `foundryup` and rely on the bytecode check in step 4 (it fails closed if the build differs).

Fetch the two Solidity dependencies the project expects (run from `$PROJECT_DIR`):

```bash
# OpenZeppelin 5.6.1 (the remapping points at node_modules/@openzeppelin/contracts)
if [ ! -f node_modules/@openzeppelin/contracts/package.json ]; then
  mkdir -p /tmp/oz && (cd /tmp/oz && npm init -y >/dev/null && npm install @openzeppelin/contracts@5.6.1)
  mkdir -p node_modules/@openzeppelin && cp -r /tmp/oz/node_modules/@openzeppelin/contracts node_modules/@openzeppelin/
fi
jq -r .version node_modules/@openzeppelin/contracts/package.json     # must print 5.6.1

# forge-std (only the deploy script and tests use it)
[ -f lib/forge-std/src/Script.sol ] || forge install --no-git foundry-rs/forge-std
```

## 3. Verify the files and network yourself

```bash
sha256sum contracts/ArcSLA.sol contracts/script/DeployArcSLA.s.sol

export RPC=https://rpc.mainnet.arc.io
cast chain-id --rpc-url $RPC                                                       # 5042
cast call 0x3600000000000000000000000000000000000000 "decimals()(uint8)" --rpc-url $RPC   # 6
cast call 0x3600000000000000000000000000000000000000 "symbol()(string)"  --rpc-url $RPC   # "USDC"
cast code 0x3600000000000000000000000000000000000000 --rpc-url $RPC | head -c 60           # non-empty
```

The two sha256 values must equal the table above. If either differs, stop and re-download.

## 4. Choose how you sign (no private key in chat, files or shell history)

Never use `--private-key` on the command line and never paste a key into a chat, a file or a script.

| Option | Command flag | Notes |
| --- | --- | --- |
| **Ledger** (preferred) | `ledger` | WSL cannot see USB devices by default. Install `usbipd-win` on Windows and attach the Ledger to WSL (Microsoft: "Connect USB devices", learn.microsoft.com/windows/wsl/connect-usb), open the Ethereum app on the device, and enable blind signing if the device asks for it for contract creation. Confirm the address first: `cast wallet address --ledger` must equal your deployer address. Another account index: `HD_PATH="m/44'/60'/0'/0/1"`. |
| **Trezor** | `trezor` | Same USB attachment requirement. |
| **Foundry keystore** | `keystore:NAME` | One-time local import, password-protected: `cast wallet import NAME --interactive` (it prompts for the key with hidden input, you type it only in your own terminal). Then `cast wallet address --account NAME` must equal your deployer address. |
| **Interactive prompt** | `interactive` | Foundry asks for the private key with hidden input at signing time and does not store it. |

If your deployer is a software wallet (for example a browser-extension account), the keystore or interactive options mean the key leaves that wallet once, into your local terminal. For a proof of concept consider a dedicated wallet holding only what this test needs.

Set your public deployer address (this is the same wallet that will act as the customer):

```bash
export DEPLOYER=0xYOUR_DEPLOYER_PUBLIC_ADDRESS
```

## 5. Dry run (nothing is signed or sent)

From `$PROJECT_DIR`:

```bash
chmod +x scripts/mainnet-deploy.sh
./scripts/mainnet-deploy.sh dry $DEPLOYER
```

It checks, in order: tools and Foundry version, the two file hashes, chain ID 5042, the official USDC (code, 6 decimals, `USDC`), a fresh build whose creation bytecode must equal the reviewed one, your deployer nonce and balance (it refuses below 0.10 USDC and warns below 0.15 USDC), the gas price (it refuses above 100 gwei), the contract address your wallet will create, and then runs the Foundry script as a non-broadcast simulation. It must end with `DRY RUN COMPLETE. Nothing was signed or sent.`

Read what it printed. Foundry labels the fee "ETH" and prints a conservative estimate (about 1.77 million gas at roughly twice the live gas price); on Arc the unit is USDC and the real cost is lower: Arc Studio measured a 1,375,814-gas estimate on mainnet, about 0.034 USDC at 25 gwei.

## 6. Review and explicitly confirm the deployment transaction

When the dry run is clean and every checklist item in `docs/MAINNET_POC_RUNBOOK.md` is true, run the same script in `broadcast` mode with your signer:

```bash
./scripts/mainnet-deploy.sh broadcast $DEPLOYER ledger              # or: trezor | interactive | keystore:NAME
```

Before anything is signed the script repeats all checks and prints a review block: network, sender and nonce, `To: (none: contract creation)`, value 0, the constructor argument, the expected contract address and the signer. It then asks you to type exactly `DEPLOY-5042`; anything else aborts with nothing sent. This typed phrase, plus the on-device approval (hardware wallet) or the password/key prompt (keystore/interactive), are your two explicit confirmations.

On a hardware wallet compare on the device screen, as far as it shows them: chain 5042, no recipient (contract creation), value 0, and a data field that is the contract code. A device that cannot display the full data requires blind signing, which is why the script's post-deployment step compares the onchain input byte for byte afterwards.

The script then signs and sends one transaction. Do not run the broadcast command twice. If it is interrupted after you confirmed on the device, do NOT re-run it: first check whether the transaction was sent (section 8).

## 7. Post-deployment verification (automatic, read-only)

The script waits for the receipt and then checks that: the receipt succeeded; the address matches the one predicted before signing; the transaction input equals the reviewed bytecode plus the USDC argument (`0x703740bf…2ade` when hashed); `usdc()` returns `0x3600…0000`; `eip712Domain()` shows name `ArcSLA`, version `1`, chain 5042 and the new contract as verifying contract; `agreementCount()` and `totalEscrowed()` are 0. If any check fails it stops with `FAIL`. A failed check means: do not fund or use that address.

## 8. Record the address and transaction hash

The script prints a block to copy (all public data):

```
ArcSLA address ........ 0x...
Deployment tx hash .... 0x...
Block ................. ...
Gas used .............. ...
Explorer .............. https://explorer.arc.io/tx/0x...
```

1. Paste those values into `docs/MAINNET_DEPLOYMENT_RECORD.md` in your own copy (it has a blank template; nothing is pre-filled).
2. Foundry also saved the raw record in `broadcast/DeployArcSLA.s.sol/5042/run-latest.json`. To print it again:

```bash
jq '{hash: .transactions[0].hash, contract: .transactions[0].contractAddress, block: .receipts[0].blockNumber, gasUsed: .receipts[0].gasUsed, status: .receipts[0].status}' broadcast/DeployArcSLA.s.sol/5042/run-latest.json
```

3. If the terminal output was lost, find the transaction in your wallet history or on `https://explorer.arc.io` under your deployer address, then check it independently:

```bash
cast receipt TX_HASH --rpc-url $RPC
cast nonce $DEPLOYER --rpc-url $RPC
cast compute-address $DEPLOYER --nonce NONCE_USED_BY_THE_DEPLOYMENT
```

4. Save a copy of `broadcast/` and the record somewhere safe. The existing Arc Testnet deployment (`0x2C4283d9…1B47`) and all its evidence are unrelated and stay as they are.

## 9. After deployment: send Arc Studio the public data

Reply in the Arc Studio chat with only the ArcSLA address, the deployment tx hash and the block number. Never send keys or seed phrases. Arc Studio will then re-read the contract from the mainnet RPC, record it in the docs and prepare the mainnet profile in the sandbox (`.env.mainnet` and `bun run dev:mainnet`, with the 0.01 USDC and 2-hour limits). Arc Studio will still not sign or send anything. The 0.01 USDC agreement itself is then created from the web app in your own wallet, following `docs/MAINNET_POC_RUNBOOK.md`.

## Abort and failure rules

Stop and do not sign if any of these is true before you type `DEPLOY-5042`: the chain ID is not 5042; a file hash or the bytecode check fails; USDC does not match the Arc docs; the deployer balance is below 0.10 USDC; the gas price is above 100 gwei; you are not ready to accept that the contract is immutable and unaudited.

After deployment there is no rollback: ArcSLA has no owner, pause, upgrade or removal. If a post-deployment check fails, simply never fund that address (the roughly 0.03 to 0.05 USDC of gas is spent). If a transaction is stuck pending, wait and check the explorer; do not send a second deployment from the same nonce unless you have confirmed the first one can no longer be mined.
