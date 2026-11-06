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

The [startup/CAN audit](platform/STARTUP_CAN.md) now records the inherited
stack, copied factory helper and RAM ownership requirements. Original bounded
CAN0 mailbox functions are also included: callback-based frame queueing and
race-checked reception, with host register-access transcript tests. There is
no live MMIO backend or controller setup yet.

The CRC/parser functions do not implement authentication, command dispatch, transport or
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

The [ISO-TP layer](platform/ISOTP.md) now adds bounded framing/reassembly,
flow control, sequence checks and timeouts over the CAN frame API. Host tests
cover all 1–1,032-byte PDU lengths and a frozen captured version exchange.

Two ordinary M32R links produce identical 2,404-byte images with no undefined
symbols or initialized data/BSS. CRC/parser and CAN evidence is retained in the
expanded image. Target stack reports remain bounded; callback/caller obligations
are separate from per-function reports.

[GNU M32R simulator execution](simulator/README.md) includes the prior 582 cases
and three compiled ISO-TP probes. Its [receipt](simulator/validation.json) records
source/tool/image hashes and the finite execution boundary. ISO-TP context and
a bounded stack window are mutable, with code and surrounding guards checked.

The source startup establishes stack/BSS and calls C under a synthetic profile;
its test main is excluded from the ordinary build. The next unit is to close
the real startup profile, helper adapter and RAM
ownership requirements, then connect the dispatcher and a live backend for a read-only agent. The current synthetic entry remains non-uploadable. No ECU
operations have been performed.
