#!/bin/sh
# Build the WebAssembly generator: wasm/*.c -> wasm/gen.wasm (clang + wasm-ld, no libc, about a second).
# The .wasm is committed, so the site needs no build step to run.
set -e
cd "$(dirname "$0")"
start=$(date +%s%N)
clang --target=wasm32 -O3 -nostdlib -ffreestanding -ffp-contract=off -fno-builtin-log \
  -Wall -Wno-unused-function -Wno-misleading-indentation \
  -Wl,--no-entry -Wl,--export-dynamic -Wl,--strip-all -Wl,--initial-memory=4194304 \
  -o gen.wasm rt.c dress.c wfc.c blend.c
end=$(date +%s%N)
echo "wasm/gen.wasm $(wc -c < gen.wasm) bytes, built in $(( (end - start) / 1000000 )) ms"
