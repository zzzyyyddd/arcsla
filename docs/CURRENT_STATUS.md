# ArcSLA — Current Project Status

**Status as of 17 November 2026:** Arc Mainnet MVP with publicly documented USDC release and refund. **Not audited; not certified production-ready.**

## Verified public evidence

- [Public application](https://arc-studio-03513f4fbb9b478ebcce4c02.vercel.app/)
- [Mainnet Guided Demo](https://arc-studio-03513f4fbb9b478ebcce4c02.vercel.app/demo?network=mainnet)
- [Verified contract](https://explorer.arc.io/address/0x5F040Bc617666359C543bfFbE25DD00c4FfCbdAC?tab=contract), Arc Mainnet chain ID 5042, deployment block 28741163
- USDC ERC-20 interface used by the contract: `0x3600000000000000000000000000000000000000`
- Agreement #1: [0.01 USDC released](https://explorer.arc.io/tx/0x5aee3380c1c68652e7eca03a7b16bda20617976f90d6d99aa0bed46232f5ad5d)
- Agreement #2: [0.01 USDC refunded](https://explorer.arc.io/tx/0x6abb3325713d120d1ad1a3949be3ba8df9a26c75b03a957735d2ef5f1245afb6)
- [Solidity source](../contracts/ArcSLA.sol) and [technical Judge Guide](JUDGE_GUIDE.md)

## Working implementation

ArcSLA allows a customer to create and fund an agreement using USDC; a designated verifier authorizes settlement with an EIP-712 signature; the contract transfers escrowed USDC to the provider upon valid release or returns USDC to the customer after the deadline through refund. The contract uses OpenZeppelin SafeERC20, checks exact token receipt, and uses a reentrancy guard. The public app provides wallet interaction and a read-only guided evidence journey.

**Evidence boundary:** a verifier signature proves that the designated verifier authorized release, **not** independent delivery of an offchain service. Guided Demo signature rejection uses a read-only state-override simulation, not a failed mainnet transaction.

## Limits and maturity

- No independent professional smart contract audit; automated tests and source verification are not an audit.
- No verified external customer adoption or commercial pilot is claimed.
- Mainnet app amount/deadline caps are frontend-only; the contract does not enforce those caps.
- Issuer-level USDC restrictions can block transfers. See [security model](SECURITY.md).
- Wallet connectivity in the MVP does **not** establish that Circle Wallets, Circle App Kit, or CCTP are live integrations. Package dependencies alone are not proof of use.
- Historical preparation files may say no mainnet deployment existed. They describe the state when written and are superseded by the above transaction evidence, not silently rewritten.

## Planned, not shipped

Circle Wallets integration (subject to feasibility and supported network/API checks), a developer-facing TypeScript SDK/API, improved monitoring, independent security review, and an external pilot. See [Circle Grants proposal notes](CIRCLE_GRANTS.md).
