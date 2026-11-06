# Bounded ISO-TP transport

Implemented 2026-11-05 in `kernel/isotp.c`. Scope: Classic CAN, normal physical
addressing, tester `0x7e0`, ECU `0x7e8`, half duplex, 1–1,032-byte PDUs.
This is an offline component; the live command loop and MMIO backend are pending.
Related: #3, #10 and [startup/CAN requirements](STARTUP_CAN.md).

## Interface and ownership

The caller owns a context, RX storage embedded in that context, borrowed TX
bytes and output CAN frames. Initialization resets protocol fields; it does not
wipe buffers. Context pointers must be valid and exclusively accessed. There
is no allocator, global mutable state, blocking loop or peripheral access.

- `evox_isotp_frame` consumes a received `evox_can_frame`. A return of 1 publishes
  a whole request via `received` and `rx`. Partial data is never published.
- `evox_isotp_release` releases a completed request after the application has
  consumed it. Sending a response requires releasing it first. RX data may then
  be reused as immutable TX storage if the application chooses.
- `evox_isotp_send` starts a PDU using borrowed bytes, which must remain immutable
  until completion or abort. Busy or invalid requests return -1.
- `evox_isotp_poll` returns a stable pending frame, including under mailbox
  backpressure. Repeated polling does not consume bytes or refresh the deadline.
- `evox_isotp_sent` advances a frame exactly once after actual CAN completion.
  A successful `evox_can_try_send` means only queued; it must not immediately
  trigger this call. Complete pending TX before delivering the corresponding
  incoming FC, including when the lower transport buffers early replies.
- `evox_isotp_tick` aborts incomplete RX, pending frames and TX on a one-second
  inactivity deadline. Call it during idle/busy polling as well as packet events.

The future adapter must track its own in-flight mailbox, acknowledge completion
before accepting a reply, avoid requeueing a pending frame already in flight,
and reset the ISO-TP context after a fatal CAN error. A completed RX is retained
until release, including across malformed traffic. This module does not replace
transmit completion/error detection in the CAN backend.

Time is a monotonic wrapping 32-bit **microsecond** counter. Poll at least once
per second; raw device timer ticks require an independently validated conversion
and extension. Unsigned elapsed intervals handle counter wrap. No calibrated
ECU time base is supplied here.

## Framing and flow control

Single frames carry up to seven data bytes. First frames carry a 12-bit total
length and six bytes; consecutive frames carry up to seven bytes with modulo-16
sequence numbers. Transmitted CAN frames use DLC 8 and zero padding. RX accepts
short final frames and ignores padding after the declared payload.

RX advertises CTS with unlimited block size and zero separation (`30 00 00`),
after confirming the PDU fits its fixed buffer. Oversize first frames produce
an overflow FC (`32 00 00`). CFs are admitted only after CTS transmission is
reported complete. Interrupted, duplicate, out-of-order, unexpected or truncated
frames abort the incomplete transfer. Unrelated CAN IDs are ignored and do not
extend deadlines. Completed requests cannot be overwritten by a new transfer.

TX waits for CTS after its first frame and each nonzero-sized block. It honors
peer block size and separation, accepts at most three WAIT frames per block,
and aborts on overflow, malformed FC or reserved fields. The accepted STmin
encodings are milliseconds `00..7f` and 100–900 microseconds `f1..f9`; other
values are rejected. See the primary [Linux ISO-TP documentation](https://docs.kernel.org/networking/iso15765-2.html)
for frame types and FC parameters. The fixed PDU capacity, half-duplex policy,
timeout and WAIT limit are choices for this kernel, not a claim of general
ISO-TP certification or support for every addressing/CAN-FD variant.

## Contract evidence

The public version exchange at lines 742–750 of `session sample 1.candump`
(SHA-256 `fab438cc369b45298786927d729920a8db5b6dbdc2e72a9987f6576fda39e5ee`)
is frozen in `test/isotp-version.h`. The generated first/consecutive frames and
padding match those recorded bytes. Only version text and protocol bytes are
retained; no ROM or executable payload is copied.

The sanitized host harness additionally checks every payload length 1–1,032,
sequence wrap, malformed/truncated frames, overflow, busy/unacknowledged sends,
RX publication, timeouts, all 256 STmin values, reserved flow statuses, bounded
WAITs, block-size-one operation and time wrap. The all-length tests independently
check PCI, payload offsets and padding before feeding frames to the receiver.

Three simulation-only probes execute the freshly compiled implementation:
recorded version TX, maximum-size RX with sequence wrap, and block-size-one TX
with 100-microsecond pacing. They check the observable frames/payloads/results.
The native runner also checks result and callee-preserved registers, unchanged
code, and guards around a 1,100-byte context allowance and 256-byte stack
allowance. Context and permitted stack contents are mutable; these probes do
not claim exact internal-state byte equivalence. Checker tests inject writes
outside each allowance and require rejection.

Build and execute through the existing `firmware:evox:test`,
`firmware:evox:build` and `firmware:evox:simulate` npm scripts. The simulator
probes are excluded from the ordinary firmware build. No ECU upload, hardware
CAN timing, watchdog servicing or real RAM allocation is validated here.

Next: connect the read-only dispatcher and a completion-aware CAN adapter under
the explicit startup/RAM/time-base requirements. The application still uses the
captured external kernel profile until that platform work is validated.
