# Deploying ArcSLA to Arc Mainnet with MetaMask or Rabby

> Warning: Transactions on mainnet involve real funds and, once submitted, are irreversible. Arc Studio does not deploy to, transact on, sign for, fund, or otherwise interact with mainnet on your behalf. Everything below is run by you, on your machine, with your wallet. ArcSLA has had no independent professional audit. Nothing in this document has been executed: no transaction has been signed or sent.

This procedure deploys the exact reviewed bytecode: the Foundry build of `contracts/ArcSLA.sol` (sha256 `3002abab63b21a7bc525d4953d4b13c83612f3d8c300525737c98e56f11f8730`), with the official Arc USDC `0x3600000000000000000000000000000000000000` as the single constructor argument. It never needs a private key, seed phrase or wallet export: your wallet extension signs, and you approve in its own window.

## 1. Which browser-wallet method, and why

| Method | Exact reviewed bytecode? | Verdict |
| --- | --- | --- |
| Remix "Deploy" button with Injected Provider | **Not guaranteed.** Remix compiles the source itself. The creation bytecode ends with a metadata hash that covers the source file paths, import paths (`node_modules/@openzeppelin/...` in the reviewed build) and the exact settings, so a Remix build usually differs in those trailing bytes. Remix's Deploy button cannot take a pre-built Foundry artifact. | Not recommended. It cannot reproduce the reviewed `creation-bytecode.hex` checksum. |
| Remix script (ethers/web3 with `artifacts/<name>.json`) | Possible: a script can deploy `data.bytecode.object` you place in Remix's artifact format. | Fallback only. It runs inside a large third-party web app that auto-updates, so there is far more code to trust than in the page below. |
| MetaMask / Rabby UI alone | They cannot send a contract-creation transaction with custom data from their own screens. | Not possible. |
| **Local deployer page (`deploy-package/deploy.html`)** | **Yes.** It loads `deploy-data.hex` that you generate from your own build, refuses to continue unless its SHA-256 equals the reviewed value, and asks your wallet to send one contract-creation transaction with exactly that data. | **Recommended.** About 190 lines of JavaScript with no libraries, a Content-Security-Policy that blocks all network access from the page, and 11 offline tests. |
| Foundry with a Ledger or Trezor (see `docs/MAINNET_WSL_DEPLOYMENT.md`) | Yes. | Safest if you own a hardware wallet. MetaMask or Rabby can also front a hardware wallet in the local page. |

Limitation: I could not test the local page with a real MetaMask or Rabby extension (the sandbox has no browser or wallet). It is tested against a mock wallet and reviewed line by line, but your first use of it on mainnet is its first real-wallet run. This is why the post-deployment verification in section 7 is mandatory before you fund anything.

## 2. Reviewed values (what everything is checked against)

| Item | Value |
| --- | --- |
| Network | Arc Mainnet, chain ID 5042 (`0x13b2`), RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io` |
| Native currency in the wallet | USDC, 18 decimals (the ERC-20 view of the same asset has 6) |
| Compiler | solc `0.8.28+commit.7893614a` |
| EVM version / optimizer | `cancun` / enabled, 200 runs |
| Libraries / link references | none (`{}`) |
| Metadata | `bytecodeHash = ipfs` (default) |
| Constructor ABI | `constructor(address usdc_)` (type `contract IERC20`) |
| Constructor argument | `0x0000000000000000000000003600000000000000000000000000000000000000` (32 bytes) |
| `creation-bytecode.hex` | 6,997 bytes, sha256 `65d7b89cd39ace87d6fbc142453d2bcf1033cd3e3b0dd09b8aca67acabd86d05`, keccak256 `0xc02649f4e600b82612f426abc84f9185ef3d63c309d4cebbc76b13875ebdac09` |
| `constructor-args.hex` | 32 bytes, sha256 `9f2b3b216306afa16d861db7be0cf7f4dd7f344f75658e79d1ae01f2dddb4bcb` |
| **`deploy-data.hex`** (transaction data) | **7,029 bytes**, sha256 `ac6db2c9ef94428a99e70aa403bc118aa73acd51ee3d8ee530588ecd8fee3d95`, keccak256 `0x703740bf7eb34907b35ade3db9d7bab72833095d085f5ade407e6195b22c2ade` |
| `runtime-bytecode.hex` | 5,898 bytes, sha256 `a90ee98b897385670eb8eb555b242e88c95ade3b8d8e9a6e7ed76306c8a5d169` |
| Deploy script, other files | See `deploy-package/mainnet/CHECKSUMS.txt` |

The deployer and customer wallet on record is `0xCfEfEc595970C6850777ac44A99Dd949fAc472A6`. Confirm the full address matches your wallet. The page only enables the send button for that account.

## 3. Build and check the package on your own machine

Set up Foundry and the project as in `docs/MAINNET_WSL_DEPLOYMENT.md` sections 1 to 3. Do not assume a path: the project root is the folder that contains `foundry.toml`. Then, from that folder:

```bash
forge --version                       # the review used 1.7.1
forge build
sha256sum contracts/ArcSLA.sol        # must be 3002abab63b21a7bc525d4953d4b13c83612f3d8c300525737c98e56f11f8730
scripts/export-deploy-package.sh deploy-package/mine
diff -r deploy-package/mainnet deploy-package/mine && echo "YOUR BUILD == REVIEWED PACKAGE"
```

`diff` must print nothing and the success line. Any difference means STOP: your compiler, dependencies or source differ from the reviewed ones. Use `deploy-package/mine/deploy-data.hex` in the page (it is identical when the diff is clean).

Independent checks of the transaction data (read-only):

```bash
D=deploy-package/mine/deploy-data.hex
cast keccak "$(cat $D)"                                     # 0x703740bf7eb34907b35ade3db9d7bab72833095d085f5ade407e6195b22c2ade
python3 -c "import hashlib,sys;print(hashlib.sha256(bytes.fromhex(open('$D').read().strip()[2:])).hexdigest())"   # ac6db2c9ef94428a...
echo $(( ($(wc -c < $D) - 2) / 2 ))                         # 7029
tail -c 64 $D                                               # 0000000000000000000000003600000000000000000000000000000000000000
cast abi-encode "constructor(address)" 0x3600000000000000000000000000000000000000   # same 32 bytes as the tail

# Official network and USDC (read-only)
cast chain-id --rpc-url https://rpc.mainnet.arc.io                                          # 5042
cast call 0x3600000000000000000000000000000000000000 "decimals()(uint8)" --rpc-url https://rpc.mainnet.arc.io   # 6
cast call 0x3600000000000000000000000000000000000000 "symbol()(string)"  --rpc-url https://rpc.mainnet.arc.io   # "USDC"

# Read-only simulation of exactly this deployment from your wallet, and the address it will get
W=0xYOUR_WALLET_ADDRESS               # must be 0xCfEfEc595970C6850777ac44A99Dd949fAc472A6
cast estimate --create "$(cat $D)" --from $W --rpc-url https://rpc.mainnet.arc.io          # about 1.38 million gas
N=$(cast nonce $W --rpc-url https://rpc.mainnet.arc.io); echo "nonce $N"
cast compute-address $W --nonce $N                           # write this down: the contract address you expect
cast balance $W --rpc-url https://rpc.mainnet.arc.io | xargs cast from-wei    # USDC (18-dec native view); need at least 0.15
```

Write down the predicted contract address. If your wallet sends any other transaction first (nonce changes), the address changes: recompute it.

## 4. Review the deployer page

```bash
cd deploy-package
node test-deploy.js                   # 11 offline tests must pass (mock wallet, nothing is sent)
less deploy.js                        # read it: one eth_sendTransaction, no libraries, textContent only
python3 -m http.server 8000 --bind 127.0.0.1
```

Open `http://127.0.0.1:8000/deploy.html` in the browser that has MetaMask or Rabby. The page shows the expected network, USDC address, wallet and SHA-256. It sends nothing until the gates below are all OK. (It uses a local server because the Content-Security-Policy allows only same-origin scripts.)

## 5. Connect the wallet to Arc Mainnet

1. Unlock MetaMask or Rabby and select the account `0xCfEf…72A6`. Use a wallet profile with no other connected sites if you can.
2. On the page press **Connect wallet**, approve the connection in the wallet.
3. Press **Switch / add Arc Mainnet**. If the wallet does not know the network, it asks you to approve adding it. Check that it shows exactly: network name Arc Mainnet, chain ID 5042, RPC `https://rpc.mainnet.arc.io`, symbol USDC, explorer `https://explorer.arc.io`. Reject if anything differs.
4. Hardware wallet: connect it through MetaMask or Rabby first (enable "blind signing"/contract data on a Ledger if the device asks).

## 6. Load, simulate, confirm and review the transaction

1. Press the file chooser and select your `deploy-package/mine/deploy-data.hex`. The page must print `7029 bytes`, the SHA-256 `ac6db2c9…ee3d95` and **MATCHES the reviewed checksum**. If it says DOES NOT MATCH, stop.
2. Press **Estimate (sends nothing)**. It runs a read-only gas estimate for this exact data: expect about 1.38 million gas. Failure means stop and investigate.
3. All five gates must read OK: data matches, wallet on Arc Mainnet, expected account, estimate succeeded, typed confirmation. Type `DEPLOY-5042`.
4. Press **Send deployment transaction**. Your wallet opens. Before you approve, check every line:
   - Account: `0xCfEf…72A6` (the "From").
   - Network: Arc Mainnet.
   - Type: **contract deployment / contract creation**. There must be **no "To" address** (no recipient) and **0 USDC value**.
   - Data: **7,029 bytes**. In MetaMask open the Hex data tab, in Rabby the raw data view. The start must read `0x6101806040…` and the last 64 hex characters must be `…0000003600000000000000000000000000000000000000` preceded by zeros, i.e. a 32-byte word ending in `3600000000000000000000000000000000000000`.
   - Fee: the network fee is paid in USDC. At the 25 gwei seen at preparation time it is about 0.034 to 0.045 USDC; the maximum fee per gas must be at least 20 gwei. If the wallet proposes a fee more than about 0.10 USDC, reject and retry later.
5. If everything matches, approve in the wallet. If anything differs, **Reject**: nothing was sent.

## 7. Verify BEFORE funding or approving anything (mandatory)

The contract holds no funds until someone approves USDC to it and creates an agreement. A wrong contract costs only the deployment gas, so verify first:

```bash
scripts/verify-deploy.sh --tx 0xTX_HASH_FROM_THE_PAGE
```

It is read-only. It must end `ALL CHECKS PASSED` after confirming: the transaction is a direct contract creation with value 0; its input equals the reviewed `deploy-data.hex` byte for byte; the contract address equals the one derived from your wallet and nonce (compare with the address you wrote down); the runtime code equals the reviewed runtime bytecode with only the 15 immutable slots masked; one immutable holds the official USDC; `usdc()` is the official USDC; and `eip712Domain()` reports name ArcSLA, version 1, chain ID 5042 and the contract's own address. Also open `https://explorer.arc.io/tx/<hash>` and compare the address and status by eye. If any check fails, **do not approve USDC to the contract and do not use it.**

Validation of this script: run against the Arc Testnet deployment (`--address 0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47 --rpc https://rpc.testnet.arc.io --chain 5042002`) it passed every runtime and state check. That also shows the testnet contract runs exactly the reviewed runtime bytecode. The transaction-input comparison could only be exercised negatively (against the testnet factory-created deployment it correctly reported FAIL); its pass path will run for the first time on your real deployment.

## 8. Record the result

Fill `docs/MAINNET_DEPLOYMENT_RECORD.md` (public data only). Then paste the contract address, transaction hash and block number here so the app's mainnet profile can be prepared; do not paste keys or seed phrases. `.env.mainnet` stays empty until a verified address exists.

## 9. Abort and rollback

- Nothing can be rolled back after the transaction is mined: ArcSLA is immutable, with no owner, pause or upgrade. "Abort" after deployment means: never fund that address. The cost of a bad deployment is the deployment gas (about 0.03 to 0.05 USDC).
- Abort before sending if any check fails: checksum mismatch, wrong network, wrong USDC address, wrong account, estimate failure, wallet shows a `To` address or a value, gas price above about 100 gwei, balance below 0.15 USDC.
- Transaction stuck pending: do not send a second deployment. Check the explorer and `cast nonce`. Use the wallet's Speed up (same data) or Cancel (self-transfer with the same nonce) only after confirming the first one is not mined.
- Page or wallet shows a different hash than the explorer, or the receipt address is not the predicted one: stop and investigate before any funding.

## 10. After a verified deployment

1. Put the verified address and deployment block into `.env.mainnet` (template: `.env.mainnet.example`, caps `VITE_MAX_AGREEMENT_USDC=0.01`, `VITE_MAX_DEADLINE_HOURS=2`) and run `bun run dev:mainnet`, as in `docs/MAINNET_POC_RUNBOOK.md`.
2. Run the 0.01 USDC smoke test from that runbook with the tester-controlled provider and verifier wallets.
3. A public working demo and a DoraHacks submission can show the verified Arc Testnet lifecycle evidence now; mainnet claims should wait for the verified mainnet transactions and their explorer links.

## 11. Limitations and blockers

- No independent audit; mainnet behaviour of the app (wallet prompts, guard banners) is untested until the first real run.
- The local page has not run in a real MetaMask or Rabby window.
- `verify-deploy.sh --tx` has not yet seen a real direct-creation transaction.
- Arc's native fork test (needs Arc's Foundry) is still open.
- You need at least 0.15 USDC in the deployer/customer wallet and the tester-controlled provider and verifier wallets.
