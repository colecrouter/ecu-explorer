# Startup, RAM and CAN0 platform contract

Investigated 2026-10-31. Status: startup dependencies traced; original bounded
mailbox primitives implemented and host-tested. Startup assembly is tested under a synthetic profile; no uploadable entry or
hardware initialization is enabled. Related issues: #3 and #10.

## Evidence boundary

The private decoded kernel is SHA-256
`3304fe85517918e2e8ab6a04bf2d702e8b394caf4afd22e90b4c95d86a5bfe00`.
The decoded bootstrap is SHA-256
`6f93d303a13138ea267519a14428f91821e6ed65e49f9423397bb15990f44092`.
The stock ROM examined is SHA-256
`409e23912db9e445a72f6f7aff25c393549cc07eb0a649cf663fcbf07fda59af`.
These remain private inputs; no disassembly or recovered routine is copied into
this source tree. Address descriptions below are static observations, not ECU
execution evidence. GNU Binutils 2.44 was used. REA `open_binary` rejected the
analysis ELF with `unsupported ELF architecture`; no REA decompilation is claimed.

Primary device reference: [Renesas 32185/32186 Hardware Manual Rev.1.10](https://www.renesas.com/en/document/mah/3218532186-group-hardware-manual),
Figure 3.4.2 and sections 13.2.17/18, 13.5 and 13.6. The named part's RAM spans
`[0x804000,0x814000)`; the SFR region below it must not be treated as RAM.
That is a declared-device mapping, not physical identification of a connected ECU.

## Captured entry inherits an environment

- The bootstrap enters at `0x808538`, uses the existing stack, and eventually
  calls `0x80b000`. Its scratch pointer is at `0x808758`.
- The kernel entry at `0x80b000` immediately uses SP. The bounded entry sequence
  does not set a new stack or initialize the CPU from reset.
- `0x80b5e8` clears selected transport state/counters and writes the receive ID
  representation to CAN0 slot 0. This is not a cold CAN controller setup.
- `0x80c004` clears authorization state at `0x80d860`; `0x80bdc8` disables flash
  programming. A read-only replacement must preserve a known nonprogramming
  state; skipping the whole existing entry is not established as equivalent.
- Kernel code at `0x80bb4c` calls `0x808640`, outside its own upload span.
  It does so while receiving/transmitting and inside timed flash waits.

The adjacent project's reviewed factory copy descriptors at ROM `0x1120`
map `[0x1120,0x17bc)` to `[0x808000,0x80869c)`, followed by another copy ending
at `0x80874c`. Applying that relocation maps helper ROM `0x1760` to `0x808640`.
Fresh inspection of `0x1760..0x17b4` shows a timer comparison against the halfword
at `0x808800`, a toggle of output bit `0x40` at `0x800706` using the port value
read at `0x800704`, a 1250-count deadline increment, and a five-count update of
halfword `0x808802`. The timer read is at `0x8003d0`.

Observed: timed port servicing and persistent RAM state. Inferred: external
watchdog servicing. Unknown: physical output wiring, counter units/clock,
required service interval and full entry-path state. The copied helper's
r0–r7 scratch use is not proof of every mode/interrupt ABI obligation.
Preserve its code and state until replacement behavior is established.

## RAM layout decision

The captured upload occupies `[0x80b000,0x80c3fd)` (5,117 bytes). Captured
transport state/buffer addresses include `0x80c400`, `0x80c438`, `0x80c848`
and `0x80c850`; its flash staging buffer begins at `0x80c85c` and separate
security state is at `0x80d860`.

A future read-only layout can reserve a linker-owned region above the image for
request/response buffers and a dedicated stack. That is a design candidate,
not proof those addresses are free throughout the inherited environment.
Preserve the factory copied-code/helper/scratch ranges and determine IRQ/DMA
writers before choosing exact bounds. The normal factory SPI anchor
`0x810d50` from the adjacent project describes reset startup; it does not prove
SP's value, depth, mode or available margin when this bootstrap is called.

Current code deliberately has no data/BSS requirements. The synthetic linker
still rejects initialized data/BSS and reports stack sizes; its addresses are
not a proposed physical allocation. A real entry must establish stack ownership,
BSS initialization, control-register/interrupt preconditions and a defined park
or reset path before it is admitted to the host uploader.

## Source startup implementation

`kernel/startup.S` establishes SP from a linker symbol before using the stack,
clears a byte-addressed linker BSS range, calls `evox_agent_main`, and parks on
return. It now rejects PSW SM/IE before SP/BSS writes, requiring the inherited
interrupt-stack mode and IRQ exclusion. It does not change those control
registers or touch peripherals.
The linker must supply exclusive BSS/stack ranges. Initialized data is currently
prohibited, and unresolved relocations/symbols are rejected.

The simulator links this entry only with `simulator/startup_probe.c`, a test
main that checks 32 bytes of BSS before writing a marker. Two dirty patterns
and a deliberately incorrect incoming SP exercise the real assembled startup;
the checker requires cleared BSS, the marker, the new SP, unchanged surrounding
memory/stack, and the final park PC. The ordinary core build excludes this test
main and startup entry. No production C agent main exists yet.

## Original CAN0 mailbox primitives

`kernel/can.c` implements byte-access callbacks for slots 0 (receive) and 1
(transmit), matching the captured slot use. The caller must establish exclusive
ownership, interrupt exclusion, standard data-frame format, filters, pins,
bitrate/clock and operating mode. Guarded physical callbacks now exist in the [platform library](PHYSICAL_BACKENDS.md);
no admitted profile or operating entry invokes them yet.

Address constants: control bytes `0x801050/51`; slot bases `0x801100/110`;
DLC at slot+5; payload at slot+6. Standard ID bytes encode `id >> 6` and
`id & 0x3f`. Thus captured ID bytes `1f20/1f28` correspond to `7e0/7e8`.
Control masks are transmit request `80`, receive request `40`, remote `20`,
message-lost `04`, active `02`, complete `01`.

Transmit refuses active or pending requests, initializes only its owned control
byte, rechecks idle, writes ID/DLC and zero-padded payload, then queues the
request. A successful return means queued, not acknowledged or transmitted.
Receive requires completion and idle, clears completion before reading, and
rechecks it afterward. Raced, lost, remote or invalid-DLC frames are discarded
without modifying the caller's output. Every call is bounded; retry deadlines
and periodic servicing belong to the future transport loop.

Global slot interrupt status is not cleared here. It is write-zero-to-clear:
a later owner must preserve unrelated pending bits by writing ones to them,
not copy the captured kernel's blanket zero write. Controller configuration and
interrupt reenable/restore remain outside this primitive's contract.

## Validation and remaining work

Sanitized host transcripts validate register access widths/addresses/order,
queue admission, receive completion races, busy/remote/lost rejection, invalid
inputs and caller-output preservation. These are explicit IO contracts, not
an emulator of CAN arbitration or peripheral timing. M32R static builds include
both mailbox functions with no undefined symbols; their runtime callback and
stack behavior still need target execution evidence.

Next implementation units:

1. Admit the [candidate linker/calibration profile](PHYSICAL_BACKENDS.md) using
   physical part, RAM ownership, clock and watchdog evidence. Entry guards and
   a real-address link-only layout are implemented; ownership remains unknown.
2. Audit timer/port servicing sufficiently to retain a validated helper adapter
   or replace it. Do not classify unidentified RAM or peripherals as disposable.
3. The [read-only dispatcher and service adapter](READ_ONLY_AGENT.md) are now
   connected to ISO-TP, with host integration and dispatcher target evidence.
   The physical backend and startup profile remain pending.
4. The guarded physical backend and configuration checks now exist. Admit
   their calibration/configuration snapshot before wiring a startup loop. Bounded completion/abort primitives now have
   host contracts; physical timing/bus-off behavior remains unverified.
5. Validate startup and CAN on the designated bench separately from host and
   instruction simulation. Existing host profile remains unchanged.
