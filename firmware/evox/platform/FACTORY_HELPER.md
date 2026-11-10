# Retained factory timer/port helper

Investigated 2026-11-10 for #3 and #10. The helper's bounded instruction and
memory contract is established for the pinned stock image. Its role as an
external watchdog service remains an inference. No ECU operation was performed,
no adapter is enabled, and the hardware profile remains unadmitted.

## Evidence and scope

The stock ROM SHA-256 is
`409e23912db9e445a72f6f7aff25c393549cc07eb0a649cf663fcbf07fda59af`.
ROM `[0x1760,0x17b4)` is 84 bytes with SHA-256
`92d755bc618dac16d2254dd263724c4594e0d47894f7bfe74dc061f8da0fa117`.
The factory copy descriptor maps that interval to `[0x808640,0x808694)`.
This identifies expected source bytes; it does not verify RAM contents on an ECU.
Kernel/bootstrap identities and relocation evidence are recorded in
[STARTUP_CAN.md](STARTUP_CAN.md).

GNU Binutils 2.44 supplied fresh disassembly. The earlier REA attempt rejected
M32R ELF as unsupported; this investigation uses the supported GNU tools and
claims no REA decompilation. Private disassembly, input packets, runner source,
script and full snapshots remain under `research.local/evox-helper-audit/`.
The tracked [receipt](helper-validation.json) contains hashes and case summaries,
not recovered bytes. Simulator libraries match the existing
[engine lock](../simulator/engine-lock.json).

## Instruction contract

The helper takes no explicit arguments and performs no nested call, stack
access, flash-control write, CAN access, interrupt-mode change or watchdog
register write. Its complete straight-line/conditional body has these accesses:

| Address | Width | Use |
| --- | --- | --- |
| `0x808800` | halfword | Read deadline; write deadline + 1,250 when due |
| `0x8003d0` | halfword | Read current timer once |
| `0x800704` | word | Read port group when due |
| `0x800706` | byte | Read then write the port byte when due |
| `0x808802` | halfword | Read then write counter + 5 when due |

Let `elapsed = (timer - deadline) mod 65536`. The update occurs exactly when
`1 <= elapsed <= 32768`. Equality does **not** update; values past the half-range
are ambiguous and take the no-update branch. This describes the captured
instructions, not a recommended general-purpose deadline comparison.

On update, the word read supplies the current bit corresponding to byte
`0x800706` mask `0x40` in the declared big-endian mapping. The later byte read
supplies the other seven output bits. The helper writes that byte with bit
`0x40` inverted, advances the **old deadline** by 1,250 modulo 65,536 and advances
the second halfword by five modulo 65,536. If another writer changes that bit
between the word and byte reads, this is not an atomic toggle.

There is at most one update per invocation. After a delay, repeated calls can
catch up against the old schedule, producing closely spaced output edges. The
routine provides no guarantee about minimum edge spacing, physical pin state,
watchdog acceptance, or recovery after a missed half-cycle.

## Calling and ownership contract

Static inspection and finite native execution agree that r0–r7 and the
condition flag are scratch. r8–r15, including LR and SP, are preserved by this
body. The other seeded control/accumulator registers remain unchanged in the
probe. There is no meaningful return value. These observations apply to the
84-byte body; they do not establish every exception or CPU-mode obligation.

The captured kernel wrapper at `0x80bb4c` saves LR, loads the helper address,
calls indirectly and restores LR. Direct wrapper callers are:

| Kernel address | Observed context |
| --- | --- |
| `0x80b880` | Receive/transport polling |
| `0x80ba5c` | Transmit-completion polling |
| `0x80bb82` | Timer-based delay loop, after accumulated ticks reach 201 |
| `0x80bcc4` | CRC processing, gated by remaining-length bit `0x400` |
| `0x80be28` | Flash-status wait, after accumulated ticks reach 201 |
| `0x80bf84` | Flash programming loop |

The branch at `0x80bb82` is the second instruction in the word beginning at
`0x80bb80`. The bootstrap also calls the helper directly at `0x808564` while
waiting for upload traffic. These are static call sites, not measured schedules.
The CRC gate is a bit test, not a guarantee of servicing once per 1,024 bytes.

A future source adapter should save its own LR, declare the scratch registers
and condition effects, ignore the return value, and invoke only a verified
helper image. Preserve the existing deadline/counter across handoff; resetting
them to zero is not established as equivalent. An adapter must not assume that
maskable-interrupt exclusion also excludes DMA, NMI or other port writers.

## Native execution validation

The probe executes the actual 84 bytes at their relocated address using GNU
GDB 16.3's M32R simulator. Timer and port addresses are backed by inert synthetic
RAM; this is instruction execution, **not peripheral emulation**.

The 384 cases combine six deadlines, eight modular offsets, four port patterns
and both incoming condition values. Offsets include equality, one tick,
1,249/1,250 ticks, both sides of the half-range and negative one. The counter
starts at 65,533 to exercise its wrap. Full code, synthetic peripheral memory,
state guards and stack are compared; only the predicted three writes are
allowed. Every case returns within 32 simulator steps (nine on the no-update
path), preserving r8–r15 and the checked control/accumulator state. Simulator
steps are not hardware cycles or a worst-case execution-time measurement.

## What remains before admission

1. Verify the copied helper bytes and inherited deadline/counter on the actual
   handoff path. Literal-address searches found the helper's RAM-state accesses
   and descriptor values, but do not establish all computed-pointer writers or
   state initialization. Neither captured upload stage initializes these two
   halfwords in its inspected body.
2. Identify port/pin direction, multiplexing, physical wiring and external
   watchdog requirements. Timed GPIO servicing supports the watchdog hypothesis;
   the routine itself cannot establish it.
3. Calibrate timer ticks and verify continuity through handoff. Derive a service
   cadence from both the helper's half-range comparison and the actual watchdog
   timing window, including catch-up behavior and long ROM/CRC operations.
4. Exclude competing RAM/port writers, DMA and exceptions; verify an adapter and
   its scheduling in the complete operating build before bench validation.

The next useful offline investigation is tracing the factory download-entry
path that copies this helper and establishes its timer, port and state. Bench
work then needs a logic-analyzer trace of the output and an independent timer
reference; CAN captures alone cannot prove those electrical timing contracts.
