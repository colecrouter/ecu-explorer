# Source-built Evo X RAM kernel: reuse investigation

Status: offline C core and repeatable target build started on `feature/evox-source-kernel`; captured bootstrap bundled.
Investigated: 2026-10-31. Related: issues #3 (hardware validation), #10
(flashing variants), and the completed #5 software workflow.

## Findings

The adjacent `evo-x-firmware` project supplies usable build and validation
infrastructure, but does not supply a replacement flashing kernel. Its reviewed
HEAD was `b096ec718a06d6f3ff7028d796535caec2e342f3`; working-tree contents must
be pinned separately when adopting source. This investigation changed no files
in that project. Its private sibling contains tools and experiment products.

Sources inspected there:

- `docs/TOOLCHAIN.md`, `scripts/toolchain/{build,probe}.py`: source-pinned GCC
  11.5.0 and Binutils 2.44, including assembler and linker.
- `scripts/recorder/build.py`: freestanding C build, undefined-symbol rejection,
  ELF identity, section and stack budgets, tool/source hashes and repeat builds.
- `docs/RECORDER_EXECUTION.md`: fresh target compilation and GNU GDB 16.3
  M32R simulator execution with explicit memory mappings and register snapshots.
- `docs/M32R_GLOBAL_REGISTER_FORK.md`: experimental compiler work for matching
  stock register conventions. A standalone kernel should start with the ordinary
  compiler and its own C ABI; stock register compatibility is needed only at
  explicit factory-code boundaries.

No top-level license file was found in the inspected firmware checkout. Before
copying its implementation, establish source ownership and applicable licensing.
Using the installed tools for local experiments does not require copying its
recovered ROM routines. GNU tool licensing and provenance remain separate from
the licensing of newly authored kernel source.

## Fresh verification

The existing probe was run successfully with the installed tools:

```sh
python3 -B /Users/colecrouter/Repositories/evo-x-firmware/scripts/toolchain/probe.py \
  --prefix /Users/colecrouter/Repositories/evo-x-firmware-private/P04/install \
  --out /private/tmp/evox-kernel-reuse-probe-20261031-a
```

The resulting ELF SHA-256 is
`554ddd737dcb9acb84263ad2183fe3207b4e12d62175856e53134375190a1e26`,
matching the firmware project's recorded probe. It is big-endian ELF32 M32R,
base architecture flags zero, synthetic entry `0x1000`, with no undefined
symbols. Layout bytes match `12003456789abcde`. The expected helper-inclusive
link fails, and the unavailable little-endian backend is rejected. Full command
transcripts and hashes are in the output directory. This verifies compilation
and static linking, not target execution or a clean toolchain rebuild.

Use integer-only freestanding C initially, with `-m32r -Wa,-EB
-mmodel=large -msdata=none`, warnings as errors and no implicit runtime helpers.
The installed toolchain has no target libc/libgcc; float and 64-bit division
must not silently introduce unresolved helpers. Stack initialization, BSS
clearing and entry/exit assembly remain new work.

## Reuse boundaries

- Reuse the existing installed compiler and build recipe immediately. Make its
  prefix configurable in a future kernel build instead of embedding local paths.
- Adapt the build's manifest, repeated-build, section-budget and stack-report
  checks for an independently authored RAM image. Do not reuse stock-image
  passthrough builders as evidence of a source-built kernel.
- Adapt the simulator runner for CRC, request parsing, bounds and serialization.
  Existing normal-memory tests do not emulate CAN, flash controllers, watchdogs,
  reset behavior or silicon timing.
- Retain ECU Explorer's OpenPort transports and host session management. Avoid
  duplicating them in the firmware repository.
- Treat recovered firmware routines as evidence with provenance, not an
  automatically redistributable source library.

## Loader and host constraints

The [captured-kernel research](EVO_X_KERNEL_RESEARCH.md) establishes a
208-byte bootstrap loaded at `0x808538`, a fixed descending receive span
`0x80c3fc..0x80b000`, and kernel entry `0x80b000`. The existing host sends
5,117 encoded bytes in 251-byte chunks. These are properties of the captured
loader, not a general arbitrary-image download interface.

The captured loader is now bundled as the default (2026-10-31).
A first private experiment could retain that captured loader and encode/pad a
new image to its fixed span, subject to an audited code/data/stack layout. That
would still depend on proprietary bootstrap bytes. A fully source-shipped
solution requires an independently authored bootstrap too; its allowed size,
entry convention and factory decoder interaction need explicit verification.
Do not assume that changing the download length alone makes a new loader work.

`packages/device/protocols/mut3/src/evox-kernel.ts` currently pins both artifact
hashes and lengths, the V1.09 version string/reply length, and recovery attachment
identity. A new kernel needs an explicit separate identity/profile, including
upload and recovery behavior. Preserve the captured profile's strict validation.
Do not merely remove hash validation or impersonate the captured version.

The initial profile should expose no flash programming capability. Host write
entry points must reject it before any erase/program transaction. Existing
host/session authorization assumptions must be covered even if the replacement
uses a different command subset.

## Proposed implementation milestones

1. **Offline source build:** original C CRC32 and bounded read-command parser,
   explicit assembly entry and linker memory regions. Produce two identical
   builds, a hash manifest, zero undefined symbols, and section/stack reports.
   Execute pure routines under the existing GNU simulator with independent
   CRC vectors, malformed requests and memory-boundary checks. No ECU upload.
2. **Read-only RAM agent:** audit startup state, stack/RAM ownership, CAN
   registers, watchdog and reset behavior against the decoded kernel and device
   documentation. Implement version/capability, read, CRC and reset operations;
   erase/program commands must be rejected. Simulator results do not close
   peripheral or hardware gates.
3. **Source bootstrap and host integration:** define a loader/image contract,
   encode source-built outputs, add a distinct host profile, and test upload,
   recovery attachment and refusal to flash through transcript tests. Acceptance
   for removing external artifacts requires both loader and kernel from source.
4. **Designated bench validation:** verify startup, version, full ROM read/CRC,
   reset and diagnostic return on an operator-designated setup. Record physical
   identity and observations separately from replay/static evidence.
5. **Programming extension:** only after the read-only path, implement and audit
   flash enable/disable, erase, staging and commits, including failure recovery.
   Existing captures are protocol oracles; bench validation remains necessary.

## Milestone 1 progress (2026-10-31)

[Offline core and commands](../firmware/evox/README.md) now provide original C
CRC32/read-request validation, sanitized host contracts, a synthetic assembly
entry and linker layout, and a configurable M32R build. Two target builds match
at 184 bytes with no unresolved symbols. This uses the existing ordinary GCC
installation; no adjacent project implementation was copied. The output is
explicitly not uploadable and is not integrated into the host profile.

[Compiled M32R simulator execution](../firmware/evox/simulator/README.md) now
passes 578 returning calls and two negative engine controls. The checker covers
results, exact permitted writes, complete mapped memory and callee-preserved
registers; failure-injection tests exercise checker rejection. Engine and
source/tool/input/output identities are pinned in the run evidence. The
[receipt](../firmware/evox/simulator/validation.json) records the finite corpus.

An audited uploadable startup layout remains pending; the current entry is a
synthetic infinite-loop fixture, not ECU initialization. The next unit is to
establish startup state, RAM ownership and CAN peripheral requirements before
implementing the read-only agent. No hardware evidence is claimed.

## Startup/CAN progress (2026-10-31)

The [platform audit](../firmware/evox/platform/STARTUP_CAN.md) identifies the
inherited stack/CAN environment and traces the external `0x808640` timer/port
helper to copied factory code. Its likely watchdog role remains an inference;
RAM allocation and entry-mode/interrupt contracts remain open.

Original bounded CAN0 slot primitives now compile with the core. Sanitized host
transcripts cover busy/pending TX, ID encoding, RX races, malformed DLC and
lost/remote frames, preserving caller output on failure. The 808-byte target
links twice identically without libc/runtime helpers. These tests do not model
peripherals; compiled mailbox callback behavior has not been executed in the
simulator. The existing 580-case simulator corpus is rerun against the combined
image to retain the CRC/parser evidence. Source startup assembly now establishes a linker-supplied stack, clears BSS,
calls C and parks. Two simulator cases check dirty-BSS initialization, replacing
an incorrect incoming SP, a C-entry marker and the final park PC. The test main
is synthetic and excluded from ordinary builds. No uploadable entry or live
MMIO is wired into the app; actual RAM/CPU-mode/IRQ assumptions remain open.

## ISO-TP progress (2026-11-05)

The [ISO-TP transport](../firmware/evox/platform/ISOTP.md) now supports Classic
CAN normal addressing on `7e0/7e8`, half duplex and 1–1,032-byte PDUs. It provides
framing/reassembly, flow control, modulo-16 sequencing, bounded WAIT handling,
peer block size/STmin, fixed deadlines and explicit CAN-completion acknowledgement.
Host tests cover every supported PDU length, the public captured version
exchange, malformed/interrupted transfers and pacing/time wrap. Three native
M32R probes cover the captured TX, max-size RX and paced block-size-one TX.
The expanded ordinary image is 2,404 bytes. The dispatcher, live completion-aware
CAN adapter, RAM reservation and time-base/startup profile remain pending.

## Read-only service integration (2026-11-10)

The [dispatcher and completion-aware CAN adapter](../firmware/evox/platform/READ_ONLY_AGENT.md)
now connect complete ISO-TP requests to bounded ROM callbacks and stable replies.
The distinct `ECU Explorer M32186 Read Kernel V0.1` identity supports version,
communication-size, 1–1,024-byte reads and similarly bounded CRCs. Programming,
reset and authentication commands are unsupported; no programming backend exists.
A separate host profile is still required. Explicit recovery waits for both
mailboxes to become idle before clearing stale traffic and reopening processing.

Host integration covers maximum reads, stale/early completion, backpressure,
races, timeout, backend errors and busy recovery. Nine additional M32R dispatcher
cases supplement the transport/startup corpus. The ordinary repeat build is
3,712 bytes. The integrated adapter is linked/host-tested; its physical backends,
RAM reservation, clock/helper contracts and startup loop are still pending.

## Physical backend/profile progress (2026-11-10)

[Physical backends and admission contracts](../firmware/evox/platform/PHYSICAL_BACKENDS.md)
now provide address/width-restricted CAN callbacks, bounded ROM reads (including
address zero via assembly), configuration snapshots and calibrated rational
TMS1-to-microsecond conversion. Unknown calibration has no default. Entry rejects
PSW SM/IE before changing SP/BSS, with native rejection cases.

A separate small-model backend build and real-address link fixture enforce the
captured loader span, state/stack ranges and preserved factory region. The
large-model combined candidate exceeded the span by 151 bytes; constrained small
model fits without relaxing size or stack checks. The ordinary large-model
core profile is retained. The candidate is unadmitted and exports no wire image.
Native backend tests exercise synthetic mapped memory and clock/profile logic;
host access shims cover denied accesses and address zero. No admitted physical
profile, verified RAM ownership, measured time base or operating main is provided.

### Factory helper audit (2026-11-10)

[FACTORY_HELPER.md](../firmware/evox/platform/FACTORY_HELPER.md) records the
84-byte retained helper identity, static callers and memory/register contract.
384 GNU simulator cases execute its original instructions with synthetic
timer/port/state memory, including strict deadline equality, half-range and
counter wrap boundaries. The body uses no stack, preserves r8–r15 and updates
one output bit and two halfwords when due. Electrical watchdog identity,
state initialization, timer calibration and competing-writer exclusion remain
unresolved; no hardware profile or adapter is enabled. Related: #3, #10.

### Factory entry audit (2026-11-10)

[FACTORY_ENTRY.md](../firmware/evox/platform/FACTORY_ENTRY.md) traces the factory
copy/setup path, descriptor-based deadline/counter handoff and conditional call
into the captured bootstrap. 72 passing GNU instruction cases plus one bounded
flash-not-ready control use inert SFR storage. Timer setup derives BCLK/80
(4 microseconds only if BCLK is 20 MHz); P61 data/direction writes are located.
Inherited flash-control writes precede bootstrap entry, so source startup still
needs a flash-state audit. Hardware timing, ownership and wiring remain open.
Related: #3, #10.

### Flash handoff audit (2026-11-10)

[FLASH_HANDOFF.md](../firmware/evox/platform/FLASH_HANDOFF.md) establishes the
captured entry order and unconditional FCNT1 byte-clear operation. 120 passing
GNU cases cover the leaf, wrapper and startup prefix with inert flash register
seeds. The manual's readiness/mode/settling requirements are separate from this
instruction proof; FMOD access-ready is distinguished from FSTAT busy/ready.
A guarded source flash-state admission contract is the next implementation unit.
No flash-control writes are enabled in the source platform. Related: #3, #10.

### Source flash admission (2026-11-10)

[FLASH_ADMISSION.md](../firmware/evox/platform/FLASH_ADMISSION.md) documents
mandatory normal/readiness/reset checks in physical open/bind/time/ROM paths,
plus a pure bounded transition planner. Host contracts reject unqualified exit,
virtual mapping, busy/reset/unavailable states, failed postconditions, excessive
tick gaps and stalled clocks; compiled native cases cover predicates and planner
steps. No flash-control writer is exposed. The link fixture omits the uncalled
planner using section collection; the isolated library retains and executes it.
The complete operating entry still needs budget and hardware admission work.
Related: #3, #10.

### Operating entry and LTO size proof (2026-11-10)

[OPERATING_ENTRY.md](../firmware/evox/platform/OPERATING_ENTRY.md) documents the
bounded flash startup owner, idle-confirmed CAN arming, helper wrapper and service
loop. A separate repeat-built GCC LTO profile links the full reachable graph
within the existing loader span; no planner omission substitutes for this proof.
The linked profile is zero/unadmitted. Four exact-image native startup cases
prove rejection/park and memory guards; admitted read/transition/fault flows run
under host shims. Optimized admitted-path and hardware qualification remain
pending. No uploader capability or ECU execution is enabled. Refs #3, #10.
