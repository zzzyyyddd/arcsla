#!/usr/bin/env bash
# Exports the exact transaction data for deploying the reviewed ArcSLA build with a browser wallet.
# READ-ONLY with respect to the chain: it only reads the local Foundry artifact. It signs and sends nothing.
#
#   forge build                                   # produces contracts/out/ArcSLA.sol/ArcSLA.json
#   scripts/export-deploy-package.sh [out-dir]    # default: deploy-package/mainnet
#
# Run it on YOUR machine from your own build and compare the printed checksums with the published
# CHECKSUMS.txt. Needs: jq, cast (Foundry), python3, sha256sum.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ART="contracts/out/ArcSLA.sol/ArcSLA.json"
OUT="${1:-deploy-package/mainnet}"
USDC="0x3600000000000000000000000000000000000000"   # official Arc USDC ERC-20 interface (docs.arc.io: Contract addresses)

command -v jq >/dev/null && command -v cast >/dev/null && command -v python3 >/dev/null || { echo "need jq, cast and python3" >&2; exit 1; }
[[ -f "$ART" ]] || { echo "missing $ART: run 'forge build' first" >&2; exit 1; }

# The build must have no library placeholders: nothing to link.
[[ "$(jq -c '.bytecode.linkReferences' "$ART")" == "{}" ]] || { echo "unexpected library link references in creation bytecode" >&2; exit 1; }
[[ "$(jq -c '.deployedBytecode.linkReferences' "$ART")" == "{}" ]] || { echo "unexpected library link references in runtime bytecode" >&2; exit 1; }
[[ "$(jq -r '.bytecode.object' "$ART")" != *"__"* ]] || { echo "unlinked placeholder found in bytecode" >&2; exit 1; }

mkdir -p "$OUT"
CREATION="$(jq -r '.bytecode.object' "$ART")"
RUNTIME="$(jq -r '.deployedBytecode.object' "$ART")"
ARGS="$(cast abi-encode 'constructor(address)' "$USDC")"
DATA="${CREATION}${ARGS#0x}"

# Hex files are written WITHOUT a trailing newline so their text checksum is stable.
printf '%s' "$CREATION" > "$OUT/creation-bytecode.hex"
printf '%s' "$ARGS"     > "$OUT/constructor-args.hex"
printf '%s' "$DATA"     > "$OUT/deploy-data.hex"
printf '%s' "$RUNTIME"  > "$OUT/runtime-bytecode.hex"
jq -S '{
  compiler: .metadata.compiler,
  language: .metadata.language,
  settings: (.metadata.settings | del(.compilationTarget)),
  compilationTarget: .metadata.settings.compilationTarget,
  creationLinkReferences: .bytecode.linkReferences,
  runtimeLinkReferences: .deployedBytecode.linkReferences,
  constructorAbi: [.abi[] | select(.type == "constructor")]
}' "$ART" > "$OUT/build-settings.json"
# Byte ranges only. The compiler's AST-node-id keys change with the number of files in a build, so they are dropped
# to keep this file (and its checksum) identical on every machine that produces the same bytecode.
jq -S '[.deployedBytecode.immutableReferences | to_entries[] | .value[] | {start, length}] | unique_by(.start) | sort_by(.start)' "$ART" > "$OUT/immutable-references.json"

bytes_sha256() { python3 -c 'import hashlib,sys; h=open(sys.argv[1]).read().strip(); print(hashlib.sha256(bytes.fromhex(h[2:])).hexdigest())' "$1"; }
bytes_len()    { python3 -c 'import sys; h=open(sys.argv[1]).read().strip(); print((len(h)-2)//2)' "$1"; }
text_sha256()  { sha256sum "$1" | awk '{print $1}'; }

{
  echo "# ArcSLA Arc Mainnet deployment package checksums"
  echo "# Regenerate with: scripts/export-deploy-package.sh  (after: forge build)"
  echo "constructor_argument_usdc            $USDC"
  echo "solc                                 $(jq -r '.metadata.compiler.version' "$ART")"
  echo "evm_version                          $(jq -r '.metadata.settings.evmVersion' "$ART")"
  echo "optimizer                            $(jq -c '.metadata.settings.optimizer' "$ART")"
  echo "libraries                            $(jq -c '.metadata.settings.libraries' "$ART")"
  echo "ArcSLA.sol_sha256                    $(sha256sum contracts/ArcSLA.sol | awk '{print $1}')"
  for f in creation-bytecode constructor-args deploy-data runtime-bytecode; do
    printf '%-36s bytes=%-6s sha256(bytes)=%s keccak256=%s text_sha256=%s\n' \
      "$f.hex" "$(bytes_len "$OUT/$f.hex")" "$(bytes_sha256 "$OUT/$f.hex")" "$(cast keccak "$(cat "$OUT/$f.hex")")" "$(text_sha256 "$OUT/$f.hex")"
  done
  echo "build-settings.json_sha256           $(text_sha256 "$OUT/build-settings.json")"
  echo "immutable-references.json_sha256     $(text_sha256 "$OUT/immutable-references.json")"
} > "$OUT/CHECKSUMS.txt"

cat "$OUT/CHECKSUMS.txt"
echo
echo "Wrote $OUT/. Nothing was signed or sent."
