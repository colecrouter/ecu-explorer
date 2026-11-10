# Physical backends and platform admission

Implemented 2026-11-10; no ECU operations. The backend library and entry guards
are source-built and tested offline. There is **no admitted production profile**.
The [candidate JSON](profile-candidate.json) records the actual remaining gaps;
it is a template, not runtime configuration or an automatic approval mechanism.
Related: #3, #10 and [service integration](READ_ONLY_AGENT.md).

## Physical access and guards

`physical.S` implements explicit M32R byte load, unsigned halfword load, byte
store and PSW read. ROM address zero is passed as an integer to an assembly
load; there is no C null dereference or null-pointer arithmetic. Hardware mapping
still requires the declared normal-mode profile. Low-level primitives are
internal building blocks; applications use the guarded callbacks in `platform.c`.

The bound ROM callback accepts only 1–1,024-byte regions wholly inside the
1 MiB ROM window and valid caller-owned output storage. It provides no write
operation. CAN callbacks allow only slot 0 RX/control reads and slot 1 TX/control
writes needed by the service adapter. Reserved slot fields, flash control and
all other addresses are denied without physical access. A bad access disables
the platform and latches a fault. Previously bound callbacks then perform no
further physical access. The owner must check `evox_platform_now`/fault before
servicing the agent and stop/fault the agent if the platform becomes invalid.
Reopening a platform does not drain mailboxes or recover the agent automatically.

`evox_platform_open` accepts only an externally admitted immutable profile.
Unadmitted/malformed calibration causes no physical access. PSW SM/IE must be
clear before peripheral reads. A read-only snapshot checks the timer control,
five upstream timer-clock registers, CAN control/configuration/prescaler/clock,
standard-frame selection for slots 0/1 and the inherited `7e0` receive ID.
CAN must be out of reset, BasicCAN and loopback modes; the admitted snapshot
must match. The profile remains caller-owned and immutable for its lifetime.
Open also requires normal flash mode, access-ready and program/erase-ready
status, and reset deasserted. Bind, each time sample and each valid ROM batch
recheck flash state; bind/ROM also recheck PSW. Rejection disables the platform
without modifying callback descriptors or ROM output. These are non-atomic
samples: exclusive ownership and settled read-array history remain external
profile obligations. No CPU, clock, pin, filter, flash or watchdog configuration
is written by open. See [flash admission](FLASH_ADMISSION.md).

`admitted` is a caller attestation of external evidence, not discovery of part
identity, RAM ownership, clock rate, absence of DMA/NMI interference, or electrical
setup. No such attestation is supplied in this repository. Matching register
values alone does not prove an oscillator frequency or a stable physical clock.

## Time base

The Renesas [32185/32186 Hardware Manual Rev.1.10](https://www.renesas.com/en/document/mah/3218532186-group-hardware-manual),
sections 10.2 and 10.5, identifies `0x8003d0` as the TMS1 16-bit up-counter,
accessed in halfwords; `0x8003cb` selects/enables it. Upstream clock selection
and prescalers are at `0x800200..204`. Those facts do not supply the inherited
physical tick duration. No default microsecond conversion is assumed.

The profile supplies a calibrated rational microseconds-per-tick numerator and
denominator (both 1–1,000) and a permitted delta (1–32,767 ticks). A 32-bit
microsecond accumulator carries fractional remainders and intentionally wraps
like the ISO-TP clock. All arithmetic fits 32 bits; no floating point or 64-bit
runtime helpers are used. Every time sample rechecks the configuration. A drift
or excessive delta latches a fault without publishing a new time value.

The caller must sample within the admitted cadence and before a complete
16-bit wrap. A counter alone cannot detect multiple missed wraps or a stalled
counter. Independent liveness/watchdog supervision and a fixed clock source
remain admission requirements. A tick ratio also does not establish the retained
factory helper's timing or physical watchdog wiring.

## Entry and RAM candidate

`kernel/startup.S` reads PSW and rejects SM or IE before changing SP or BSS.
SM selects the R15 stack alias; IE enables maskable interrupts. Sources are the
[M32R Software Manual](https://www.renesas.com/en/document/mah/m32r-family-software-manual),
section 1.3.1, and the declared-device hardware manual. The code does not change
CPU modes or interrupt policy. IRQ exclusion does not exclude DMA or NMI.

[ram-candidate.ld](ram-candidate.ld) places entry at `0x80b000`, code inside the
captured 5,117-byte span, BSS in `0x80c400..0x80d000` and a 1 KiB stack in
`0x80d000..0x80d400`. Factory copied code/helper/scratch below `0x808804` and
captured security state from `0x80d860` are excluded. Link assertions enforce
entry location, region bounds, no initialized data, no residual relocations and
stack alignment. Geometric separation does not prove live ownership. Existing
factory/IRQ/DMA users must still be excluded by the admitted profile.

A link-only fixture reserves the real C agent/platform state and supplies a test
main; it is not the operating agent main. The build exports an ELF/map for this
layout proof, **no candidate wire image or binary**, and marks it unadmitted.
A separate [operating-entry profile](OPERATING_ENTRY.md) now links startup,
helper service and the protocol loop using LTO. Its configuration remains zero
and unadmitted; calibration, physical ownership and host admission are pending.

## Build models and reproduction

```sh
npm run firmware:evox:test
npm run firmware:evox:platform:build -- \
  --toolchain-bin /path/to/m32r-toolchain/bin --out /tmp/evox-platform-new
npm run firmware:evox:simulate -- --platform \
  --toolchain-bin /path/to/m32r-toolchain/bin \
  --gdb-source /path/to/gdb-16.3 --gdb-build /path/to/gdb-build \
  --library-dir /path/to/host-libraries --out /tmp/evox-platform-sim-new
```

The platform library/candidate use GCC's `-mmodel=small`, `-msdata=none`, base
M32R and big endian. GCC 11.5's pinned `invoke.texi` M32R options specify that
small model uses lower-16-MiB object addressing and reachable direct calls.
The candidate map constrains every section below that bound, with all linked
calls internal and resolved. The existing ordinary core retains large model.
This is a separate explicit profile; the large-model core's native evidence
is not promoted to full execution proof of the small-model candidate.

The initial combined large-model link exceeded the captured span by 151 bytes.
Selecting the address model justified by the constrained map keeps the loader
limit enforced; no budget or unresolved-symbol check was relaxed. Both backend
and candidate are built twice with matching outputs. The backend keeps its
256-byte conservative sum-of-function-frame budget; the combined link fixture
checks its reports against its separate 1 KiB stack reservation. Future callback,
interrupt and operating-main obligations remain separate.

Host sanitizer tests use physical-access shims and exercise zero/end-of-ROM,
no-access rejection, write allowlists, PSW/configuration rejection, timer gaps,
fractional carry and wrap. Native backend cases execute load/store/PSW
instructions on mapped synthetic memory, calibration validation, rational clock
updates and ROM-range rejection and pure flash gate transitions. Positive ROM reads with
flash checks run under host shims. Native cases do not map or emulate real peripherals.
The existing core simulator also checks rejection before SP/BSS writes for both
IE-enabled and user-stack-mode entries. Receipts identify both build profiles.
