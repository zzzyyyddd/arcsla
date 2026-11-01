# ArcSLA Arc Testnet adversarial evidence

Target: ArcSLA `0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47` on Arc Testnet (chain ID 5042002), deployed in tx `0xa94ee19a400f3c863362c0fbab49cf40abbef7772bb8d5a1c02210bd214df0c6`.
Run against block **69765441** (timestamp 1793325633) on `https://rpc.testnet.arc.io`, 2026-10-30.
Reproduce: `bun run scripts/testnet-adversarial.ts` (needs `forge build` first for the probe artifact).

**Arc Studio broadcast nothing.** It sent no transaction, approved no token, moved no funds and touched no mainnet endpoint. The confirmed onchain transactions listed below were all sent by the project owner from their own wallets. `ArcSLA.sol` is unchanged. The signing keys used are deterministic, unfunded, test-only keys derived from public strings in the script.

## How to read the results

| Evidence type | Meaning |
| --- | --- |
| **LIVE eth_call** | A read-only call against the real chain state at the pinned block. Nothing overridden. |
| **OVERRIDE eth_call** | A read-only call where the RPC's private copy of state is edited for that one call: synthetic **Active** agreements are written into storage, the contract is given a matching native USDC balance, and the block clock (`blockOverrides.time`) is set to chosen values. The real deployed bytecode runs, but the agreements and the time are hypothetical. Nothing is persisted. |
| **ONCHAIN data** | Values read from the chain: state, events, receipts, calldata, bytecode. |
| **OFFCHAIN signing** | Local EIP-712 signing and recovery. |
| **LOGIC (bun)** | The shipped frontend functions (`verifyArcSlaContract`, `computeBlockedReason`) executed in Bun, some against the live RPC. This is **not** a rendered browser interaction. |

**Confirmed onchain transactions** (sent by the project owner, re-read from the chain by this report):

| Tx | What | Block |
| --- | --- | --- |
| `0xc3f34d15b779d2c570e8f8f513593bd25eb6f1487534007eb4a5a08b98f194c3` | Release, agreement #1 (earlier lifecycle evidence) | 69658526 |
| `0x84315c8040879c04147375471694d395db007b70afeadf798fe1a9f3b2f53e9e` | Refund, agreement #2 (earlier lifecycle evidence) | 69664776 |
| `0xa4c1ef4f9c0193e8e1351ef5c44f8898183362754e4a193f7169791651c803bc` | Create, agreement #3 (earlier run, not counted as T1 or T1b) | 69800516 |
| `0x230717b1672c77221ee16537ca18e589b1d0d7a3ec1feb8dc8a35c8633c0f960` | Refund, agreement #3 (earlier run, not counted as T1 or T1b) | 69802838 |
| `0x5ef131ed9edc93a00fb2005aeef6fa9e5b56e96fb5e7ee4ac97a0be0977e8cb8` | **Create and fund, agreement #4 (T1.1)** | 69807573 |
| `0x04f5990b37fdb5ec4d2fcafc0f179911792e5456ca534f8b91283630c85a70c6` | **Release, agreement #4 (T1.5)** | 69808763 |

The approval transaction that preceded the #4 creation was not supplied and is not listed; its hash was not looked up and is not invented here. Every other result in this report is a read-only simulation or a logic test, and none of them is a substitute for a confirmed transaction.

## Expected behavior (from the deployed source)

| Condition (agreement Active) | Result |
| --- | --- |
| `now <= deadline` and `now <= attestation expiry`, valid verifier signature | `release` succeeds, pays the provider |
| `now == deadline` | release allowed, refund reverts `RefundNotAvailable` |
| `now == deadline + 1` | release reverts `DeadlinePassed`, customer refund allowed |
| `now > expiry` | release reverts `AttestationExpired` |
| Refund by anyone but the customer | `NotCustomer` (checked after the status check) |
| Any call on a Released or Refunded agreement | `AgreementNotActive` (checked first) |
| Unknown ID or ID 0 | `AgreementNotFound` |
| Wrong signer, tampered or replayed signature | `InvalidSigner` |

Check order inside `release`: not found, not active, deadline, expiry, spec hash, provider, zero evidence hash, signature.

## Summary

PASS **59** · FAIL **0** · BLOCKED **1** · NOT RUN **2** (U1, T2)

U2 was split on 2026-10-30 into U2a (automated and browser-trace evidence, PASS) and U2b (rendered banner and disabled controls). U2b is PASS for the partial scope the project owner observed manually; see "U2b manual observations" for what was and was not checked.

| ID | Test | Evidence type | Result |
| --- | --- | --- | --- |
| B0 | Boundary rules in the source that was deployed | ONCHAIN data | **PASS** |
| B1 | Deployed runtime code is the compiled ArcSLA | ONCHAIN data | **PASS** |
| L1 | Duplicate release: agreement #1 (already Released) | LIVE eth_call | **PASS** |
| L2 | Duplicate refund: agreement #2 (already Refunded), caller is its customer | LIVE eth_call | **PASS** |
| L3 | Refund after release: agreement #1, caller is its customer | LIVE eth_call | **PASS** |
| L4 | Release after refund: agreement #2 | LIVE eth_call | **PASS** |
| L5 | Unauthorized refund (stranger) on settled agreement #1 | LIVE eth_call | **PASS** |
| L6 | Refund of nonexistent agreement #3 | LIVE eth_call | **PASS** |
| L7 | Release of agreement ID 0 | LIVE eth_call | **PASS** |
| C1 | Escrow conservation on current chain state | ONCHAIN data | **PASS** |
| C2 | Agreement isolation on current chain state (#1 released, #2 refunded) | ONCHAIN data | **PASS** |
| C3 | Confirmed lifecycle transactions are final and successful | ONCHAIN data | **PASS** |
| D1 | Real release signature (from tx calldata) recovers to the agreement verifier under the frontend typed-data definition | ONCHAIN data | **PASS** |
| D2 | Real verifier signature accepted when #1 is rehydrated to Active (positive control) | OVERRIDE eth_call | **PASS** |
| D3 | Real verifier signature with one byte flipped is rejected | OVERRIDE eth_call | **PASS** |
| D4 | Real signature replayed with a different evidence hash is rejected | OVERRIDE eth_call | **PASS** |
| D5 | Real attestation submitted one second after the agreement deadline | OVERRIDE eth_call | **PASS** |
| S0 | Self-test: synthetic storage layout decodes as an Active agreement | OVERRIDE eth_call | **PASS** |
| E1 | Early refund by the customer (now = deadline - 3590s) | OVERRIDE eth_call | **PASS** |
| E2p | Unauthorized refund by provider, before the deadline | OVERRIDE eth_call | **PASS** |
| E3p | Unauthorized refund by provider, after the deadline (agreement #6, Active and expired) | OVERRIDE eth_call | **PASS** |
| E2v | Unauthorized refund by verifier, before the deadline | OVERRIDE eth_call | **PASS** |
| E3v | Unauthorized refund by verifier, after the deadline (agreement #6, Active and expired) | OVERRIDE eth_call | **PASS** |
| E2s | Unauthorized refund by stranger, before the deadline | OVERRIDE eth_call | **PASS** |
| E3s | Unauthorized refund by stranger, after the deadline (agreement #6, Active and expired) | OVERRIDE eth_call | **PASS** |
| E4 | Refund exactly AT the deadline (now == deadline) | OVERRIDE eth_call | **PASS** |
| E5 | Refund one second AFTER the deadline (now == deadline + 1) by the customer | OVERRIDE eth_call | **PASS** |
| E5b | Refund of an already-expired agreement (#6) by its customer (positive control) | OVERRIDE eth_call | **PASS** |
| E6 | Valid release by a stranger (positive control, correct verifier key) | OVERRIDE eth_call | **PASS** |
| E7 | Signature from a non-verifier key | OVERRIDE eth_call | **PASS** |
| E8 | Tampered signature: every one of the 65 bytes flipped (one bit each) | OVERRIDE eth_call | **PASS** |
| E9 | Replay across agreements: signature for #3 submitted for #4 (identical terms) | OVERRIDE eth_call | **PASS** |
| E10 | Cross-chain replay: signature made for chain 5042 domain | OVERRIDE eth_call | **PASS** |
| E11 | Cross-contract replay: signature made for a different verifyingContract | OVERRIDE eth_call | **PASS** |
| E12 | Tampered fields: provider differs from the agreement | OVERRIDE eth_call | **PASS** |
| E13 | Tampered fields: specification hash differs from the agreement | OVERRIDE eth_call | **PASS** |
| E14 | Tampered fields: evidence hash differs from what was signed | OVERRIDE eth_call | **PASS** |
| E15 | Tampered fields: expiry differs from what was signed | OVERRIDE eth_call | **PASS** |
| E16 | Zero evidence hash | OVERRIDE eth_call | **PASS** |
| E17 | Expired attestation (expiry = now - 1) | OVERRIDE eth_call | **PASS** |
| E18 | Attestation expiring exactly now (expiry == now) is still valid | OVERRIDE eth_call | **PASS** |
| E19 | Settlement one second after the deadline (now == deadline + 1) | OVERRIDE eth_call | **PASS** |
| E20 | Settlement exactly AT the deadline (now == deadline) | OVERRIDE eth_call | **PASS** |
| P1 | Sequenced duplicates and ordering inside ONE simulated call (release x2, refund x2, release-after-refund, refund-after-release, non-customer refund, replay) | OVERRIDE eth_call | **PASS** |
| P2 | Agreement isolation: settling #3, #7, #8 leaves #4, #5, #6 byte-for-byte unchanged | OVERRIDE eth_call | **PASS** |
| P3 | Escrow conservation: contract outflow equals provider + refunded-customer inflow; no third party gains | OVERRIDE eth_call | **PASS** |
| P4 | Invariant after settlement: contract USDC >= totalEscrowed and totalEscrowed == sum of remaining Active | OVERRIDE eth_call | **PASS** |
| F1 | Guard check passes for the real deployment (positive control) | LOGIC (bun) | **PASS** |
| F2 | Wrong network: RPC for a different chain (Base Sepolia 84532) while configured for 5042002 | LOGIC (bun) | **PASS** |
| F3 | Invalid contract address: EOA / no code (provider wallet) | LOGIC (bun) | **PASS** |
| F4 | Invalid contract address: empty address | LOGIC (bun) | **PASS** |
| F5 | Invalid contract address: a real contract that is not ArcSLA (USDC) | LOGIC (bun) | **PASS** |
| F6 | Configured USDC differs from the one the contract settles in | LOGIC (bun) | **PASS** |
| F7 | Write guard decision table (wrong network, bad contract, bad config, mainnet acknowledgement) | LOGIC (bun) | **PASS** |
| Z1 | Verifier signing needs no USDC: a wallet holding exactly 0 USDC signs the EIP-712 attestation | OFFCHAIN signing | **PASS** |
| Z2 | Submitting a transaction from the zero-balance wallet is refused for lack of gas (non-broadcast, gas-priced eth_call) | LIVE eth_call | **BLOCKED** |
| Z3 | Verifier console code never reads or requires a USDC/gas balance before signing | LOGIC (bun) | **PASS** |
| U1 | Rendered UI: wallet connected to a different network shows the switch banner and disabled transaction buttons | LOGIC (bun) | **NOT RUN** |
| U2a | Invalid contract address (`0x…dEaD`) is detected, writes are blocked by the shipped guard, and the original address is restored and verified | LOGIC (bun, live RPC) + browser traces + ONCHAIN data | **PASS** |
| U2b | Rendered UI: wrong VITE_ARCSLA_ADDRESS shows the "Contract check failed" banner and disables transaction controls (manual observation by the project owner) | Browser (manual) | **PASS** (partial scope: refund controls, other controls and clicks on disabled buttons not checked) |
| T1 | Agreement #4 end to end: create and fund 0.10 USDC (real tx), early-refund rejection, wrong-signer rejection, tampered-signature rejection (read-only simulations), valid attestation, release (real tx), duplicate release rejection (read-only) | ONCHAIN tx + simulations (see T1.1 to T1.7) | **PASS** |
| T2 | Confirmed onchain: revert of an unauthorized refund as a real (failing) transaction | ONCHAIN data | **NOT RUN** |

## Current onchain state at the pinned block

2 agreements: #1 Released (1.000000 USDC to provider), #2 Refunded (1.000000 USDC to customer). `totalEscrowed()` 0, USDC held by ArcSLA 0, native balance 0. Events: 2 Created, 1 Released, 1 Refunded, so created 2,000,000 = released 1,000,000 + refunded 1,000,000 + escrowed 0 (test C1). The verifier wallet `0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3` holds exactly 0 USDC, yet its signature was accepted in the confirmed release.

## Findings and caveats

1. **No contract defect found** in any test. Every expected revert and every positive control matched.
2. **Simulation caveat.** OVERRIDE tests prove the deployed bytecode behaves correctly for the stated synthetic state and clock. They do not prove that a real USDC transfer would succeed under every issuer condition (for example a blocklisted recipient); the positive controls did execute Arc USDC transfers inside the simulation, which succeeded.
3. **RPC rate limiting.** The first run hit `rate limit exceeded` (JSON-RPC code -32005) and scored 11 failures and 2 blocked, all caused by that response, not by the contract. The script now paces calls and retries on -32005 and never scores a rate-limit response as a result. The final run above is the complete run.
4. **RPC log range.** `eth_getLogs` rejected a 20,000-block range ("requested range too large") and accepted 10,000 blocks. The frontend event scanner now starts at 10,000 blocks per request (it still halves on error).
5. **Gas-balance check not enforced by eth_call.** The Arc RPC executed a gas-priced `eth_call` from a wallet with 0 USDC instead of rejecting it, so "a zero-balance wallet cannot send" (Z2) is BLOCKED without a broadcast. Signing itself needs no USDC (Z1, Z3).

## Frontend safeguards

Rendered-browser check U1 was NOT RUN because it needs a browser wallet (U2 was later run: see the U2 sections at the end). What was verified instead is the logic those screens depend on, using the shipped code:

- F2: a Base Sepolia (84532) RPC is rejected for an app configured for 5042002.
- F3 to F5: an address with no code, an empty address, and a real non-ArcSLA contract (USDC) are all rejected.
- F6: a different configured USDC is rejected.
- F7: the write-guard decision table blocks writes for wrong wallet network, missing or mismatched contract, still-verifying, invalid configuration and unacknowledged mainnet, and allows them only when everything is valid.

### Steps to run U1 and U2 yourself (no funds, no transactions)

**U1 wrong network.** Open the app with a wallet on any chain other than Arc Testnet. Expected: the "wrong network" notice; every action button reads "Transactions disabled" and shows the switch-network reason; no wallet prompt opens.

**U2 invalid contract address.** Temporarily change `VITE_ARCSLA_ADDRESS` in `.env` to `0x3600000000000000000000000000000000000000` (the USDC contract), restart the dev server, and reload. Expected: a red "Contract check failed" banner and every transaction or signing button disabled. Restore the original address (`0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47`) and restart afterwards. I did not touch `.env`.

<!-- LIVE:START -->
## Live execution results (T1 on agreement #4; optional T1b on agreement #5)

Generated by `bun run scripts/record-live-evidence.ts` at block **69809176** (chain time 1793347878). The script is read-only. A row is PASS only when the chain (or a clearly labelled simulation) shows it. Items nobody has executed stay NOT RUN.

PASS **7** · FAIL **0** · BLOCKED **0** · NOT RUN **5**

| ID | Check | Evidence type | Result |
| --- | --- | --- | --- |
| T1.1 | Create and fund agreement #4 with 0.10 test USDC | ONCHAIN tx | **PASS** |
| T1.2 | Invalid verifier signature (non-verifier wallet) is rejected | REPORTED browser simulation (eth_call), corroborated by the app trace log and a read-only replay (OVERRIDE eth_call) | **PASS** |
| T1.3 | Tampered signature is rejected | REPORTED browser simulation (eth_call), corroborated by the app trace log and a read-only replay (OVERRIDE eth_call) | **PASS** |
| T1.4 | Valid EIP-712 signature accepted | ONCHAIN (implied by the release tx) | **PASS** |
| T1.5 | Release 0.10 USDC to the provider (manual wallet confirmation) | ONCHAIN tx | **PASS** |
| T1.6 | Duplicate release and refund after release are rejected | LIVE eth_call at block 69809176 | **PASS** |
| T1.7 | Early refund is rejected before the deadline | REPORTED browser simulation (eth_call), corroborated by the app trace log and a read-only replay (OVERRIDE eth_call) | **PASS** |
| T1b.1 | Create and fund agreement #5 with 0.10 test USDC | ONCHAIN tx | **NOT RUN** |
| T1b.2 | Early refund is rejected before the deadline | SIMULATION | **NOT RUN** |
| T1b.3 | Refund happened strictly after the deadline | ONCHAIN data | **NOT RUN** |
| T1b.4 | Refund 0.10 USDC to the customer (manual wallet confirmation) | ONCHAIN tx | **NOT RUN** |
| T1b.5 | Duplicate refund and release after refund are rejected | LIVE eth_call | **NOT RUN** |

### Resulting agreement states and accounting

- Agreement #4: status **Released**, amount 100000 (0.1 USDC), customer `0xCfEfEc595970C6850777ac44A99Dd949fAc472A6`, provider `0x9E2c6c57996f4b321d411462DF0D4d634c3C69Fc`, verifier `0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3`, createdAt 1793347063, deadline 1793350560 (3497 s after creation), evidenceHash `0x4e7b1f29aa414f71cb15077621a3aac00f138ee19a313fc6b657112d3889eae8`
- Agreement #5: does not exist yet (agreementCount is 4).
- agreementCount 4, totalEscrowed 0, USDC held by ArcSLA 0 (balance ≥ totalEscrowed: true).

### Earlier live run: agreement #3 (create, then deadline refund)

Read from the chain for reference. **Not counted toward T1 or T1b:** it used a 1027 s deadline window (not the planned values), the release path was not exercised, and no browser-recorded checks were supplied for it.

- Create: tx `0xa4c1ef4f9c0193e8e1351ef5c44f8898183362754e4a193f7169791651c803bc` · block 69800516 (2026-10-30T06:57:53.000Z) · status **success** · from `0xcfefec595970c6850777ac44a99dd949fac472a6` · gas used **247616** · effective gas price 25 gwei · fee 0.0061904 USDC · logs total 3, ArcSLA logs: AgreementCreated({"id":"3","customer":"0xCfEfEc595970C6850777ac44A99Dd949fAc472A6","provider":"0x9E2c6c57996f4b321d411462DF0D4d634c3C69Fc","verifier":"0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3","amount":"100000","deadline":"1793344500","specHash":"0xa732bc81689d273305e32fed967caa7e800c653560d60493c5c0b01192de24e9","createdAt":"1793343473"}). Event args {"id":"3","customer":"0xCfEfEc595970C6850777ac44A99Dd949fAc472A6","provider":"0x9E2c6c57996f4b321d411462DF0D4d634c3C69Fc","verifier":"0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3","amount":"100000","deadline":"1793344500","specHash":"0xa732bc81689d273305e32fed967caa7e800c653560d60493c5c0b01192de24e9","createdAt":"1793343473"}
- Refund: tx `0x230717b1672c77221ee16537ca18e589b1d0d7a3ec1feb8dc8a35c8633c0f960` · block 69802838 (2026-10-30T07:17:35.000Z) · status **success** · from `0xcfefec595970c6850777ac44a99dd949fac472a6` · gas used **68350** · effective gas price 25 gwei · fee 0.00170875 USDC · logs total 3, ArcSLA logs: AgreementRefunded({"id":"3","customer":"0xCfEfEc595970C6850777ac44A99Dd949fAc472A6","amount":"100000","refundedAt":"1793344655"}). Event args {"id":"3","customer":"0xCfEfEc595970C6850777ac44A99Dd949fAc472A6","amount":"100000","refundedAt":"1793344655"}. Refunded 155 s after the deadline.
- Resulting state: status **Refunded**, amount 100000.

### Details

**T1.1. Create and fund agreement #4 with 0.10 test USDC**  
Type: ONCHAIN tx · Result: **PASS**  
tx `0x5ef131ed9edc93a00fb2005aeef6fa9e5b56e96fb5e7ee4ac97a0be0977e8cb8` · block 69807573 (2026-10-30T07:57:43.000Z) · status **success** · from `0xcfefec595970c6850777ac44a99dd949fac472a6` · gas used **247616** · effective gas price 25 gwei · fee 0.0061904 USDC · logs total 3, ArcSLA logs: AgreementCreated({"id":"4","customer":"0xCfEfEc595970C6850777ac44A99Dd949fAc472A6","provider":"0x9E2c6c57996f4b321d411462DF0D4d634c3C69Fc","verifier":"0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3","amount":"100000","deadline":"1793350560","specHash":"0xa732bc81689d273305e32fed967caa7e800c653560d60493c5c0b01192de24e9","createdAt":"1793347063"}). Amount 100000, deadline 3497 s after creation (planned about 3600 s; window as planned).

**T1.2. Invalid verifier signature (non-verifier wallet) is rejected**  
Type: REPORTED browser simulation (eth_call), corroborated by the app trace log and a read-only replay (OVERRIDE eth_call) · Result: **PASS**  
Reported by the project owner. Corroboration: one reverted browser eth_call, release(4, …) from the customer wallet 0xCfEf…72A6. Recovering the EIP-712 signer from its calldata gives 0xCfEf…72A6, which is not the verifier. Replaying the exact calldata against the Active copy of #4 (state override): InvalidSigner. Expected InvalidSigner, reported InvalidSigner. No transaction was sent.

**T1.3. Tampered signature is rejected**  
Type: REPORTED browser simulation (eth_call), corroborated by the app trace log and a read-only replay (OVERRIDE eth_call) · Result: **PASS**  
Reported by the project owner. Corroboration: one reverted browser eth_call, release(4, …) from the verifier wallet 0x6576…0dc3 whose signature recovers to 0xBc58…97d6, which is not the verifier (consistent with a tampered signature; the trace does not record which button produced it). Replaying the exact calldata against the Active copy of #4 (state override): InvalidSigner. Expected InvalidSigner, reported InvalidSigner. No transaction was sent.

**T1.4. Valid EIP-712 signature accepted**  
Type: ONCHAIN (implied by the release tx) · Result: **PASS**  
the release transaction succeeded, which requires the contract to have recovered the verifier from the EIP-712 signature; browser pre-check reported by the project owner: accepted (Reported by the project owner. No successful eth_call for this check is present in the trace file (the file is size-capped and older entries are evicted). The valid signature is independently proven onchain by the successful release transaction.)

**T1.5. Release 0.10 USDC to the provider (manual wallet confirmation)**  
Type: ONCHAIN tx · Result: **PASS**  
tx `0x04f5990b37fdb5ec4d2fcafc0f179911792e5456ca534f8b91283630c85a70c6` · block 69808763 (2026-10-30T08:07:48.000Z) · status **success** · from `0x65760dfa797b2d75a3f6e006cb0807f93e2d0dc3` · gas used **108634** · effective gas price 25 gwei · fee 0.00271585 USDC · logs total 3, ArcSLA logs: AgreementReleased({"id":"4","provider":"0x9E2c6c57996f4b321d411462DF0D4d634c3C69Fc","verifier":"0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3","amount":"100000","specHash":"0xa732bc81689d273305e32fed967caa7e800c653560d60493c5c0b01192de24e9","evidenceHash":"0x4e7b1f29aa414f71cb15077621a3aac00f138ee19a313fc6b657112d3889eae8","attestationExpiry":"1793351107","submitter":"0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3","releasedAt":"1793347668"}). Event args {"id":"4","provider":"0x9E2c6c57996f4b321d411462DF0D4d634c3C69Fc","verifier":"0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3","amount":"100000","specHash":"0xa732bc81689d273305e32fed967caa7e800c653560d60493c5c0b01192de24e9","evidenceHash":"0x4e7b1f29aa414f71cb15077621a3aac00f138ee19a313fc6b657112d3889eae8","attestationExpiry":"1793351107","submitter":"0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3","releasedAt":"1793347668"}. Included before deadline: true.

**T1.6. Duplicate release and refund after release are rejected**  
Type: LIVE eth_call at block 69809176 · Result: **PASS**  
release again: AgreementNotActive; refund as customer: AgreementNotActive

**T1.7. Early refund is rejected before the deadline**  
Type: REPORTED browser simulation (eth_call), corroborated by the app trace log and a read-only replay (OVERRIDE eth_call) · Result: **PASS**  
Reported by the project owner. Corroboration: the app's trace log holds one reverted browser eth_call, refund(4) from the customer wallet 0xCfEf…72A6, sent about 100 s after the agreement was created (before the deadline). The trace stores no revert data, so the error name comes from replaying that exact calldata read-only against a copy of #4 forced back to Active (state override, chain time createdAt+300): RefundNotAvailable. Expected RefundNotAvailable, reported RefundNotAvailable. No transaction was sent.

**T1b.1. Create and fund agreement #5 with 0.10 test USDC**  
Type: ONCHAIN tx · Result: **NOT RUN**  
no agreement with this ID exists yet

**T1b.2. Early refund is rejected before the deadline**  
Type: SIMULATION · Result: **NOT RUN**  
no record, and the deadline has either passed or #5 does not exist

**T1b.3. Refund happened strictly after the deadline**  
Type: ONCHAIN data · Result: **NOT RUN**  
agreement #5 has not been refunded

**T1b.4. Refund 0.10 USDC to the customer (manual wallet confirmation)**  
Type: ONCHAIN tx · Result: **NOT RUN**  
agreement #5 has not been refunded

**T1b.5. Duplicate refund and release after refund are rejected**  
Type: LIVE eth_call · Result: **NOT RUN**  
agreement #5 is not Refunded
<!-- LIVE:END -->

## Live tests T1 and T1b: prepared, awaiting your manual wallet actions

You approved preparing T1 and T1b on 2026-10-30. **T1 has been completed by the project owner on agreement #4** (results in the live block above). T1b (agreement #5) has not been run and stays NOT RUN. Arc Studio signed and sent nothing; every wallet action was the project owner's own confirmation.

### T1 on agreement #4: real transactions versus read-only simulations
| Step | Kind | Evidence |
| --- | --- | --- |
| T1.1 Create and fund 0.10 USDC | **REAL TRANSACTION** | tx `0x5ef131ed…977e8cb8`, block 69807573, success, 247,616 gas, deadline 3,497 s after creation (planned about 3,600 s) |
| T1.7 Early refund rejected | Read-only simulation (not a transaction) | Reported by the project owner; browser `eth_call` present in the trace log; replay gives `RefundNotAvailable` |
| T1.2 Wrong-signer rejected | Read-only simulation | Reported; the browser call's signature recovers to the customer wallet; replay gives `InvalidSigner` |
| T1.3 Tampered signature rejected | Read-only simulation | Reported; the browser call's signature recovers to a non-verifier address; replay gives `InvalidSigner` |
| T1.4 Valid EIP-712 attestation accepted | Proven by the real release tx; the browser pre-check is reported only | No successful `eth_call` for it remains in the trace log |
| T1.5 Release 0.10 USDC to the provider | **REAL TRANSACTION** | tx `0x04f5990b…c85a70c6`, block 69808763, success, 108,634 gas, `AgreementReleased` for #4, submitted from the verifier wallet |
| T1.6 Duplicate release rejected | Read-only simulation | Reproduced by this report's script as a live `eth_call`: `AgreementNotActive` for both release and refund. The owner's browser-side check is reported only (no trace record) |

Notes. The release was submitted from the verifier wallet `0x6576…0dc3`, which held 0 USDC when read earlier.

**Verifier wallet gas funding (USER-REPORTED, not independently verified onchain).** The project owner confirmed that the verifier wallet initially had insufficient USDC for transaction gas, and that the tester manually topped it up before submitting the successful Agreement #4 release transaction. No top-up transaction hash, amount or time was supplied, and this report did not look for one, so the top-up itself is not verified here. What the chain does show: the release `0x04f5990b…c85a70c6` was sent from `0x6576…0dc3` and succeeded, and an earlier read of that wallet showed 0 USDC. The distinction this clarifies: the EIP-712 signing was performed offchain and needs no gas (consistent with check Z1, a wallet holding 0 USDC can sign), whereas submitting the release onchain required gas. In T1 the verifier wallet also acted as the release submitter, which is why it needed funding; the contract allows anyone to submit a valid attestation, so the customer wallet could have submitted it instead. The error names for the three rejected browser calls come from replaying their exact calldata read-only on a copy of #4 forced back to Active (a state override); the trace log itself stores no revert data. The browser-side records are labelled REPORTED because no recorded-simulation export was supplied.

What was prepared in the app (all read-only until you press a button and confirm in your wallet):
- `/demo/live` "Live testnet runbook": T1 and T1b step lists. Steps tick off only from live contract state or from simulations recorded in the browser.
- `/create?preset=t1` and `/create?preset=t1b` pre-fill the form (0.10 test USDC, planned provider and verifier wallets). **Updated 2026-10-30 (after agreement #3 was used by an earlier create-and-refund run):** T1 is retargeted to agreement #4 with a 60-minute deadline; the optional T1b is retargeted to agreement #5 with a 5-minute deadline. T1 also gained an early-refund simulation step (T1.7). Nothing is sent until you press **Allow USDC** and **Create & fund** and confirm each prompt.
- "Read-only checks" card on every agreement page: simulate an early refund (as the customer), a duplicate release and a duplicate refund. No wallet prompt, no gas.
- The verifier console records wrong-signer, tampered-signature and valid-signature checks for the runbook.

## Original plan for the tests that need a broadcast (kept for reference)

Nothing below has been submitted.

**T1. Live agreement #3 end to end**

| Item | Value |
| --- | --- |
| Customer wallet | `0xCfEfEc595970C6850777ac44A99Dd949fAc472A6` (currently 18.979370 USDC, allowance to ArcSLA 0) |
| Provider wallet | `0x9E2c6c57996f4b321d411462DF0D4d634c3C69Fc` |
| Verifier wallet | `0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3` (0 USDC; signing is free, someone else submits) |
| Amount at risk | 0.100000 USDC escrowed (returned or paid, never lost) |
| Estimated gas | approve about 56,241 (measured by `eth_estimateGas`), create at most about 270,000 (local test maximum, not measured on Arc), release about 133,600 and refund about 68,400 (both measured in the confirmed txs). At the 29 gwei max fee the RPC quoted, roughly 0.016 USDC total |

Steps in the UI (customer wallet unless stated):
1. Create: provider and verifier above, 0.10 USDC, deadline about 20 minutes ahead, a description. Click **Allow USDC** then **Create & fund**. Expected: the agreement appears as #3, Active.
2. On the agreement page the **Claim refund** button must not be offered before the deadline. (Expected: not shown; the contract would revert `RefundNotAvailable`, proven by E1 and E4.)
3. Switch to the verifier wallet, open **Verifier console** for #3, enter an evidence text, **Sign with connected wallet**, then press **Test a tampered signature**. Expected: the simulation reports `InvalidSigner` and nothing is sent. Then switch to the customer wallet, paste the verifier's signature and press **Check this signature**, then **Submit & release payment**. Expected: success, #3 Released, 0.10 USDC to the provider, `totalEscrowed` back to 0.
4. Open #3 again and try **Check this signature** once more. Expected: the page shows it is already settled, and the contract would report `AgreementNotActive`.

**T1b. Live agreement #4 refund after the deadline.** Same creation with a 5-minute deadline; do not sign. After the deadline, the customer wallet presses **Claim refund**. Expected: Refunded, 0.10 USDC back. Also from the provider wallet the refund button must not be offered.

**T2. A real reverting transaction** (unauthorized refund, costs gas for a failed tx). Not needed because E2 and E3 already prove the revert through `eth_call`; run only if you want a confirmed failing transaction as evidence.

Approve with an explicit "approved: run T1" (and optionally T1b / T2). I will not submit anything before that.

## Detailed results

**B0. Boundary rules in the source that was deployed**  
Type: ONCHAIN data · Result: **PASS**  
Expected: release allowed while now <= deadline and now <= expiry; refund only when now > deadline  
Observed: source contains release revert on now > deadline: true; refund revert on now <= deadline: true; attestation revert on now > expiry: true

**B1. Deployed runtime code is the compiled ArcSLA**  
Type: ONCHAIN data · Result: **PASS**  
Expected: same length and same leading code as contracts/out/ArcSLA.sol/ArcSLA.json (immutables differ)  
Observed: deployed 5898 bytes vs artifact 5898 bytes; first 100 bytes equal: true

**L1. Duplicate release: agreement #1 (already Released)**  
Type: LIVE eth_call · Result: **PASS**  
Expected: revert AgreementNotActive  
Observed: revert AgreementNotActive selector=0x36401891; rpc={"code":3,"message":"execution reverted","data":"0x36401891"}

**L2. Duplicate refund: agreement #2 (already Refunded), caller is its customer**  
Type: LIVE eth_call · Result: **PASS**  
Expected: revert AgreementNotActive  
Observed: revert AgreementNotActive selector=0x36401891; rpc={"code":3,"message":"execution reverted","data":"0x36401891"}

**L3. Refund after release: agreement #1, caller is its customer**  
Type: LIVE eth_call · Result: **PASS**  
Expected: revert AgreementNotActive  
Observed: revert AgreementNotActive selector=0x36401891; rpc={"data":"0x36401891","code":3,"message":"execution reverted"}

**L4. Release after refund: agreement #2**  
Type: LIVE eth_call · Result: **PASS**  
Expected: revert AgreementNotActive  
Observed: revert AgreementNotActive selector=0x36401891; rpc={"code":3,"message":"execution reverted","data":"0x36401891"}

**L5. Unauthorized refund (stranger) on settled agreement #1**  
Type: LIVE eth_call · Result: **PASS**  
Expected: revert AgreementNotActive  
Observed: revert AgreementNotActive selector=0x36401891; rpc={"code":3,"message":"execution reverted","data":"0x36401891"}

**L6. Refund of nonexistent agreement #3**  
Type: LIVE eth_call · Result: **PASS**  
Expected: revert AgreementNotFound  
Observed: revert AgreementNotFound selector=0x9cc59cb9; rpc={"code":3,"message":"execution reverted","data":"0x9cc59cb9"}

**L7. Release of agreement ID 0**  
Type: LIVE eth_call · Result: **PASS**  
Expected: revert AgreementNotFound  
Observed: revert AgreementNotFound selector=0x9cc59cb9; rpc={"code":3,"message":"execution reverted","data":"0x9cc59cb9"}

**C1. Escrow conservation on current chain state**  
Type: ONCHAIN data · Result: **PASS**  
Expected: created = released + refunded + totalEscrowed; totalEscrowed = sum of Active; contract USDC >= totalEscrowed  
Observed: block 69765441: created=2000000 released=1000000 refunded=1000000 totalEscrowed=0 sumActive=0 ERC-20 balanceOf(ArcSLA)=0 native=0; events=4

**C2. Agreement isolation on current chain state (#1 released, #2 refunded)**  
Type: ONCHAIN data · Result: **PASS**  
Expected: #1 has only Created+Released events and an evidence hash; #2 has only Created+Refunded events and none; statuses independent  
Observed: #1 status=1 evidence set=true events=[AgreementCreated@69656851, AgreementReleased@69658526]; #2 status=2 events=[AgreementCreated@69663092, AgreementRefunded@69664776]

**C3. Confirmed lifecycle transactions are final and successful**  
Type: ONCHAIN data · Result: **PASS**  
Expected: both receipts have status success  
Observed: release 0xc3f34d15b779d2c570e8f8f513593bd25eb6f1487534007eb4a5a08b98f194c3 block 69658526 status success gas 133622; refund 0x84315c8040879c04147375471694d395db007b70afeadf798fe1a9f3b2f53e9e block 69664776 status success gas 68350

**D1. Real release signature (from tx calldata) recovers to the agreement verifier under the frontend typed-data definition**  
Type: ONCHAIN data · Result: **PASS**  
Expected: recovered signer == verifier of #1; viem digest == contract fulfillmentDigest()  
Observed: recovered=0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3; verifier=0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3; local digest=0x6b7c4c2ba6053a45eda0aebc2c14092411ff43a9671b3931213d32e294c29182; onchain digest=0x6b7c4c2ba6053a45eda0aebc2c14092411ff43a9671b3931213d32e294c29182; tx=0xc3f34d15b779d2c570e8f8f513593bd25eb6f1487534007eb4a5a08b98f194c3

**D2. Real verifier signature accepted when #1 is rehydrated to Active (positive control)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: success (no revert)  
Observed: success (no revert); rpc={"result":"0x"}

**D3. Real verifier signature with one byte flipped is rejected**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert InvalidSigner  
Observed: revert InvalidSigner selector=0x815e1d64; rpc={"code":3,"message":"execution reverted","data":"0x815e1d64"}

**D4. Real signature replayed with a different evidence hash is rejected**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert InvalidSigner  
Observed: revert InvalidSigner selector=0x815e1d64; rpc={"code":3,"message":"execution reverted","data":"0x815e1d64"}

**D5. Real attestation submitted one second after the agreement deadline**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert DeadlinePassed  
Observed: revert DeadlinePassed selector=0x70f65caa; rpc={"code":3,"message":"execution reverted","data":"0x70f65caa"}

**S0. Self-test: synthetic storage layout decodes as an Active agreement**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: getAgreement(3) returns the synthetic Active agreement written via stateDiff  
Observed: {"customer":"0x00000000000000000000000000000000C0DE0001","provider":"0x00000000000000000000000000000000c0De0002","verifier":"0x10569F5Aa2Db1CBE3bfeB93a1C97e1b451f9391A","amount":"1000000","deadline":"1793329233","specHash":"0x31b9f8bebc79b974e39da2a4bf1d807a28491b9dc0ea4e372abd87b2bc53479b","status":0,"createdAt":"1793325573","evidenceHash":"0x0000000000000000000000000000000000000000000000000000000000000000"}

**E1. Early refund by the customer (now = deadline - 3590s)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert RefundNotAvailable  
Observed: revert RefundNotAvailable selector=0x0b4d6981; rpc={"code":3,"message":"execution reverted","data":"0x0b4d6981"}

**E2p. Unauthorized refund by provider, before the deadline**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert NotCustomer  
Observed: revert NotCustomer selector=0xa8df5f3e; rpc={"message":"execution reverted","data":"0xa8df5f3e","code":3}

**E3p. Unauthorized refund by provider, after the deadline (agreement #6, Active and expired)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert NotCustomer  
Observed: revert NotCustomer selector=0xa8df5f3e; rpc={"code":3,"message":"execution reverted","data":"0xa8df5f3e"}

**E2v. Unauthorized refund by verifier, before the deadline**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert NotCustomer  
Observed: revert NotCustomer selector=0xa8df5f3e; rpc={"code":3,"message":"execution reverted","data":"0xa8df5f3e"}

**E3v. Unauthorized refund by verifier, after the deadline (agreement #6, Active and expired)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert NotCustomer  
Observed: revert NotCustomer selector=0xa8df5f3e; rpc={"code":3,"message":"execution reverted","data":"0xa8df5f3e"}

**E2s. Unauthorized refund by stranger, before the deadline**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert NotCustomer  
Observed: revert NotCustomer selector=0xa8df5f3e; rpc={"code":3,"message":"execution reverted","data":"0xa8df5f3e"}

**E3s. Unauthorized refund by stranger, after the deadline (agreement #6, Active and expired)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert NotCustomer  
Observed: revert NotCustomer selector=0xa8df5f3e; rpc={"code":3,"message":"execution reverted","data":"0xa8df5f3e"}

**E4. Refund exactly AT the deadline (now == deadline)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert RefundNotAvailable  
Observed: revert RefundNotAvailable selector=0x0b4d6981; rpc={"message":"execution reverted","data":"0x0b4d6981","code":3}

**E5. Refund one second AFTER the deadline (now == deadline + 1) by the customer**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: success (no revert)  
Observed: success (no revert); rpc={"result":"0x"}

**E5b. Refund of an already-expired agreement (#6) by its customer (positive control)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: success (no revert)  
Observed: success (no revert); rpc={"result":"0x"}

**E6. Valid release by a stranger (positive control, correct verifier key)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: success (no revert)  
Observed: success (no revert); rpc={"result":"0x"}

**E7. Signature from a non-verifier key**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert InvalidSigner  
Observed: revert InvalidSigner selector=0x815e1d64; rpc={"code":3,"message":"execution reverted","data":"0x815e1d64"}

**E8. Tampered signature: every one of the 65 bytes flipped (one bit each)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: 65/65 rejected with InvalidSigner  
Observed: 65/65 rejected with InvalidSigner

**E9. Replay across agreements: signature for #3 submitted for #4 (identical terms)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert InvalidSigner  
Observed: revert InvalidSigner selector=0x815e1d64; rpc={"code":3,"message":"execution reverted","data":"0x815e1d64"}

**E10. Cross-chain replay: signature made for chain 5042 domain**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert InvalidSigner  
Observed: revert InvalidSigner selector=0x815e1d64; rpc={"code":3,"message":"execution reverted","data":"0x815e1d64"}

**E11. Cross-contract replay: signature made for a different verifyingContract**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert InvalidSigner  
Observed: revert InvalidSigner selector=0x815e1d64; rpc={"code":3,"message":"execution reverted","data":"0x815e1d64"}

**E12. Tampered fields: provider differs from the agreement**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert ProviderMismatch  
Observed: revert ProviderMismatch selector=0x7287f806; rpc={"code":3,"message":"execution reverted","data":"0x7287f806"}

**E13. Tampered fields: specification hash differs from the agreement**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert SpecHashMismatch  
Observed: revert SpecHashMismatch selector=0x89fc6c86; rpc={"code":3,"message":"execution reverted","data":"0x89fc6c86"}

**E14. Tampered fields: evidence hash differs from what was signed**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert InvalidSigner  
Observed: revert InvalidSigner selector=0x815e1d64; rpc={"code":3,"message":"execution reverted","data":"0x815e1d64"}

**E15. Tampered fields: expiry differs from what was signed**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert InvalidSigner  
Observed: revert InvalidSigner selector=0x815e1d64; rpc={"message":"execution reverted","data":"0x815e1d64","code":3}

**E16. Zero evidence hash**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert ZeroEvidenceHash  
Observed: revert ZeroEvidenceHash selector=0xcdb2e9d3; rpc={"code":3,"message":"execution reverted","data":"0xcdb2e9d3"}

**E17. Expired attestation (expiry = now - 1)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert AttestationExpired  
Observed: revert AttestationExpired selector=0x716dcc39; rpc={"code":3,"message":"execution reverted","data":"0x716dcc39"}

**E18. Attestation expiring exactly now (expiry == now) is still valid**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: success (no revert)  
Observed: success (no revert); rpc={"result":"0x"}

**E19. Settlement one second after the deadline (now == deadline + 1)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: revert DeadlinePassed  
Observed: revert DeadlinePassed selector=0x70f65caa; rpc={"data":"0x70f65caa","code":3,"message":"execution reverted"}

**E20. Settlement exactly AT the deadline (now == deadline)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: success (no revert)  
Observed: success (no revert); rpc={"result":"0x"}

**P1. Sequenced duplicates and ordering inside ONE simulated call (release x2, refund x2, release-after-refund, refund-after-release, non-customer refund, replay)**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: ok | AgreementNotActive | ok | AgreementNotActive | AgreementNotActive | ok | AgreementNotActive | NotCustomer | InvalidSigner  
Observed: ok | AgreementNotActive | ok | AgreementNotActive | AgreementNotActive | ok | AgreementNotActive | NotCustomer | InvalidSigner

**P2. Agreement isolation: settling #3, #7, #8 leaves #4, #5, #6 byte-for-byte unchanged**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: #3 Released, #7 Refunded, #8 Released; #4, #5, #6 still Active with same amount and no evidence  
Observed: before status=[0,0,0,0,0,0] after status=[1,0,0,0,2,1]; evidence #4/#5/#6 after=[0x00000000,0x00000000,0x00000000]

**P3. Escrow conservation: contract outflow equals provider + refunded-customer inflow; no third party gains**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: contract USDC -3.000000 and totalEscrowed -3.000000; provider +2.000000; refunded customer +1.000000; others +0  
Observed: contract USDC 7000000 -> 4000000 (Δ -3000000); totalEscrowed 7000000 -> 4000000; provider Δ +2000000; refunded customer Δ +1000000; control provider Δ 0; control customer Δ 0

**P4. Invariant after settlement: contract USDC >= totalEscrowed and totalEscrowed == sum of remaining Active**  
Type: OVERRIDE eth_call · Result: **PASS**  
Expected: totalEscrowed == 4.000000 (#4 1 + #5 2 + #6 1) and balance >= that  
Observed: totalEscrowed=4000000, contract USDC=4000000

**F1. Guard check passes for the real deployment (positive control)**  
Type: LOGIC (bun) · Result: **PASS**  
Expected: status ok  
Observed: {"status":"ok"}

**F2. Wrong network: RPC for a different chain (Base Sepolia 84532) while configured for 5042002**  
Type: LOGIC (bun) · Result: **PASS**  
Expected: status mismatch ("RPC reports chain 84532")  
Observed: {"status":"mismatch","detail":"The RPC reports chain 84532 but this app is configured for Arc Testnet (5042002)."}

**F3. Invalid contract address: EOA / no code (provider wallet)**  
Type: LOGIC (bun) · Result: **PASS**  
Expected: status missing  
Observed: {"status":"missing","detail":"No contract exists at 0x9E2c6c57996f4b321d411462DF0D4d634c3C69Fc on Arc Testnet."}

**F4. Invalid contract address: empty address**  
Type: LOGIC (bun) · Result: **PASS**  
Expected: status missing  
Observed: {"status":"missing","detail":"No contract exists at 0x000000000000000000000000000000000000dEaD on Arc Testnet."}

**F5. Invalid contract address: a real contract that is not ArcSLA (USDC)**  
Type: LOGIC (bun) · Result: **PASS**  
Expected: status mismatch  
Observed: {"status":"mismatch","detail":"The contract at this address does not behave like ArcSLA."}

**F6. Configured USDC differs from the one the contract settles in**  
Type: LOGIC (bun) · Result: **PASS**  
Expected: status mismatch  
Observed: {"status":"mismatch","detail":"The contract settles in 0x3600000000000000000000000000000000000000, not the expected USDC 0x0000000000000000000000000000000000001234."}

**F7. Write guard decision table (wrong network, bad contract, bad config, mainnet acknowledgement)**  
Type: LOGIC (bun) · Result: **PASS**  
Expected: blocked in 8 of 9 conditions; allowed only when everything is valid  
Observed: all conditions good (testnet): allowed; wallet on wrong network (84532): BLOCKED; contract missing: BLOCKED; contract mismatch: BLOCKED; contract unreachable: BLOCKED; still verifying: BLOCKED; invalid configuration: BLOCKED; mainnet without acknowledgement: BLOCKED; mainnet with acknowledgement: allowed

**Z1. Verifier signing needs no USDC: a wallet holding exactly 0 USDC signs the EIP-712 attestation**  
Type: OFFCHAIN signing · Result: **PASS**  
Expected: balance 0 (ERC-20 and native); signature produced and recovers to the signer; no RPC write involved  
Observed: wallet 0x5A30c8C16C381abffDAB510A68B25d78300EBe1e USDC=0 native=0; recovered=0x5A30c8C16C381abffDAB510A68B25d78300EBe1e. Real verifier 0x65760dfA797B2d75A3f6E006CB0807f93E2D0dc3 also holds USDC=0 native=0 at block 69765441 and produced the accepted signature in 0xc3f34d15b779d2c570e8f8f513593bd25eb6f1487534007eb4a5a08b98f194c3

**Z2. Submitting a transaction from the zero-balance wallet is refused for lack of gas (non-broadcast, gas-priced eth_call)**  
Type: LIVE eth_call · Result: **BLOCKED**  
Expected: node rejects: insufficient funds for gas  
Observed: revert NotCustomer selector=0xa8df5f3e; rpc={"code":3,"message":"execution reverted","data":"0xa8df5f3e"}. The Arc RPC executed the call instead of checking the sender's gas balance, so this cannot be demonstrated without broadcasting. Arithmetic: a ~133,622-gas release at the 20 gwei floor needs about 0.0027 USDC of gas, and this wallet holds 0.

**Z3. Verifier console code never reads or requires a USDC/gas balance before signing**  
Type: LOGIC (bun) · Result: **PASS**  
Expected: no balance read in src/pages/Verifier.tsx  
Observed: balance reads found: false

**U1. Rendered UI: wallet connected to a different network shows the switch banner and disabled transaction buttons**  
Type: LOGIC (bun) · Result: **NOT RUN**  
Expected: banner + disabled buttons  
Observed: Needs a browser wallet. The decision logic is covered by F7. Steps below.

**U2. Rendered UI: wrong VITE_ARCSLA_ADDRESS shows "Contract check failed" and disables every transaction**  
Type: LOGIC (bun) · Result: **NOT RUN**  
Expected: error notice + disabled buttons  
Observed: Needs editing .env and a browser. The check itself is covered by F3 to F6. Steps below.

**T1. Confirmed onchain: create a funded agreement, early-refund attempt, wrong-signer rejection, release**  
Type: ONCHAIN data · Result: **NOT RUN**  
Expected: see approval plan  
Observed: Requires broadcast transactions and testnet USDC. Awaiting your approval.

**T2. Confirmed onchain: revert of an unauthorized refund as a real (failing) transaction**  
Type: ONCHAIN data · Result: **NOT RUN**  
Expected: tx reverts NotCustomer and costs gas  
Observed: Requires a broadcast. Not needed: the same revert is proven by eth_call (E2*, E3*). Awaiting your approval if you want it.

## U2 execution log (2026-10-30): status stays NOT RUN

U2 was staged: `VITE_ARCSLA_ADDRESS` was temporarily set to `0x000000000000000000000000000000000000dEaD`, Vite was restarted, then the original `0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47` was restored and Vite restarted again (`.env` diff against the pre-test copy was empty). No transaction, signature or approval was made.

| Check | Type | Result |
| --- | --- | --- |
| Vite served the dEaD value to the app | Automated (HTTP) | Yes |
| `verifyArcSlaContract` against dEaD | Automated (shipped code, live RPC) | `missing`: "No contract exists at 0x…dEaD on Arc Testnet." |
| `computeBlockedReason` with that result | Automated (shipped code) | Blocked with the same reason; the real address returns `ok` and is not blocked |
| Source contains the text "Contract check failed" in the banner | Static | Yes (`src/components/NetworkBanner.tsx`) |
| Preview tab loaded with the dEaD address | Browser trace evidence | Yes: 18 `eth_getLogs` calls to dEaD, all empty results |
| Banner text and disabled buttons actually rendered | Browser (visual) | **Not observed.** No DOM access from the sandbox |
| Preview reconnected to the original contract and lists #1, #2, #3 | Browser | **Not observed.** The tab was still polling for the Vite restart |
| Original contract after restore: guard `ok`, `agreementCount` 3, #1 Released, #2 Refunded, #3 Refunded | Automated (live RPC) | Yes |

Not PASS: the rendered failure state and the rendered restoration were not seen. Observation: while the contract check fails, the event scanner still queries the configured address. It is read-only and harmless, but could be gated on the check.


## U2 second run: re-stage and restoration (2026-10-30)

The invalid address was set again for manual inspection, left active until the project owner asked for restoration, then restored. No transaction, signature or approval was made, no contract was modified or redeployed, and no other test status was changed.

### Automated evidence
| Check | Result |
| --- | --- |
| Vite served `0x000000000000000000000000000000000000dEaD` to the app after restart | Yes |
| `verifyArcSlaContract` against dEaD (earlier run, live RPC) | `missing`: "No contract exists at 0x…dEaD on Arc Testnet." |
| `computeBlockedReason` with that result | Blocked, same reason |
| After restore: Vite served `0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47`; `.env` address line identical to the pre-test copy; no `dEaD` left in `.env` | Yes |
| After restore, `verifyArcSlaContract` against the original (block 69806290, live RPC) | `{"status":"ok"}` |
| After restore, `computeBlockedReason` | none (writes allowed) |
| `agreementCount` | 3 |
| Agreement #1 / #2 / #3 | Released (1.000000 USDC) / Refunded (1.000000 USDC) / Refunded (0.100000 USDC) |
| `totalEscrowed` | 0 |

### Browser-side evidence from the app's own trace log (not a visual check)
- While the invalid address was active, the Preview tab sent 63 RPC calls that referenced the dEaD address (62 `eth_getLogs`, 1 `eth_call`) and none that referenced the real contract. The app was running with the invalid configuration.
- After restoration and a reload, the Preview tab sent calls referencing the real contract only (22 records, 21 `eth_getLogs`; two of them returned 4 and 2 log entries) and none referencing dEaD.

### Manual browser observations
**None were provided to Arc Studio in the conversation at the time of this entry, so none are recorded.** Not observed by Arc Studio (no DOM access): the "Contract check failed" banner text, the disabled transaction and signing controls, the absence of the banner after restoration, and the dashboard showing three agreements. These remain U2b, NOT RUN, until the project owner reports what was seen.

### Controls not checked by Arc Studio
Arc Studio did not click or inspect any control. In particular the refund controls (the **Claim refund** button on an agreement page and the **Refund** console at `/refunds`) were not checked in the browser by Arc Studio, and no refund-control check was reported. The same applies to **Allow USDC**, **Create & fund**, the verifier sign and **Submit & release payment** buttons. Unit-level coverage exists: every transaction and signing button is rendered through the shared guarded button, and `computeBlockedReason` blocks all of them (F7), but that is code-level evidence, not a rendered check.


### U2b manual observations (reported by the project owner, 2026-10-30)

Recorded exactly as reported. Arc Studio has no DOM access and did not see these screens.

Observed with `VITE_ARCSLA_ADDRESS` set to `0x000000000000000000000000000000000000dEaD`:
1. The red "Contract check failed" banner appeared.
2. The Create page showed a disabled "Transactions disabled" button and the missing-contract reason.
3. The Verifier page showed "No agreement with this ID" and did not expose signing or release controls.

Observed after restoring `0x2C4283d953C8D5141F47eA8AB74d9FB2A7831B47`:
4. The Dashboard displayed 3 agreements, 1.00 USDC released, 1.10 USDC refunded and 0.00 USDC active escrow. The error banner disappeared.

Cross-check against the chain (block 69806290): agreementCount 3; #1 Released 1.000000 USDC; #2 Refunded 1.000000 USDC and #3 Refunded 0.100000 USDC (1.100000 refunded in total); totalEscrowed 0. The dashboard figures match.

**Result: PASS for the observed scope only.** Explicitly NOT verified:
- The refund controls (the **Claim refund** button on an agreement page and the `/refunds` console) were not visually inspected.
- No disabled button was clicked, so "no wallet prompt appears" was not tested.
- Item 3 shows the Verifier page's missing-agreement state (no agreement can be loaded from an address with no contract). It does not show the guard's disabled signing and **Submit & release payment** buttons, so the guard's effect on signing controls was not visually verified. It is covered at code level by F7 and Z3 only.
- Which specific Create-page button (**Allow USDC** or **Create & fund**) showed "Transactions disabled" was not stated.
- The other pages (Refunds, Explorer, Demo, Runbook) were not inspected under the invalid address.
