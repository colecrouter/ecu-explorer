# Factory entry and inherited helper state

Investigated 2026-11-10 for #3 and #10. This closes the bounded static question
of where the copied helper and its counters come from. It does not admit a
physical profile or establish oscillator frequency, electrical watchdog wiring,
RAM exclusivity, or flash-safe handoff. No ECU operation was performed.

## Evidence boundary

Inputs are the pinned stock ROM, decoded bootstrap and decoded kernel identified
in [STARTUP_CAN.md](STARTUP_CAN.md). Fresh GNU Binutils 2.44 disassembly and
GNU GDB 16.3 M32R instruction execution were used. The existing REA architecture
limitation remains; no decompilation is claimed. Private scripts, disassembly
and snapshots live under `research.local/evox-entry-profile/`.
[entry-validation.json](entry-validation.json) retains metadata and hashes only.

The native probe uses unmodified stock ROM bytes and, for bootstrap-boundary
cases, factory-copied bytes overlaid with the decoded capture. SFR addresses
are inert memory, including seeded flash-ready status. This does not emulate
hardware side effects, asynchronous timer advancement or actual flash behavior.
It also does not replay the entire diagnostic session from reset.

## Factory path

| Site | Observed operation |
| --- | --- |
| ROM `0x32b4` | Set PSW to zero, establish SPI `0x810d50` and FP `0x80c000`; later enable maskable interrupts |
| ROM `0x32f4` | Select one branch into factory service entry `0x4020` |
| ROM `0x4028` | Call initialization `0x3364`, which first calls general initialization `0xbcc` |
| ROM `0x4034` | Clear the factory service-state range beginning at FP+`0x6500` |
| ROM `0x4040` | Enter factory service loop setup `0x4048` |
| ROM `0x405c..0x408c` | Establish timer-relative deadlines, including current timer + 625 at FP+`0x6500` |
| ROM `0x410c` | Copy factory code and its table into RAM via `0x36c8` |
| ROM `0x4110` | Begin repeated ROM-side timer/port service and diagnostic polling |

This is a traced branch of the stock image; other startup branches and live
entry conditions remain separate. FP+`0x6500` is `0x812500` under the established
FP, and FP+`0x6502` is `0x812502`. These are the factory-side deadline/accounting
locations, distinct from the copied helper's `0x808800/0x808802`.

`0x36c8` consumes two descriptors at ROM `0x1100..0x1114`:

| Source | Destination | Length |
| --- | --- | --- |
| `0x1120` | `0x808000` | `0x69c` |
| `0x17bc` | `0x80869c` | `0xb0` |

The byte-copy loops call the ROM-side port service every 200 bytes. The first
copy contains the helper at relocated `0x808640` and placeholder routine at
`0x808538`. The captured bootstrap replaces that placeholder after this setup;
it does not replace the helper. The second copy ends at `0x80874c`.

## Timer and port setup

The Renesas [32185/32186 Hardware Manual Rev.1.10](https://www.renesas.com/en/document/mah/3218532186-group-hardware-manual),
sections 8.3, 10.2 and 10.5, supplies the register meanings below. Values are
observed writes on the inspected branch, not a complete live register snapshot.

| ROM site | Register | Observed write |
| --- | --- | --- |
| `0xc98` | `0x800200`, CNTCKSEL | `0x80`: select BCLK/2 for prescalers 0–2 |
| `0x3372` | `0x800202`, PRS0 | `0x27`: divide by 40 |
| `0x338c` | `0x8003cb`, TMS1CR | `0x01`: count enabled, clock bus 0 |
| `0x33e2` | `0x800706`, P6DATA | `0x40` |
| `0x33ee` | `0x800726`, P6DIR | `0x70`: includes P61 output direction |

Sites within bundled words identify the individual store instruction. For
example, `0xc90` adds 121 to the existing r0 value **7**, yielding `0x80` for the
store at `0xc98`; interpreting that immediate as a direct `0x79` assignment is
incorrect. The subsequent prescaler write changes PRS0 from its inherited value.

Clock bus 0 is supplied by PRS0. Consequently this setup gives
`timer_frequency = BCLK / 80`, or `tick_duration = 80 / BCLK` seconds. **If** the
physical BCLK is 20 MHz, the tick is 4 microseconds, the 625-tick initial offset
is 2.5 ms and the 1,250-tick helper interval is 5 ms. These times are conditional
calculations, not measured calibration. No production tick ratio is installed.

The output mask `0x40` corresponds to P61 under the manual's MSB-first port bit
numbering. This establishes data and direction writes; it does not identify
board wiring, prove all peripheral/input-selection state or exclude later
writers. General initialization does not justify treating every port register
as reset-valued. The candidate still needs an actual configuration snapshot.

## Counter handoff and bootstrap entry

The state addresses are loaded indirectly from descriptor words:

- ROM `0x1118` contains `0x808800`, the copied helper's deadline address.
- ROM `0x111c` contains `0x808802`, its accounting-counter address.

The service handler for captured `31 e0` selects the factory erase path through
ROM `0x39b4`. After its guard/polling work, `0x3a10` calls the factory interrupt
mask routine. `0x3a14..0x3a1e` copies FP+`0x6500` into the first halfword and
clears the second. `0x3a24` calls copied code at `0x808288` (ROM `0x13a8`).
That copied body eventually calls ROM placeholder `0x1658` at its relocated
address `0x808538`, now occupied by the uploaded bootstrap. This is a call
through the retained factory routine, not a cold jump from reset.

The `31 e0` selection is visible at ROM `0x4d48..0x4d5c`, with additional state
and authorization checks before `0x4f70` calls `0x39b4`. This investigation does
not generalize those checks to other diagnostic requests or bypass them.

The parallel factory programming path also transfers the same two halfwords
at `0x3d08..0x3d16`. If copied factory routines return, their updated deadline
and counter are copied back at `0x3a2c..0x3a38` / `0x3d24..0x3d30` before the
previous PSW is restored. Thus these addresses form a bridge between ROM-side
and copied-code timing state. They are not disposable scratch or source BSS.

In the selected native bootstrap-boundary cases, both incoming PSW IE states
reach `0x808538` with SM/IE clear, the deadline preserved and counter zero.
Starting the slice with SP `0x810d50` gives SP `0x810d34` and LR `0x808354` at
that boundary. The SP result is relative to that synthetic slice's initial SP;
it is not a measurement of the complete diagnostic call stack.

Before reaching the placeholder, copied code writes `0x8001e2 = 0x10`, writes
`0x8001e3` first zero then one, pulses `0x8001e5`, and polls flash status.
Therefore an uploaded read-only agent cannot assume that inherited flash
control is already in its required nonprogramming state. The captured kernel's
entry-side disable routine must be audited before equivalent source startup
is enabled. These observations do not instruct or perform a physical flash
operation.

## Native checks and remaining work

There are 72 passing finite cases: nine entry families across two timer values,
two memory patterns and two incoming IE states. Families cover general
initialization, its clock slice, full timer/port initialization, the timer/port
slice, both deadline initialization sites, both factory copies, state handoff,
and the conditional path to the bootstrap boundary. Checks establish selected
register/memory postconditions. Copy cases additionally compare the full ROM,
SFR storage and RAM, allowing only the copied ranges and bounded stack scratch.
The longest case takes 26,290 simulator steps; steps are not hardware cycles.

A separate negative control leaves flash-ready status unset and reaches the
1,000-step cap in the copied status poll before entering the bootstrap. This
exposes an inherited peripheral dependency; it is not a simulated watchdog
reset or proof of hardware liveness. Full peripheral behavior is outside scope.

Remaining admission work is now narrower:

1. Audit the captured kernel's flash-disable/startup path and implement equivalent
   read-only entry handling only after its required state is understood.
2. Confirm physical BCLK and fixed clock behavior, then calibrate the time base.
3. Verify RAM/helper identity, P61 wiring and configuration, and competing
   writers/DMA/NMI on the actual handoff path.
4. Build and validate the helper adapter and operating loop, including service
   cadence and catch-up behavior, before separate bench execution.
