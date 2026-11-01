# ArcSLA Arc Mainnet deployment record (template)

PUBLIC data only. Never write a private key, seed phrase, keystore password or API secret here. The deployment section below was filled in on 2026-10-31 from READ-ONLY chain reads (`scripts/verify-deploy.sh --tx …` passed every check: direct creation, input byte-for-byte equal to the reviewed deploy data, address derived from sender and nonce 0, runtime code equal to the reviewed runtime bytecode, `usdc()` and the EIP-712 domain correct). The proof-of-concept agreement section is still blank: no mainnet agreement has been created, so the mainnet escrow lifecycle is NOT verified.

| Item | Value |
| --- | --- |
| Network | Arc Mainnet, chain ID 5042 |
| RPC used | https://rpc.mainnet.arc.io |
| USDC (constructor argument) | 0x3600000000000000000000000000000000000000 |
| ArcSLA.sol sha256 | 3002abab63b21a7bc525d4953d4b13c83612f3d8c300525737c98e56f11f8730 |
| Deployer (also the customer) | 0xCfEfEc595970C6850777ac44A99Dd949fAc472A6 (read from the creation transaction) |
| Deployer nonce at deployment | 0 |
| ArcSLA address (mainnet) | 0x5F040Bc617666359C543bfFbE25DD00c4FfCbdAC |
| Deployment tx hash | 0x25c9ec657b34e9c91a7c4a836b9b5352a0b0cfb7472071ca26da0289db1e7e66 |
| Deployment block | 28741163 |
| Gas used | 1,363,823 (effective gas price about 25.58 gwei) |
| Explorer link | https://explorer.arc.io/tx/0x25c9ec657b34e9c91a7c4a836b9b5352a0b0cfb7472071ca26da0289db1e7e66 |
| `usdc()` read back | 0x3600000000000000000000000000000000000000 |
| `eip712Domain()` read back (name, version, chainId, verifyingContract) | ArcSLA, 1, 5042, 0x5F040Bc617666359C543bfFbE25DD00c4FfCbdAC |
| `agreementCount()` / `totalEscrowed()` | 0 / 0 (read 2026-10-31, block 28746788; ArcSLA holds 0 USDC; allowance from the deployer wallet to ArcSLA is 0) |
| Date and time (UTC) | block 28741163 timestamp 1793411246 |

## Proof-of-concept agreement (0.01 USDC)

| Item | Value |
| --- | --- |
| Agreement ID | |
| Customer / provider / verifier | |
| Amount | 0.01 USDC (10,000 units) |
| Deadline | |
| Approve tx hash | |
| Create tx hash | |
| Release (or refund) tx hash | |
| Final status read from the contract | |

The Arc Testnet deployment (0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47, chain 5042002) and its evidence are separate and unchanged. Never reuse that address on mainnet.
