# Unadmitted operating entry and size proof

Implemented 2026-11-10 for #3 and #10. `runtime.c/h` owns bounded startup and
read-only service iterations; `main.c` connects it to the assembled RAM entry.
The complete reachable graph fits the captured loader span under a separate
GCC LTO profile. This remains **unadmitted and non-uploadable**: the supplied
profile is all zero, no hardware operation was performed, and no uploader
capability is added.

## Startup and service ownership

`evox_runtime_begin` initializes caller-owned RAM. It requires an admitted
platform profile, verified helper attestation and a valid bounded flash policy.
An invalid profile performs no MMIO or helper call. Profile storage is borrowed,
immutable and must outlive the runtime.

Each `evox_runtime_step` performs a bounded iteration through these phases:

1. **Flash admission:** validate the CPU/CAN/timer configuration before sampling
   flash and timer state. Feed that snapshot to the existing flash planner. An
   attested `CLEAR` action writes exactly one zero byte to FCNT1, then subsequent
   iterations check readback and calibrated settling. Rejected states perform
   neither a clear nor helper call. No reset, erase/program command, ROM command
   write, automatic rollback or retry is introduced.
2. **CAN arming:** open the platform, bind guarded callbacks and confirm both
   slots idle through agent recovery. Each unsuccessful recovery consumes the
   profile's finite poll budget. Requests cannot dispatch while arming.
3. **Service:** validate platform time/configuration, service the retained helper,
   then run the existing completion-aware CAN/ISO-TP/read-only dispatcher step.
   ROM batches retain their independent flash/PSW checks. A platform fault raised
   inside a ROM callback also faults the runtime before another iteration.

The helper is called only after configuration admission on that iteration.
During startup waits and CAN arming it is serviced within the same bounded
schedule. There is no automatic recovery from a latched runtime fault: the owner
faults the agent, disables callbacks, stops helper calls and returns -1. The C
main returns to the assembly park loop. Explicit reinitialization requires the
caller to reestablish admission conditions; it is not a hardware recovery recipe.

`physical.S` supplies the GNU-callable helper wrapper: save LR, call the fixed
retained entry `0x808640`, restore LR and return. The earlier
[helper audit](FACTORY_HELPER.md) establishes that body's r8–r15 preservation
and zero stack use. The wrapper adds four stack bytes. It depends on the admitted
identity, placement and state of the actual retained helper; this build does not
bundle its recovered bytes.

## Profile and physical limitations

The profile also attests exclusive RAM/CAN/flash ownership, helper identity,
fixed/calibrated clocks, bounded sampling and ROM/CRC execution time, DMA/NMI
exclusion and an accepted park/watchdog fault policy. The code does not discover
those facts. Timer-counter arithmetic cannot detect every stalled or missed-wrap
condition; independent liveness remains an external requirement.

`simulator/runtime_profile.S` is a separate, immutable 26-byte **zero profile**.
Its layout is checked by the target compiler. Separate assembly prevents compiler
constant folding from deleting the conditional operating graph: code is linked
for possible admitted inputs, while the actual supplied input rejects before IO.
The build asserts those bytes remain zero. There is no calibrated/approved
production profile, physical controller initialization, bench qualification or
host upload/attach integration.

The source has now wired the narrow FCNT1 clear operation behind explicit
profile, snapshot and planner admission. This is a change from the earlier
pure-planner-only milestone. It has not been invoked on hardware. The CAN access
allowlist still cannot write flash registers.

## Size strategy and reproduction

Keeping every API externally rooted with LTO did not fit: the diagnostic link
exceeded the 5,117-byte limit by 223 bytes. The ordinary small-model fixture
previously had only 69 bytes left and omitted the uncalled transition planner.
That was not a size proof for an operating entry.

The new profile compiles all core, platform, flash, runtime and main C sources
with ordinary pinned GCC 11.5, `-Os -flto -ffunction-sections`, small model,
big endian, no small-data ABI and a fixed compiler random seed. GCC drives the
link plugin; assembly supplies entry, physical primitives/helper wrapper and
zero profile. The compiler can specialize the single owned runtime and inline
calls across source files. The actual entry keeps its complete reachable
startup, transition, arming, helper and dispatcher graph. No validation or loader
limit is disabled, and no proprietary code body is included.

Both builds enforce the original linker regions, no initialized RAM data, no
residual imports/relocations and exact entry address. They compare ELF/text
hashes, symbols, runtime layout and **post-LTO** stack reports. Missing or dynamic
stack reports fail validation. The conservative sum of emitted C frames plus
four bytes for the assembly helper wrapper must fit the reserved 1 KiB stack.
This does not cover unadmitted exceptions or silicon timing.

The metadata receipt records final code bytes, state size and stack evidence.
The standalone platform library/legacy layout fixture remain separate non-LTO
profiles; their size/evidence is not substituted for the operating image.

```sh
npm run firmware:evox:test
npm run firmware:evox:operating:build -- \
  --toolchain-bin /path/to/m32r-toolchain/bin --out /tmp/evox-operating-new
npm run firmware:evox:simulate -- --operating \
  --toolchain-bin /path/to/m32r-toolchain/bin \
  --gdb-source /path/to/gdb-16.3 --gdb-build /path/to/gdb-build \
  --library-dir /path/to/host-libraries --out /tmp/evox-operating-sim-new
```

The build exports an ELF/map/disassembly and metadata, not a wire upload or raw
candidate binary. The simulator extracts the text section in memory into its
private input packet. LTO compiler, wrapper, linker plugin and delegated tools
are hash-bound in addition to the existing engine/source pins.

## Evidence boundary and next work

Host sanitizer transcripts execute the real runtime/platform/agent sources
with synthetic register shims: unadmitted/helper rejection, startup mode exit,
settling wrap, a complete CAN ROM-read reply, failed clear readback, stale
configuration, stalled-clock budget, finite busy-mailbox arming, CPU rejection
and latched no-more-IO behavior. Injected completion events are not CAN emulation.

The `--operating` native profile executes the **exact linked zero-profile ELF**
at the candidate addresses, with synthetic code/state/stack only. Two dirty BSS
patterns reach the unadmitted park after source initialization; IE/SM cases reject
before SP/BSS writes. Surrounding memory, code, bounded stack effects and final
PC/SP are checked. SFRs and the retained helper address are not mapped. Thus the
native result proves fail-closed startup, not target execution of an admitted
CAN/flash/helper service path. Positive service evidence remains host execution;
the retained helper's earlier native evidence is a separate experiment.

Next: execute admitted-path transcripts against the optimized image in an
explicit synthetic peripheral fixture, then obtain the outstanding hardware
clock/ownership/wiring evidence before considering bench execution. The current
link fit is not a claim of hardware readiness.
