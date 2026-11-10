# Compiled M32R execution

This harness freshly builds the offline core, resolves function addresses from
that ELF, and executes its code using the existing GNU GDB 16.3 M32R simulator.
The C driver is original code using GNU's public libsim API. It follows the
adjacent firmware project's demonstrated setup; no recovered routines or its
runner implementation were copied. GNU implementation sources/notices stay in
the externally supplied GDB source/build directories.

## Reproduce

Use the ordinary GCC toolchain and existing simulator installation:

```sh
export M32R_TOOLCHAIN_BIN=/path/to/m32r-toolchain/bin
npm run firmware:evox:simulate -- \
  --gdb-source /path/to/gdb-16.3 \
  --gdb-build /path/to/gdb-build \
  --library-dir /path/to/host-libraries \
  --out /tmp/evox-simulator-new-run
```

`--library-dir` is optional; the successful macOS run uses `/opt/homebrew/lib`.
The actual local source/build directories are in the adjacent private project's
`decoder/gdb-16.3` and `decoder/build`. No download, install, hardware operation
or adjacent-repository edit is performed. The output directory must be new.
Python 3, a host C compiler, host zlib/zstd libraries and the existing static GNU
libraries are required; macOS also links iconv. `--host-cc` or `CC` selects the
host compiler. `--toolchain-bin` can replace the environment variable.

`engine-lock.json` pins the previously built host-specific GNU archives and
selected public/generated headers. Mismatched or missing dependencies fail;
the runner never silently skips or swaps engines. Another machine needs a
separately reviewed simulator build and lock update. The archive SHA is the
previous investigation's GNU GDB 16.3 identity, not a claim this command rebuilt
GNU or verified all extracted sources against that archive. Shared system
library dependencies are recorded by link command, not fully pinned.

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

## Limits

This validates finite ordinary-memory executions of the compiled CRC/parser
functions, ISO-TP/dispatcher contracts, and startup assembly with synthetic test entries. It does not validate ECU startup, peripheral behavior, watchdogs,
CAN, flash programming, interrupts, physical RAM allocation or cycle timing.
The core remains non-uploadable; host behavior and flash capability are unchanged.
