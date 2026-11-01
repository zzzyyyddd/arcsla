#!/usr/bin/env bash
# ArcSLA deployment helper for Arc Mainnet (chain 5042). Run it on YOUR machine (Ubuntu WSL),
# never from Arc Studio. It reads no private key and never prints one.
#
# Usage (from anywhere; it changes to the project root itself):
#   scripts/mainnet-deploy.sh dry       <deployer-address>
#   scripts/mainnet-deploy.sh broadcast <deployer-address> <ledger|trezor|interactive|keystore:NAME>
#
#   dry        read-only checks + a non-broadcast simulation. Sends nothing, signs nothing.
#   broadcast  the same checks, then asks you to type a confirmation, then signs and sends ONE
#              contract-creation transaction with the signer you choose.
#
# Optional: HD_PATH="m/44'/60'/0'/0/1" to select a different hardware-wallet account.
set -euo pipefail

RPC="https://rpc.mainnet.arc.io"
EXPECT_CHAIN=5042
USDC="0x3600000000000000000000000000000000000000"
# Reference values recorded in Arc Studio for the reviewed build (see docs/MAINNET_WSL_DEPLOYMENT.md).
SRC_SHA256="3002abab63b21a7bc525d4953d4b13c83612f3d8c300525737c98e56f11f8730"
SCRIPT_SHA256="70d981528818d2878271228aa57ca7b9cf04de321425188337468dfe9cb12162"
CREATION_KECCAK="0xc02649f4e600b82612f426abc84f9185ef3d63c309d4cebbc76b13875ebdac09"
CREATION_STRIPPED_KECCAK="0x36357998509624b5f44dd2336e737e8d9561b77c3a43f307e68dcefb88c68ee3"
CONFIRM_PHRASE="DEPLOY-TO-ARC-MAINNET-5042"
TYPED_CONFIRMATION="DEPLOY-5042"
MIN_WEI="100000000000000000"        # 0.10 USDC (native view has 18 decimals)
WARN_WEI="150000000000000000"       # 0.15 USDC (deploy margin + customer funds)
MAX_GAS_PRICE_WEI="100000000000"    # 100 gwei: refuse to deploy if the network is this expensive

say()  { printf '\n==> %s\n' "$*"; }
ok()   { printf '    OK    %s\n' "$*"; }
warn() { printf '    WARN  %s\n' "$*"; }
fail() { printf '\n    FAIL  %s\n\n' "$*" >&2; exit 1; }
ge()   { python3 -c "import sys; sys.exit(0 if int(sys.argv[1]) >= int(sys.argv[2]) else 1)" "$1" "$2"; }

MODE="${1:-}"; DEPLOYER="${2:-}"; SIGNER="${3:-}"
[[ "$MODE" == "dry" || "$MODE" == "broadcast" ]] || fail "first argument must be 'dry' or 'broadcast'"
[[ "$DEPLOYER" =~ ^0x[0-9a-fA-F]{40}$ ]] || fail "second argument must be your deployer PUBLIC address (0x + 40 hex characters)"
if [[ "$MODE" == "broadcast" ]]; then
  case "$SIGNER" in
    ledger|trezor|interactive|keystore:?*) ;;
    *) fail "broadcast needs a signer: ledger | trezor | interactive | keystore:<name>" ;;
  esac
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."
[[ -f foundry.toml && -f contracts/ArcSLA.sol && -f contracts/script/DeployArcSLA.s.sol ]] \
  || fail "not an ArcSLA project root (foundry.toml / contracts/ArcSLA.sol / DeployArcSLA.s.sol missing)"
say "Project root: $(pwd)"
unset ETH_RPC_URL FOUNDRY_ETH_RPC_URL || true

say "1. Tools"
for tool in forge cast jq sha256sum python3; do command -v "$tool" >/dev/null || fail "$tool is not installed"; done
ok "$(forge --version | head -n1)"
[[ "$(cat .foundry-version 2>/dev/null || true)" == "v1.7.1" ]] && ! forge --version | grep -q "1.7.1" \
  && warn "reviewed with Foundry v1.7.1; yours differs. The bytecode check below decides whether that matters."

say "2. Source integrity (ArcSLA.sol must be exactly the reviewed file)"
[[ "$(sha256sum contracts/ArcSLA.sol | cut -d' ' -f1)" == "$SRC_SHA256" ]] || fail "contracts/ArcSLA.sol differs from the reviewed version"
ok "ArcSLA.sol sha256 matches"
[[ "$(sha256sum contracts/script/DeployArcSLA.s.sol | cut -d' ' -f1)" == "$SCRIPT_SHA256" ]] || fail "DeployArcSLA.s.sol differs from the reviewed version"
ok "DeployArcSLA.s.sol sha256 matches"

say "3. Network (read-only)"
CHAIN="$(cast chain-id --rpc-url "$RPC")"
[[ "$CHAIN" == "$EXPECT_CHAIN" ]] || fail "RPC reports chain $CHAIN, expected $EXPECT_CHAIN"
ok "chain ID $CHAIN at $RPC (block $(cast block-number --rpc-url "$RPC"))"

say "4. Official USDC ($USDC)"
[[ "$(cast code "$USDC" --rpc-url "$RPC")" != "0x" ]] || fail "no contract code at the USDC address"
DEC="$(cast call "$USDC" 'decimals()(uint8)' --rpc-url "$RPC")"; SYM="$(cast call "$USDC" 'symbol()(string)' --rpc-url "$RPC" | tr -d '"')"
[[ "$DEC" == "6" && "$SYM" == "USDC" ]] || fail "USDC reports decimals=$DEC symbol=$SYM"
ok "code present, decimals 6, symbol USDC. Compare this address with docs.arc.io (Contract addresses) yourself."

say "5. Build and bytecode check"
forge build >/dev/null
HEX="$(jq -r '.bytecode.object' contracts/out/ArcSLA.sol/ArcSLA.json)"
if [[ "$(cast keccak "$HEX")" == "$CREATION_KECCAK" ]]; then
  ok "creation bytecode is byte-for-byte the reviewed build"
else
  N=$((16#${HEX: -4})); STRIPPED="${HEX:0:${#HEX}-4-2*N}"
  if [[ "$(cast keccak "$STRIPPED")" == "$CREATION_STRIPPED_KECCAK" ]]; then
    warn "only the trailing compiler metadata differs; executable code is identical to the reviewed build"
  else
    fail "compiled bytecode differs from the reviewed build. Do NOT deploy. Check solc 0.8.28, evm cancun, optimizer 200 and OpenZeppelin 5.6.1."
  fi
fi
CTOR_ARG="$(cast abi-encode 'constructor(address)' "$USDC")"
EXPECTED_INPUT="$(printf '%s%s' "$HEX" "${CTOR_ARG#0x}" | tr 'A-F' 'a-f')"
ok "constructor argument = USDC $USDC"

say "6. Deployer $DEPLOYER (read-only)"
NONCE="$(cast nonce "$DEPLOYER" --rpc-url "$RPC")"; BAL="$(cast balance "$DEPLOYER" --rpc-url "$RPC")"
GAS_PRICE="$(cast gas-price --rpc-url "$RPC")"
EXPECTED_ADDR="$(cast compute-address "$DEPLOYER" --nonce "$NONCE" | awk '{print $NF}')"
ok "nonce $NONCE; balance $(cast from-wei "$BAL") USDC; gas price $(cast from-wei "$GAS_PRICE" gwei) gwei"
ge "$BAL" "$MIN_WEI" || fail "deployer holds less than 0.10 USDC"
ge "$BAL" "$WARN_WEI" || warn "deployer holds less than 0.15 USDC; the deployment plus the 0.01 USDC agreement leaves little margin"
ge "$MAX_GAS_PRICE_WEI" "$GAS_PRICE" || fail "gas price above 100 gwei; wait and retry"
ok "the contract will be created at $EXPECTED_ADDR if this wallet sends nothing else first"

say "7. Non-broadcast simulation (nothing is sent or signed)"
export USDC_ADDRESS="$USDC" ARCSLA_MAINNET_CONFIRM="$CONFIRM_PHRASE"
forge script contracts/script/DeployArcSLA.s.sol:DeployArcSLA --rpc-url "$RPC" --sender "$DEPLOYER"

if [[ "$MODE" == "dry" ]]; then
  say "DRY RUN COMPLETE. Nothing was signed or sent."
  exit 0
fi

say "8. Final review before signing"
cat <<EOF
    Network ........ Arc Mainnet, chain $CHAIN
    From ........... $DEPLOYER (nonce $NONCE)
    To ............. (none: contract creation)
    Value .......... 0
    Constructor .... ArcSLA(IERC20 usdc_) with usdc_ = $USDC
    Calldata ....... ArcSLA creation bytecode + 32-byte argument (ends ...3600000000000000000000000000000000000000)
    Expected address $EXPECTED_ADDR
    Signer ......... $SIGNER
    This transaction CANNOT be undone and the contract is immutable (no owner, no pause, no upgrade).
EOF
read -r -p "Type exactly $TYPED_CONFIRMATION to sign and broadcast, anything else aborts: " ANSWER
[[ "$ANSWER" == "$TYPED_CONFIRMATION" ]] || fail "aborted by you. Nothing was sent."

SIGN_ARGS=(--sender "$DEPLOYER")
case "$SIGNER" in
  ledger) SIGN_ARGS+=(--ledger) ;;
  trezor) SIGN_ARGS+=(--trezor) ;;
  interactive) SIGN_ARGS+=(--interactive) ;;
  keystore:*) SIGN_ARGS+=(--account "${SIGNER#keystore:}") ;;
esac
[[ -n "${HD_PATH:-}" ]] && SIGN_ARGS+=(--mnemonic-derivation-path "$HD_PATH")

say "9. Signing and broadcasting (confirm on your device or at the prompt)"
forge script contracts/script/DeployArcSLA.s.sol:DeployArcSLA --rpc-url "$RPC" "${SIGN_ARGS[@]}" --broadcast

say "10. Post-deployment verification (read-only)"
RUN="broadcast/DeployArcSLA.s.sol/$CHAIN/run-latest.json"
[[ -f "$RUN" ]] || fail "$RUN not found; read the transaction from your wallet history instead"
TX="$(jq -r '.transactions[0].hash' "$RUN")"; ADDR="$(jq -r '.transactions[0].contractAddress' "$RUN")"
RCPT="$(cast receipt "$TX" --rpc-url "$RPC" --json)"
STATUS="$(jq -r '.status' <<<"$RCPT")"; BLK="$(cast to-dec "$(jq -r '.blockNumber' <<<"$RCPT")")"; GAS="$(cast to-dec "$(jq -r '.gasUsed' <<<"$RCPT")")"
[[ "$STATUS" == "0x1" || "$STATUS" == "1" ]] || fail "transaction $TX did not succeed (status $STATUS)"
[[ "$(tr 'A-F' 'a-f' <<<"$ADDR")" == "$(tr 'A-F' 'a-f' <<<"$EXPECTED_ADDR")" ]] || warn "address differs from the one predicted before signing ($EXPECTED_ADDR)"
[[ "$(cast tx "$TX" input --rpc-url "$RPC" | tr 'A-F' 'a-f')" == "$EXPECTED_INPUT" ]] || fail "onchain creation input differs from the reviewed bytecode + USDC argument"
ok "creation input equals the reviewed bytecode + USDC constructor argument"
[[ "$(cast call "$ADDR" 'usdc()(address)' --rpc-url "$RPC" | tr 'A-F' 'a-f')" == "$USDC" ]] || fail "usdc() is not the official USDC"
ok "usdc() = $USDC"
cast call "$ADDR" 'eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])' --rpc-url "$RPC"
ok "agreementCount = $(cast call "$ADDR" 'agreementCount()(uint256)' --rpc-url "$RPC"), totalEscrowed = $(cast call "$ADDR" 'totalEscrowed()(uint256)' --rpc-url "$RPC")"

say "RECORD THESE (public data) in docs/MAINNET_DEPLOYMENT_RECORD.md"
cat <<EOF
    ArcSLA address ........ $ADDR
    Deployment tx hash .... $TX
    Block ................. $BLK
    Gas used .............. $GAS
    Explorer .............. https://explorer.arc.io/tx/$TX
    Deployer .............. $DEPLOYER
EOF
