# Evo X source kernel

Initial offline core for a source-built RAM agent. Original source is licensed
under the repository's GPL-3.0 license. No recovered stock routines or private ROM
bytes are included here. The captured bootstrap remains in the MUT3 package.

This is **not an uploadable kernel**. Its assembly entry loops at a synthetic
address; it does not initialize stack, BSS, CAN, watchdogs or flash hardware.
The existing application continues to require the external V1.09 kernel.

## Commands

From the repository root, run the host contracts (requires Python 3 and a host C
compiler supporting AddressSanitizer and UndefinedBehaviorSanitizer):

```sh
npm run firmware:evox:test
```

Build with the existing ordinary M32R cross-compiler, or another explicitly
selected installation. Set a configurable bin directory; no sibling checkout
path is built into the scripts:

```sh
export M32R_TOOLCHAIN_BIN=/path/to/m32r-toolchain/bin
npm run firmware:evox:build -- --out /tmp/evox-core-new-build
```

The output directory must be new. The local toolchain used during development
is the adjacent firmware project's `evo-x-firmware-private/P04/install/bin`:
GCC 11.5.0 and Binutils 2.44. Its source-pinned build recipe is described in the
[source-kernel investigation](../../specs/EVO_X_SOURCE_KERNEL.md). No source from
that project's implementation was copied; only its installed tools are reused.
Toolchain acquisition and CI provisioning remain follow-up work.

## Implemented contracts

- Reflected IEEE CRC32 with initial/final inversion and polynomial `edb88320`.
- Pure parsing of the existing seven-byte command `03`: four-byte big-endian ROM
  address and two-byte length. Only 1–1024 bytes wholly inside 1 MiB are admitted.
  Failed parsing preserves the output region; it never reads ECU memory.
- Every other command, including erase/program commands, is rejected.

These functions do not implement authentication, command dispatch, transport or
ROM access. Successful parsing is not authorization to perform a read.

The host harness checks the standard `123456789` CRC vector, empty CRC,
truncation, oversized/zero requests, null parser inputs, all command bytes,
end-of-ROM and wraparound addresses, and preservation on rejection.

The target builder compiles and links twice, verifies ELF32 big-endian M32R
identity, rejects unresolved symbols and orphan sections, and enforces code and
static stack budgets. Data/BSS must be empty for this offline core. It records
source/tool hashes, commands, disassembly, section maps and a repeat-build
manifest with `uploadable: false`. A 5,117-byte code limit is an early size
constraint, not proof of a compatible captured-loader image.

## Current evidence and next step

On 2026-10-31 the host sanitizer harness passed. Two M32R links produced identical
184-byte images, with no undefined symbols and zero compiler-reported stack
bytes for each current leaf. Image SHA-256:
`3bb1f58c1497ea4b58cd3ef2295669274a775b59b7562f46b96cf46b3f2b4b64`.

[GNU M32R simulator execution](simulator/README.md) now passes 578 returning
calls plus unmapped-memory fault and step-limit controls. Results, output writes,
callee-preserved registers and all mapped memory are checked against independent
contracts; see the [receipt](simulator/validation.json).

The next unit is an audited startup/RAM layout and peripheral investigation for
a read-only agent. The current synthetic entry remains non-uploadable. No ECU
operations have been performed.
