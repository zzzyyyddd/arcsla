#!/usr/bin/env bash
# ArcSLA post-deployment verification. READ-ONLY: it only queries an RPC; it never signs or sends.
#
# Use it on YOUR machine after the wallet shows a transaction hash, and BEFORE you approve USDC to
# the new contract or create any agreement. Compares the chain against the reviewed package.
#
#   scripts/verify-deploy.sh --tx 0xTXHASH                      # Arc Mainnet (default RPC, chain 5042)
#   scripts/verify-deploy.sh --address 0xCONTRACT               # code and state only
#   scripts/verify-deploy.sh --address 0x... --rpc URL --chain 5042002   # e.g. the Arc Testnet deployment
#
# Needs: cast (Foundry), jq, python3. Package defaults to deploy-package/mainnet.
set -uo pipefail

RPC="https://rpc.mainnet.arc.io"
CHAIN=5042
TX=""
ADDR=""
PKG=""
USDC="0x3600000000000000000000000000000000000000"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rpc) RPC="$2"; shift 2 ;;
    --chain) CHAIN="$2"; shift 2 ;;
    --tx) TX="$2"; shift 2 ;;
    --address) ADDR="$2"; shift 2 ;;
    --package) PKG="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
[[ -n "$TX" || -n "$ADDR" ]] || { echo "give --tx <hash> or --address <contract>" >&2; exit 2; }
cd "$(dirname "${BASH_SOURCE[0]}")/.."
PKG="${PKG:-deploy-package/mainnet}"
for f in deploy-data.hex runtime-bytecode.hex immutable-references.json; do
  [[ -f "$PKG/$f" ]] || { echo "missing $PKG/$f (run scripts/export-deploy-package.sh)" >&2; exit 2; }
done
unset ETH_RPC_URL

FAILS=0
ok()   { echo "    OK    $*"; }
bad()  { echo "    FAIL  $*"; FAILS=$((FAILS + 1)); }
info() { echo "          $*"; }
lc()   { tr '[:upper:]' '[:lower:]' <<<"$1"; }

echo "==> RPC and chain"
GOT_CHAIN="$(cast chain-id --rpc-url "$RPC" 2>/dev/null || true)"
[[ "$GOT_CHAIN" == "$CHAIN" ]] && ok "RPC $RPC reports chain ID $GOT_CHAIN" || { bad "RPC reports '$GOT_CHAIN', expected $CHAIN"; echo "Stopping."; exit 1; }

if [[ -n "$TX" ]]; then
  echo "==> Deployment transaction $TX"
  TXJSON="$(cast tx "$TX" --json --rpc-url "$RPC" 2>/dev/null || true)"
  RCJSON="$(cast receipt "$TX" --json --rpc-url "$RPC" 2>/dev/null || true)"
  [[ -n "$TXJSON" && -n "$RCJSON" ]] || { bad "transaction or receipt not found yet (still pending?). Wait and rerun."; exit 1; }
  FROM="$(jq -r '.from' <<<"$TXJSON")"; TO="$(jq -r '.to // "null"' <<<"$TXJSON")"
  VALUE="$(jq -r '.value // "0x0"' <<<"$TXJSON")"; INPUT="$(jq -r '.input' <<<"$TXJSON")"
  NONCE_RAW="$(jq -r '.nonce' <<<"$TXJSON")"; STATUS="$(jq -r '.status' <<<"$RCJSON")"
  RC_ADDR="$(jq -r '.contractAddress // "null"' <<<"$RCJSON")"
  BLOCK="$(jq -r '.blockNumber' <<<"$RCJSON")"; GASUSED="$(jq -r '.gasUsed' <<<"$RCJSON")"
  info "from $FROM  nonce $NONCE_RAW  block $BLOCK  gasUsed $GASUSED"
  [[ "$STATUS" == "0x1" || "$STATUS" == "1" ]] && ok "receipt status success" || bad "receipt status is $STATUS"
  [[ "$TO" == "null" ]] && ok "direct contract creation (no 'to' address)" || bad "transaction has a 'to' address ($TO): not a direct contract creation"
  [[ "$(python3 -c "print(int('$VALUE',0))")" == "0" ]] && ok "no native value sent" || bad "value is $VALUE"
  EXPECT="$(lc "$(tr -d '[:space:]' <"$PKG/deploy-data.hex")")"
  GOT="$(lc "$INPUT")"
  if [[ "$GOT" == "$EXPECT" ]]; then
    ok "transaction input is byte-for-byte the reviewed deploy-data ($(( (${#GOT} - 2) / 2 )) bytes, keccak256 $(cast keccak "$GOT"))"
  else
    bad "transaction input DIFFERS from the reviewed deploy-data (got $(( (${#GOT} - 2) / 2 )) bytes, expected $(( (${#EXPECT} - 2) / 2 )) bytes)"
  fi
  if [[ "$RC_ADDR" != "null" ]]; then
    NONCE_DEC="$(python3 -c "print(int('$NONCE_RAW',0))")"
    COMPUTED="$(cast compute-address "$FROM" --nonce "$NONCE_DEC" | awk '{print $NF}')"
    [[ "$(lc "$COMPUTED")" == "$(lc "$RC_ADDR")" ]] && ok "contract address $RC_ADDR = address derived from sender and nonce" || bad "receipt address $RC_ADDR differs from derived $COMPUTED"
    ADDR="$RC_ADDR"
  else
    bad "receipt has no contractAddress"
  fi
fi

[[ -n "$ADDR" ]] || { echo "No contract address to inspect."; exit 1; }

echo "==> Runtime code at $ADDR"
CODE="$(cast code "$ADDR" --rpc-url "$RPC")"
if [[ "$CODE" == "0x" ]]; then bad "no code at $ADDR"; echo "Stopping."; exit 1; fi
PYOUT="$(python3 - "$CODE" "$PKG" "$USDC" <<'PY'
import json, sys
code, pkg, usdc = sys.argv[1].lower(), sys.argv[2], sys.argv[3].lower()
ref = open(pkg + "/runtime-bytecode.hex").read().strip().lower()
refs = json.load(open(pkg + "/immutable-references.json"))
ranges = sorted({(r["start"], r["length"]) for r in refs})
if len(code) != len(ref):
    print(f"LEN onchain={(len(code)-2)//2} reviewed={(len(ref)-2)//2}"); sys.exit(0)
masked = bytearray(bytes.fromhex(code[2:]))
vals = []
for start, length in ranges:
    vals.append(bytes(masked[start:start + length]).hex())
    masked[start:start + length] = b"\x00" * length
same = bytes(masked).hex() == ref[2:]
want = usdc[2:].rjust(64, "0")
print(("SAME" if same else "DIFF"), len(ranges), "ranges", "USDC_IMMUTABLE_PRESENT" if want in vals else "USDC_IMMUTABLE_MISSING", (len(code)-2)//2)
PY
)"
case "$PYOUT" in
  LEN*) bad "runtime code length differs ($PYOUT)" ;;
  SAME*) ok "runtime code equals the reviewed runtime bytecode with its immutable slots masked ($PYOUT)" ;;
  *) bad "runtime code differs from the reviewed runtime bytecode ($PYOUT)" ;;
esac
[[ "$PYOUT" == *USDC_IMMUTABLE_PRESENT* ]] && ok "an immutable slot holds the official USDC address" || bad "no immutable slot holds the official USDC address"

echo "==> Contract state"
TOKEN="$(cast call "$ADDR" 'usdc()(address)' --rpc-url "$RPC" 2>/dev/null || true)"
[[ "$(lc "$TOKEN")" == "$(lc "$USDC")" ]] && ok "usdc() = $TOKEN" || bad "usdc() is '$TOKEN', expected $USDC"
DOM="$(cast call "$ADDR" 'eip712Domain()(bytes1,string,string,uint256,address,bytes32,uint256[])' --rpc-url "$RPC" 2>/dev/null || true)"
D_NAME="$(sed -n 2p <<<"$DOM" | tr -d '"')"; D_VER="$(sed -n 3p <<<"$DOM" | tr -d '"')"
D_CHAIN="$(sed -n 4p <<<"$DOM" | awk '{print $1}')"; D_VC="$(sed -n 5p <<<"$DOM")"
[[ "$D_NAME" == "ArcSLA" && "$D_VER" == "1" ]] && ok "EIP-712 domain name ArcSLA, version 1" || bad "EIP-712 name/version is '$D_NAME'/'$D_VER'"
[[ "$D_CHAIN" == "$CHAIN" ]] && ok "EIP-712 domain chainId $D_CHAIN" || bad "EIP-712 chainId is '$D_CHAIN', expected $CHAIN"
[[ "$(lc "$D_VC")" == "$(lc "$ADDR")" ]] && ok "EIP-712 verifyingContract = $D_VC (this contract)" || bad "EIP-712 verifyingContract is '$D_VC', expected $ADDR"
COUNT="$(cast call "$ADDR" 'agreementCount()(uint256)' --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')"
ESC="$(cast call "$ADDR" 'totalEscrowed()(uint256)' --rpc-url "$RPC" 2>/dev/null | awk '{print $1}')"
info "agreementCount $COUNT, totalEscrowed $ESC (a brand-new deployment should show 0 and 0)"

echo
if [[ "$FAILS" -eq 0 ]]; then
  echo "RESULT: ALL CHECKS PASSED for $ADDR on chain $CHAIN. Read-only; nothing was signed or sent."
else
  echo "RESULT: $FAILS CHECK(S) FAILED. Do NOT approve USDC to or fund this contract."
  exit 1
fi
