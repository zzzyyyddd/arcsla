// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ArcSLA} from "../ArcSLA.sol";
import {DeployArcSLA} from "../script/DeployArcSLA.s.sol";

/// @dev Minimal stand-ins whose metadata lives in code (not storage), so `vm.etch` preserves it.
contract ArcLikeUSDC {
    function decimals() external pure returns (uint8) {
        return 6;
    }

    function symbol() external pure returns (string memory) {
        return "USDC";
    }
}

contract WrongDecimalsUSDC {
    function decimals() external pure returns (uint8) {
        return 18;
    }

    function symbol() external pure returns (string memory) {
        return "USDC";
    }
}

contract WrongSymbolUSDC {
    function decimals() external pure returns (uint8) {
        return 6;
    }

    function symbol() external pure returns (string memory) {
        return "OTHER";
    }
}

/// @notice Exercises the deploy script's guards locally. No network, no broadcast to a real chain.
/// @dev The script reads process-wide environment variables, and Foundry runs test functions in
///      parallel, so every scenario lives in ONE test function and runs sequentially.
contract DeployArcSLAScriptTest is Test {
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;
    string internal constant CONFIRM = "DEPLOY-TO-ARC-MAINNET-5042";
    string internal constant ERR_CHAIN = "Unsupported chain: expected Arc Mainnet (5042) or Arc Testnet (5042002)";
    string internal constant ERR_MAINNET = "Mainnet requires ARCSLA_MAINNET_CONFIRM=DEPLOY-TO-ARC-MAINNET-5042";

    DeployArcSLA internal script;

    function setUp() public {
        script = new DeployArcSLA();
    }

    function _reset(address token) internal {
        vm.setEnv("USDC_ADDRESS", vm.toString(ARC_USDC));
        vm.setEnv("ARCSLA_MAINNET_CONFIRM", "unset");
        vm.etch(ARC_USDC, token.code);
    }

    function test_DeployScriptGuards() public {
        address good = address(new ArcLikeUSDC());

        // Testnet deploys without any confirmation phrase and reports a bound EIP-712 domain.
        vm.chainId(5042002);
        _reset(good);
        ArcSLA sla = script.run();
        assertEq(address(sla.usdc()), ARC_USDC, "testnet usdc");
        (,,, uint256 domainChain, address verifying,,) = sla.eip712Domain();
        assertEq(domainChain, 5042002, "testnet domain chain");
        assertEq(verifying, address(sla), "testnet verifying contract");

        // Mainnet without the confirmation phrase is refused (dry runs included).
        vm.chainId(5042);
        _reset(good);
        vm.expectRevert(bytes(ERR_MAINNET));
        script.run();

        // Mainnet with a wrong phrase is refused.
        _reset(good);
        vm.setEnv("ARCSLA_MAINNET_CONFIRM", "yes");
        vm.expectRevert(bytes(ERR_MAINNET));
        script.run();

        // Mainnet with the exact phrase succeeds against a token that looks like Arc USDC.
        _reset(good);
        vm.setEnv("ARCSLA_MAINNET_CONFIRM", CONFIRM);
        ArcSLA mainnetSla = script.run();
        (,,, uint256 mainnetDomainChain,,,) = mainnetSla.eip712Domain();
        assertEq(mainnetDomainChain, 5042, "mainnet domain chain");

        // Any other chain ID is refused.
        uint256[4] memory ids = [uint256(1), 8453, 5043, 5042003];
        for (uint256 i = 0; i < ids.length; i++) {
            vm.chainId(ids[i]);
            _reset(good);
            vm.setEnv("ARCSLA_MAINNET_CONFIRM", CONFIRM);
            vm.expectRevert(bytes(ERR_CHAIN));
            script.run();
        }

        // Wrong USDC address is refused.
        vm.chainId(5042002);
        _reset(good);
        vm.setEnv("USDC_ADDRESS", vm.toString(address(0x1234)));
        vm.expectRevert(bytes("USDC_ADDRESS is not the official Arc USDC address"));
        script.run();

        // No code at the official address is refused.
        _reset(good);
        vm.etch(ARC_USDC, bytes(""));
        vm.expectRevert(bytes("No contract code at USDC_ADDRESS on this chain"));
        script.run();

        // Wrong decimals is refused.
        _reset(address(new WrongDecimalsUSDC()));
        vm.expectRevert(bytes("USDC decimals() is not 6"));
        script.run();

        // Wrong symbol is refused.
        _reset(address(new WrongSymbolUSDC()));
        vm.expectRevert(bytes("USDC symbol() is not USDC"));
        script.run();
    }
}
