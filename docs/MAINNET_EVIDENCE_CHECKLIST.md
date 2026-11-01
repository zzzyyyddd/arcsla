# Mainnet evidence checklist

> Warning: Transactions on mainnet involve real funds and, once submitted, are irreversible. Arc Studio may generate or edit code or configuration that references mainnet, but Arc Studio does not deploy to, transact on, sign for, fund, or otherwise interact with mainnet on your behalf. Any code used for mainnet must be independently reviewed, tested, validated, deployed, and operated by you outside of Arc Studio. You are solely responsible for any losses, errors, or other consequences resulting from your use of any code, configuration, or output generated or edited through Arc Studio in connection with mainnet. Before proceeding, you should first use testnet, obtain an independent professional audit, and carefully review all wallet addresses, contract addresses, chain settings, permissions, and other configuration details. Only continue to mainnet after you have completed your independent review and have determined that you want to proceed.

This is a template. Fill in every value yourself from your own verified sources. Nothing here is pre-filled, and nothing in this repository is evidence of a mainnet transaction.

## Before deploying

- [ ] Independent professional audit completed; report and commit hash recorded: ______
- [ ] `forge test` passes on the audited commit; output saved
- [ ] Mainnet chain ID verified from official Arc documentation: ______
- [ ] Mainnet RPC endpoint verified from official Arc documentation: ______
- [ ] Official native USDC contract address verified from Circle documentation: ______
- [ ] That address has code on the target chain (`cast code <addr> --rpc-url ...`)
- [ ] Token `decimals()` returns 6
- [ ] Deployer is a hardware wallet or keystore you control; no raw key in shell history
- [ ] Compiler version, EVM version and optimizer settings in `foundry.toml` match what you will verify

## Deployment evidence

- [ ] Deployment transaction hash: ______
- [ ] Contract address: ______
- [ ] Deployment block: ______
- [ ] Constructor argument equals the verified USDC address
- [ ] Source verified on the chain explorer; verified bytecode matches local `forge build`
- [ ] `usdc()` on the deployed contract returns the verified USDC address
- [ ] `eip712Domain()` returns name `ArcSLA`, version `1`, the correct chain ID and the contract address
- [ ] Frontend `.env` set from the values above, and the app header shows the intended network

## Lifecycle evidence (use small amounts)

| Scenario | Tx hash | Explorer link | Result confirmed |
| --- | --- | --- | --- |
| Create and fund agreement | | | |
| Verifier release to provider | | | |
| Second agreement, deadline passes, customer refund | | | |
| Tampered or wrong-signer release attempt rejected (simulation or failed tx) | | | |

For each: record before and after USDC balances of customer, provider and the contract, the emitted event, and the block timestamp.

## Operational

- [ ] Verifier key custody and rotation plan documented (verifiers are chosen per agreement)
- [ ] Users are told the verifier is trusted and what happens if it never signs
- [ ] Monitoring for `AgreementCreated`, `AgreementReleased`, `AgreementRefunded`
- [ ] Incident contact and communication plan (there is no pause or admin key to rely on)
