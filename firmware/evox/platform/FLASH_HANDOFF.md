# Captured flash-disable and read-only handoff contract

Investigated 2026-11-10 for #3 and #10. The captured disable operation and entry
ordering are established. A hardware-qualified normal-read transition remains
unimplemented; no flash access policy, uploader or production profile is enabled.
No ECU operation was performed.

## Captured behavior

The decoded kernel identity is SHA-256
`3304fe85517918e2e8ab6a04bf2d702e8b394caf4afd22e90b4c95d86a5bfe00`.
GNU Binutils 2.44 disassembly and GNU GDB 16.3 instruction execution were used;
REA previously rejected M32R ELF, so no REA decompilation is claimed. Input
identities and the preceding factory path are in
[FACTORY_ENTRY.md](FACTORY_ENTRY.md).

The entire leaf at `[0x80bd98,0x80bda4)` loads address `0x8001e2` into r0, loads
zero into r1, stores **one byte** of zero and returns through LR. There are no
loads from peripherals, branches on status, ROM commands, reset pulses, delays,
helper calls or stack accesses. It is not a complete controller recovery routine.
The wrapper `[0x80bdc8,0x80bdd0)` saves LR, calls that leaf and restores LR.
There is no meaningful return value; r0/r1 are scratch.

The kernel entry prefix runs in this order:

| Call site | Target | Effect observed in the captured body |
| --- | --- | --- |
| `0x80b004` | `0x80b5e8` | Clear eight transport words; write CAN slot-0 ID word `0x1f200000` |
| `0x80b008` | `0x80c004` | Clear authorization word at `0x80d860` |
| `0x80b00c` | `0x80bdc8` | Clear byte `0x8001e2` |
| `0x80b010` | Loop | Enter receive/dispatch polling |

Entry uses the inherited stack and does not mask interrupts. The table's CAN
write does not configure the whole controller. Neither source startup nor a
read-only agent should inherit the captured authorization system unnecessarily.
The security word lies outside our candidate source state region.

Other direct calls to the disable wrapper occur at `0x80b2f0`, `0x80b3a0`,
`0x80b488`, `0x80b538`, `0x80b55c` and `0x80b5c0`. Contexts include an explicit
mode-exit response and request validation/checksum/operation failures. The wrapper
itself adds no readiness checks in any context; these callers do not turn it
into a general-purpose safe transition.

## Register meanings and controller requirements

The Renesas [32185/32186 Hardware Manual Rev.1.10](https://www.renesas.com/en/document/mah/3218532186-group-hardware-manual),
sections 6.5.1–3 and Figure 6.6.7, distinguishes:

| Address | Register | Relevant numeric masks |
| --- | --- | --- |
| `0x8001e0` | FMOD | `0x10` access-enabled FAENS; `0x01` external FP pin status |
| `0x8001e1` | FSTAT | `0x80` program/erase-ready FBUSY |
| `0x8001e2` | FCNT1 | `0x10` program/erase entry; `0x01` virtual-emulation mode |
| `0x8001e5` | FCNT4 | `0x01` flash reset |

Its normal-mode procedure requires program/erase readiness, read-array mode or
a completed flash reset, clearing FENTRY, and more than eight CPU clocks before
flash execution. A reset path additionally waits for FAENS. Interrupts remain
excluded across the vector-location change. Clearing FENTRY also clears FCNT2's
lock-read/protection-override controls in hardware. The captured byte store
clears both FCNT1 mode bits; it does not prove those prerequisites or timing.

## Why the capture can rely on earlier work

The traced factory path already enters flash E/W mode and pulses reset before
calling the uploaded bootstrap. Its poll at copied ROM `0x154c..0x1554` reads
**FMOD FAENS**, not FSTAT FBUSY. The previous audit's generic “flash-ready” wording
referred to access readiness; it must not be treated as an observed FBUSY check.
The bootstrap then waits for the uploaded kernel, periodically calling the timer/
port helper, and finally calls `0x80b000`. Its inspected body does not issue a
subsequent flash command or change these flash-control registers.

Inference: the initial disable is intended to finish an already-reset,
access-ready inherited state. That interpretation depends on the factory path,
actual controller side effects, stable state during upload and interrupt/DMA
ownership. A CAN transcript or inert-memory probe cannot establish them all.
The captured leaf contains no explicit settling delay. Calls, returns and the
transport loop follow it, but simulator step counts do not prove CPU timing.

The neighboring enable/reset routines are materially different: `0x80bd64`
writes FCNT1 zero then `0x10`, writes FCNT2 zero then one, and calls `0x80bd30`.
The latter pulses FCNT4, uses a timer-based delay and polls FMOD access-ready
without an explicit timeout. None of that work is performed by the disable leaf.
A read-only startup must not invoke the enable path simply to mimic the capture.

## Source design decision

Keep the CAN and ROM callbacks' existing flash-write denial. Any future exit
from inherited flash mode belongs to a separate, narrowly scoped startup
operation, gated by an admitted hardware profile, CPU state and owned RAM.
The subsequent [source admission implementation](FLASH_ADMISSION.md) now checks
normal mode/readiness/reset in open, bind, time samples and ROM batches. Its
checks do not establish physical transition history or hardware readiness.

Proposed admission behavior, not implemented hardware code:

1. Inspect flash state before exposing ROM callbacks. Accept an established,
   stable normal-read state; reject virtual mapping or unknown transition state.
2. If inherited E/W mode requires exit, require evidence for the reset/read-array
   precondition and use a bounded transition with explicit readiness, settling
   and postcondition checks. Do not blindly replay the leaf on arbitrary states.
3. Stop service admission if checks fail. Specify fault/watchdog behavior before
   enabling this path; do not introduce an unbounded wait or automatic flash reset.

This is a conservative design inference from the captured dependency and manual,
not a hardware-validated recipe. It does not require the external FP pin to be
low merely to classify normal-read mode. Clock calibration, controller history,
read-array semantics and variant-specific mapping still need admission evidence.

## Native evidence

[flash-validation.json](flash-validation.json) summarizes 120 passing cases;
private scripts, packets and full snapshots are under
`research.local/evox-flash-entry/`. The runner executes original kernel bytes
against inert ROM/RAM/SFR storage using the pinned GNU engine. It does not emulate
flash programming, reset side effects or mode-dependent memory behavior.

Three families execute the leaf, wrapper and complete startup prefix through
the first polling-loop entry. Each combines five FCNT1 bytes, four combinations
of FMOD/FSTAT/reset bytes and both incoming IE states. Arbitrary/invalid seeds
are intentional negative evidence about absent guards, not valid silicon states.
Every case returns/reaches its stop in respectively 4, 8 or 47 simulator steps.

Full ROM, SFR storage and RAM are compared. The only allowed changes are the
predicted FCNT1 byte, bounded call-stack words, and (for startup) the documented
transport/security words and CAN ID word. Other seeded registers/controls are
preserved apart from r0/r1, PC/LR and the startup SP/SPI alias. Inert FCNT2 bytes
remain unchanged; real controller auto-clearing is deliberately not simulated.
These checks prove bounded instruction effects, not a safe busy-state exit or
an eight-clock hardware settling interval.

The [source flash-state admission contract](FLASH_ADMISSION.md) is now implemented
and host/native tested. Wiring an admitted startup owner to its transition
actions and fitting the complete operating entry remain pending. Physical
readiness remains separate from that source/test work.
