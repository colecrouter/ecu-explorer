# Compiled M32R execution

This harness freshly builds the offline core, resolves function addresses from
that ELF, and executes its code using the existing GNU GDB 16.3 M32R simulator.
The C driver is original code using GNU's public libsim API. It follows the
adjacent firmware project's demonstrated setup; no recovered routines or its
runner implementation were copied. GNU implementation sources/notices stay in
the externally supplied GDB source/build directories.

## Reproduce

Install build prerequisites first: Python 3.12+, a C/C++ compiler, GNU make,
texinfo, GMP/MPFR development headers, zlib and zstd development libraries.
On Ubuntu these are `build-essential texinfo libgmp-dev libmpfr-dev zlib1g-dev
libzstd-dev`; on macOS use Xcode command-line tools and the corresponding
Homebrew packages. A separate bare-metal `m32r-elf` GCC/binutils toolchain is
required to compile firmware; this setup builds the CPU simulator only.

```sh
npm run firmware:evox:simulator:setup
# m32r-elf-gcc on PATH, or set M32R_TOOLCHAIN_BIN to its bin directory:
npm run firmware:evox:simulate -- --operating
```

Setup downloads GNU GDB 16.3 from GNU's HTTPS release server, verifies the
archive SHA-256 in `engine-lock.json`, extracts with Python's data filter and
builds `all-sim` without global installation. A generated-Makefile portability
fix adds a sed command terminator on macOS; no ISA source is patched. All
sources, logs, binaries and the local `installation.json` live in the ignored
`.cache/evox-simulator/` directory. `--jobs` controls build parallelism; `--work`
selects an alternate setup directory (supply its paths explicitly to the runner).

Before sealing installation, setup compiles the actual public-API harness and
executes a synthetic M32R return instruction. Subsequent setup invocations verify
the complete cached header/library inventory without rebuilding. Delete or move
the generated cache to request a clean build. Build failure leaves logs and no
completed installation manifest.

The runner discovers the default local installation and checks its locally
recorded artifact hashes, while upstream header and archive identities remain
fixed. Different hosts need not produce identical static libraries. Execution
receipts still pin every consumed local artifact. This is integrity/provenance
tracking, not release-signature verification or a claim of reproducible binary
hashes across different host compilers. The local manifest is trusted build
metadata, not an independently authenticated binary distribution.

An output directory is generated automatically unless `--out` is supplied;
an explicit output must be new. `--library-dir` supplies an optional host library
search directory (macOS Homebrew commonly needs `/opt/homebrew/lib`). `CC` or
`--host-cc` selects the harness compiler.

Existing externally provisioned builds remain supported by passing both
`--gdb-source` and `--gdb-build`; this explicit legacy mode retains the reviewed
host-specific hashes in `engine-lock.json`. It never silently substitutes an
engine. No adjacent checkout is required for the default installation path.

GNU GDB/simulator code retains its upstream GPL notices and source/license files
in the cache. This repository distributes original setup/harness code and source
URLs/hashes, not GNU binaries. CI uploads build logs/metadata only, and builds
from source on Linux before executing the API smoke and firmware host contracts.
Full compiled firmware cases require the separate M32R toolchain and run locally.

## Execution and acceptance

Each case deletes default simulator memory and maps only:

- Exact linked code bytes at `0x1000`.
- 4096 bytes of sentinel-filled data at `0x20000` (odd input pointer).
- 1024 bytes of sentinel-filled stack at `0x30000`, with aligned SP `0x30400` (startup cases deliberately begin at `0x30300`).

Arguments use GNU's r0–r3 ABI. LR points to an unmapped return sentinel `0x8000`;
execution stops before fetching it. The driver checks single-step stop reasons,
code-range escape, and a finite 200,000-resumption budget. Step counts are
simulator single-step resumptions, not measured silicon cycles or necessarily
one count per paired instruction.

The corpus contains 578 returning calls: CRC vectors (including every one-byte
value and 1024-byte buffers), all command bytes, region/length boundaries,
truncation, null arguments and unmapped pointers with invalid lengths. Python's
`binascii.crc32` and arithmetic/wire contracts supply expected results rather
than running the same C as an oracle.

For every returning call, checks cover the return value/PC, established input
registers, callee-preserved r8–r15, every mapped code/data/stack byte, and no
unexpected output writes. Special registers are snapshotted without claiming
full interrupt/FPU state equivalence. Current leaf routines use no stack;
these tests require it to remain unchanged.

Two engine controls must stop as expected: an unmapped memory read
faults, and the offline infinite-loop entry exhausts its eight-step budget.
Two additional startup cases execute `kernel/startup.S` with dirty BSS and an
incorrect incoming SP. The simulation-only C entry checks BSS then writes a
marker; the checker requires the new SP, exact cleared region/marker and park PC.
The startup cases exhaust a finite step budget while parked. Startup is an entry
boundary, so it does not promise to preserve incoming LR/SP as a C leaf would.
The production mailbox primitives are linked but not target-executed by this
corpus. The synthetic startup test main is excluded from the ordinary core build.

Checker failure-injection tests reject changed results, registers, code, data,
stack, entry seeds, return addresses, fault status and excessive counts. These
run in normal CI via `npm run firmware:evox:test`; native simulator execution
requires the external pinned tools and is an explicit separate command.

Outputs include both fresh target builds, resolved symbols, runner, input
packet, complete before/after memory and register snapshots, command transcripts,
and `validation.json`. Source, engine, host compiler, target tools, executable,
packet and snapshot hashes are checked and retained. The receipt in
[validation.json](validation.json) summarizes the accepted local run without
including private paths or derived ROM contents.

## ISO-TP probes (2026-11-05)

Three additional simulation-only probes execute the compiled ISO-TP module:
public captured-version TX, maximum-size RX with sequence wrap, and block-size-one
TX with 100-microsecond separation. The context may change within the data arena
at offsets 256–1355, with a caller-owned CAN frame at offsets 1408–1419, and stack bytes may change within the top 256 bytes. Result,
callee-preserved registers, code and all surrounding memory guards remain checked.
Internal C contracts check frames and published payloads; there is no assertion
of exact context/padding/stack bytes within those permitted ranges. These probes
are excluded from the ordinary build. See [ISO-TP evidence](../platform/ISOTP.md).

## Dispatcher execution (2026-11-10)

Nine compiled dispatcher cases add a synthetic ROM callback in
`dispatch_probe.S`: version/size, last-byte and maximum reads, CRC, invalid
bounds, unsupported commands, missing backend and insufficient capacity.
The descriptor pointer is passed in the GNU fifth-argument stack slot at the
incoming SP; its bytes remain checked. Stack writes are allowed only within
256 bytes below that SP. Responses and CRC scratch bytes are checked exactly,
as are input/descriptor memory, code and all other data guards. The callback
is test-only, returns a byte ramp, and has no hardware or mutable global state.
The service adapter is host-tested and linked, not target-executed with a
peripheral backend. See [integration evidence](../platform/READ_ONLY_AGENT.md).

The ISO-TP probe now receives its scratch CAN frame as a third argument in the
mapped data arena rather than on its own stack. The combined build retains the
256-byte conservative sum-of-function-frame budget without increasing it.
Backend/caller obligations outside these fixtures are still separate gates.

## Platform profile (2026-11-10)

Use the same command with `--platform` for the isolated small-model physical
backend library. It runs unsigned high-bit byte/halfword loads, a byte store,
PSW reads, profile rejection, fractional and wrapping clocks, invalid ROM-range
rejection, an unadmitted open and pure flash-admission/transition contracts.
Positive physical ROM reads are now host-shim-only because the callback
requires actual SFR reads; the native runner does not bypass that admission. Only synthetic memory is mapped; physical SFRs and ROM
address zero are not modeled. Host shims separately test the address-zero call
without C null-pointer access and the allowlisted physical access paths.

The backend fixture checks its target ABI layout using emitted constants. Store
has a void return, so its memory/return-PC/register contract is checked without
inventing an r0 result. Actual CAN/timer effects are not emulated. The platform
build also repeats a real-address link-only layout check; that ELF has a test
main and is not the image executed by this runner. See
[physical platform evidence](../platform/PHYSICAL_BACKENDS.md).

The core profile now has two additional startup cases: PSW IE and SM are rejected
before SP/BSS writes, preserving the incoming stack/link and dirty memory.

## Operating entry profile (2026-11-10)

Use `--operating` instead of `--platform` to repeat-build the full LTO operating
entry and execute its exact zero-profile ELF text at candidate addresses. Four
finite cases check two dirty BSS patterns and PSW IE/SM rejection. Code, state
and stack regions are synthetic; no SFR/helper address is mapped. The zero
profile must park without device access. Positive admitted-path service remains
host-shim tested, not native peripheral execution. See
[operating ownership and size proof](../platform/OPERATING_ENTRY.md).

## Limits

This validates finite ordinary-memory executions of the compiled CRC/parser
functions, ISO-TP/dispatcher contracts, and startup assembly with synthetic test entries. It does not validate ECU startup, peripheral behavior, watchdogs,
CAN, flash programming, interrupts, physical RAM allocation or cycle timing.
The core remains non-uploadable; host behavior and flash capability are unchanged.

## Synthetic admitted-path transcript

After a successful `--operating` run, execute
`npm run firmware:evox:transcripts -- --evidence /path/to/operating-evidence`.
The fixture verifies the ELF identity and implementation pins, patches only the
26 profile bytes in its private input, and executes unchanged optimized
instructions. It injects timer ticks, CAN abort completion and a size request,
checks the exact reply, then injects flash-readiness loss and requires a latched
fault and assembly park. The original zero-profile ELF remains unchanged.

SFR storage is inert and the fixed helper address contains a source return stub.
These are explicit synthetic events, not CAN/flash/watchdog emulation. This first
transcript does not qualify ROM-read, multi-frame, flash-clear or physical helper
paths. Outputs and a metadata receipt are retained in a fresh transcripts
subdirectory of the supplied evidence directory. No ECU is accessed.
