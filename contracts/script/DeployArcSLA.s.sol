// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {ArcSLA} from "../ArcSLA.sol";

/// @notice Deploys ArcSLA to Arc Testnet or Arc Mainnet, and refuses to run anywhere else.
///
/// Strict checks before anything is broadcast:
///   1. block.chainid must be Arc Mainnet (5042) or Arc Testnet (5042002).
///   2. USDC_ADDRESS must equal Arc's official USDC ERC-20 interface address, and that
///      address must have code, report 6 decimals and the symbol "USDC" on THIS chain.
///   3. On Arc Mainnet only, ARCSLA_MAINNET_CONFIRM must equal the exact phrase below. This
///      is required for the dry run too, so the dry run exercises the same path as a real run.
///
/// After deployment it asserts the deployed contract reports the expected token and an EIP-712
/// domain bound to this chain and this contract.
///
/// No private key is read here. Sign with a Foundry keystore (--account) or a hardware wallet.
/// See docs/MAINNET_DEPLOYMENT.md for the full procedure and the non-broadcast dry run.
///
/// Constants below were taken from Arc's official documentation
/// (docs.arc.io: RPC endpoints and Contract addresses). Re-verify them yourself before use.
contract DeployArcSLA is Script {
    uint256 internal constant ARC_MAINNET_CHAIN_ID = 5042;
    uint256 internal constant ARC_TESTNET_CHAIN_ID = 5042002;
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    string internal constant MAINNET_CONFIRM_PHRASE = "DEPLOY-TO-ARC-MAINNET-5042";

    function run() external returns (ArcSLA sla) {
        uint256 chainId = block.chainid;
        bool isMainnet = chainId == ARC_MAINNET_CHAIN_ID;
        require(
            isMainnet || chainId == ARC_TESTNET_CHAIN_ID,
            "Unsupported chain: expected Arc Mainnet (5042) or Arc Testnet (5042002)"
        );

        address usdc = vm.envAddress("USDC_ADDRESS");
        require(usdc == ARC_USDC, "USDC_ADDRESS is not the official Arc USDC address");
        require(usdc.code.length > 0, "No contract code at USDC_ADDRESS on this chain");
        require(IERC20Metadata(usdc).decimals() == 6, "USDC decimals() is not 6");
        require(
            keccak256(bytes(IERC20Metadata(usdc).symbol())) == keccak256(bytes("USDC")),
            "USDC symbol() is not USDC"
        );

        if (isMainnet) {
            string memory confirmation = vm.envOr("ARCSLA_MAINNET_CONFIRM", string(""));
            require(
                keccak256(bytes(confirmation)) == keccak256(bytes(MAINNET_CONFIRM_PHRASE)),
                "Mainnet requires ARCSLA_MAINNET_CONFIRM=DEPLOY-TO-ARC-MAINNET-5042"
            );
        }

        vm.startBroadcast();
        sla = new ArcSLA(IERC20(usdc));
        vm.stopBroadcast();

        require(address(sla.usdc()) == usdc, "Deployed usdc() mismatch");
        (, , , uint256 domainChainId, address verifyingContract, , ) = sla.eip712Domain();
        require(domainChainId == chainId, "EIP-712 domain chain ID mismatch");
        require(verifyingContract == address(sla), "EIP-712 verifying contract mismatch");

        console2.log("Network:", isMainnet ? "Arc Mainnet" : "Arc Testnet");
        console2.log("Chain ID:", chainId);
        console2.log("USDC token:", usdc);
        console2.log("ArcSLA (simulated address unless broadcast):", address(sla));
        console2.log("Block (use the receipt block for VITE_ARCSLA_DEPLOY_BLOCK):", block.number);
    }
}
