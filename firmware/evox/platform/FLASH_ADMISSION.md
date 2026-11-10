# Source flash-state admission

Implemented 2026-11-10 for #3 and #10. Original source in `flash.c/h` supplies
normal-read validation and a bounded transition planner. `platform.c` uses the
normal-read predicate before exposing physical ROM access. No production profile,
hardware profile or ECU execution is enabled. The subsequent
[operating entry](OPERATING_ENTRY.md) wires a conditional FCNT1 clear owner
under a zero/unadmitted profile.

## Physical gate

Open, bind, time sampling and each valid ROM-read batch require FCNT1 zero,
FMOD access-ready, FSTAT program/erase-ready and FCNT4 reset deasserted. External
FP may remain high. Stale error-status bits alone do not block normal ROM reads.
Register masks and provenance are in [FLASH_HANDOFF.md](FLASH_HANDOFF.md).

The checks only read the four flash registers. A failure latches the platform
fault and disables further callbacks. Bind leaves supplied descriptors unchanged;
ROM rejection leaves output unchanged and performs no ROM load. Invalid ROM
ranges are rejected before any peripheral access. Bind and ROM also check PSW
before peripheral reads. Open continues to reject unadmitted profiles without
physical access. CAN callbacks still deny flash-register writes.

These samples are not atomic against external writers. Profile admission still
attests exclusive ownership, normal mapping, settled/read-array history, stable
clock and exception/DMA constraints. Passing register checks alone cannot supply
those facts. Once a ROM batch starts, the code relies on that ownership; it does
not claim protection against a concurrent controller-mode change.

## Pure transition planner

`evox_flash_init` and `evox_flash_step` operate only on caller-owned structures.
They have no IO callbacks, physical addresses or hardware effects. An admitted
startup owner must supply CPU/configuration checks, calibrated
16-bit time, snapshots and any permitted physical action.

Initialization validates a settling interval of at least one tick, a maximum
elapsed interval below 32,768 ticks, a poll budget of 1–32 and a Boolean exit
attestation. The caller must establish that the chosen settling duration exceeds
eight CPU clocks and sample within a single timer wrap. Calibration, clock
liveness and valid storage are caller obligations.

| Result | Meaning and required owner action |
| --- | --- |
| `READY` | Normal/readiness/reset predicate passes; transition settling, if started, has elapsed |
| `CLEAR` | Exactly one request for a separate startup owner to clear FCNT1 as a byte |
| `WAIT` | Post-clear snapshot is normal; settling interval has not elapsed |
| `DENY` | Rejection latched; no further action until explicit reinitialization |

An initially normal snapshot can become ready without exit attestation; its
history/settling is covered by external profile admission. An initial E/W
snapshot requests `CLEAR` only when FCNT1 is exactly `0x10`, status is ready,
reset is clear, and exit attestation confirms prior completed reset/read-array
history. Virtual-emulation mode and malformed mode combinations are rejected.

After `CLEAR`, the next snapshot must show normal state. Unchanged control,
busy, reset or unavailable flash is rejected immediately. Each insufficient-time
sample consumes the finite budget, preventing a stalled clock from waiting
forever. Excessive elapsed time fails; normal timer wrap is supported. `READY`
continues to check state on later calls. Any rejection stays latched even if a
later snapshot looks good. No automatic reset, rollback, flash command or retry
is requested. The owner must define fault/watchdog behavior before hardware use.

## Validation and code budget

Host sanitizer contracts exercise action sequences, attestation rejection,
virtual/busy/unavailable/reset states, failed clear readback, fractional platform
time, timer wrap/gaps, post-admission drift, stale callback rejection, unchanged
outputs/descriptors and a stalled-clock poll limit. The physical-access shims
perform no device IO. Native `--platform` cases execute the compiled pure gate
and its initialized states; no flash peripheral is emulated.

The platform library exports the complete planner for native execution. The
real-address link fixture includes the physical admission checks, but its test
main has no transition-owner caller. Flash functions are compiled into separate
sections, and the candidate link collects unused sections while retaining the
existing core/platform bodies. Assertions confirm the normal-read gate and
service adapter remain linked and the uncalled planner is absent. The loader
limit is unchanged. Stack accounting conservatively includes even the omitted
planner's reported frames.

This legacy fixture is not a size proof for an operating main that invokes the planner:
linking every new function initially exceeded the captured span by 183 bytes.
The complete startup owner, helper adapter and operating loop still need code
budget work before any uploadable candidate can be produced. Existing host
uploader capability and admission remain unchanged.

A separate [LTO operating profile](OPERATING_ENTRY.md) now links the complete
reachable startup/service graph with the planner. Its exact zero-profile entry
has native fail-closed evidence; admitted-path behavior remains host-tested.
