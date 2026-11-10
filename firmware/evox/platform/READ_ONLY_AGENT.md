# Read-only dispatcher and CAN service adapter

Implemented 2026-11-10. Related: #3, #10 and
[startup/platform requirements](STARTUP_CAN.md). This is an integrated offline
component with injected CAN/ROM backends. The physical MMIO/time-base/startup
profile and uploadable image remain pending.

## Read-only protocol identity

`kernel/dispatch.c` identifies itself as `ECU Explorer M32186 Read Kernel V0.1`.
It does not impersonate the captured OpenECU V1.09 kernel. The host still accepts
only the captured profile and cannot upload or attach to this component yet.

Supported requests and replies:

| Request | Required length | Reply | Bound |
| --- | --- | --- | --- |
| `01` version | 1 | `81` plus NUL-terminated new identity | Fixed string |
| `05` communication size | 1 | `85 00 00 04 08` | 1,032-byte transport PDUs |
| `03` read | 7 | `83` plus data | 1–1,024 bytes inside the 1 MiB ROM window |
| `02` CRC32 | 9 | `82` plus big-endian CRC32 | Same bounded ROM region |

Read encodes a four-byte address and two-byte length; CRC uses four bytes for
both. Bounded CRC is a deliberate difference from the captured kernel's larger
region operations, keeping each synchronous service unit small. A future host
profile must respect that difference. Responses are at most 1,025 bytes.

Unsupported commands return `f0`; malformed supported requests return `f1`;
backend failures return `f2`. Reset, challenge/unlock, flash enable, erase,
staging and commit are unsupported. All other command bytes are rejected with
no backend call. No programming or reset callback exists in this interface.
The dispatcher adds no kernel authentication layer; factory upload authorization
and the admission of a new host profile are separate work.

The ROM backend receives only validated regions and must return exactly 1 on
success. It may write scratch bytes before reporting failure; only the one-byte
error is then published. Output/capacity errors return zero without touching
output or invoking the backend. Request/reply buffers must be valid/disjoint.
CRC uses the reply buffer as bounded scratch before publishing its five bytes.

## Integrated service ordering

`evox_agent_init` creates an unarmed/faulted owner. The caller must first call
`evox_agent_recover` under the existing exclusive-slot and interrupt-exclusion
contract. Recovery requests TX abort and disables RX, waits through bounded
polls until both slots are inactive, then clears stale completion/RX data,
rearms RX and resets ISO-TP. Filters, clocks, format and pins remain inherited.

Each `evox_agent_step` performs bounded work:

1. Check the transport deadline. A fault latches and stops further processing.
2. If a frame is in flight, consume only a real, inactive TX completion. With
   no completion, return without reading an early reply or queueing again.
3. Acknowledge ISO-TP transmission before reading buffered RX. This lets an
   early FC apply to the newly established wait-for-FC state.
4. Consume at most one stable RX frame. Only complete PDUs reach the dispatcher.
5. Prepare the bounded reply once, release the request and start its ISO-TP TX.
6. Poll a pending frame and try to queue it. Mark it in flight only on admission;
   retain the same bytes under backpressure. The reply stays immutable until
   completion, timeout or recovery.

The adapter's scratch CAN frame is caller-owned context storage, avoiding a
large additional frame on every service stack. It is separate from ISO-TP's
pending frame, so reading RX cannot corrupt a frame waiting for admission.

Malformed traffic, receive races/loss, invalid IO and timeouts latch a fault.
Explicit recovery cannot clear that fault while either mailbox remains active.
It drops stale traffic before reopening the owner. ROM backend errors produce
protocol errors without fabricating successful data or faulting the transport.
Recovery polls need the platform's own deadline/watchdog supervision if a device
never becomes idle; this code contains no unbounded wait.

## Completion and cancellation evidence

New `evox_can_finish_send` consumes `TRFIN` only when `TRSTAT` is inactive and
clears that completion once. Missing completion, including idle-looking slots,
never means success; the ISO-TP deadline bounds the wait. Queueing clears stale
flags before writing a new request. This layer does not infer success from bus
arbitration loss or decode all controller/bus-off errors.

`evox_can_reset_slots` requests abort with the documented `0f`, disables receive,
checks both active bits, then clears TX and rearms RX when idle. The source is
[Renesas Hardware Manual Rev.1.10](https://www.renesas.com/en/document/mah/3218532186-group-hardware-manual),
sections 13.2.17, 13.5.2/3 and 13.6.1. Global interrupt flags are left alone;
exclusive ownership and interrupt exclusion remain mandatory.

## Validation

Host AddressSanitizer/UndefinedBehaviorSanitizer tests cover the complete path
through an explicitly controlled register bank: stale completion before queue,
early FC before actual completion, stable backpressure with one ROM dispatch,
a maximum read across response sequence wrap, receive races, unsupported
programming, backend failure, timeout and recovery while TX or RX remains active.
The register bank injects states manually and is not a silicon/CAN timing model.

Compiled M32R dispatcher cases execute version/size, last-byte and maximum reads,
CRC, invalid bounds, unsupported commands, missing backend and capacity rejection.
A synthetic assembly ROM callback generates independently specified byte ramps
using the GNU argument ABI. Its callback pointer is the fifth stack argument;
checks include the response/scratch bytes, immutable input/backend descriptor,
callee-preserved registers and stack guards. CRC expectations use Python's
independent CRC32. These cases supplement the existing compiled transport and
startup cases; the integrated service adapter itself is host-tested and linked,
not yet target-executed with a peripheral backend.

Run the existing firmware test/build/simulate npm scripts. The ordinary image
includes dispatcher/adapter code; simulation-only callbacks/probes are excluded.
The current build still has a synthetic parking entry, not a production C main.

The [physical callbacks, time-base guards and candidate layout](PHYSICAL_BACKENDS.md)
are now implemented. Next: admit the physical RAM/calibration/helper contracts,
qualify the [operating entry](OPERATING_ENTRY.md) and add a distinct read-only
upload/attach profile.
Hardware scheduling, watchdog timing and actual ECU behavior need bench evidence.
No ECU operation or direct physical-memory access was performed by this work.
