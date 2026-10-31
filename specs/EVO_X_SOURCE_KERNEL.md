# Source-built Evo X RAM kernel: reuse investigation

Status: feasibility investigated; captured bootstrap bundled; no replacement kernel implemented.
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

The exact next implementation unit is milestone 1. CAN initialization and an
uploadable bootstrap are deliberately outside that unit's acceptance criteria.
