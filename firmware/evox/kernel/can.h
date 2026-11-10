/* SPDX-License-Identifier: GPL-3.0-only */
#ifndef EVOX_CAN_H
#define EVOX_CAN_H
#include <stdint.h>

/* The caller must exclusively own CAN0 slots 0 (RX) and 1 (TX), with standard
 * data-frame mode, bitrate/filter setup and interrupt exclusion established.
 * Byte callbacks perform ordered accesses; the callback context must be valid.
 * No clocks, interrupt masks, pin mux or peripheral resets are changed here.
 */
struct evox_can_io {
    void *context;
    uint8_t (*read8)(void *context, uint32_t address);
    void (*write8)(void *context, uint32_t address, uint8_t value);
};
struct evox_can_frame {
    uint16_t id;
    uint8_t length;
    uint8_t data[8];
};
/* 1 = queued (not completed), 0 = busy, -1 = invalid input. No unbounded waits. */
int evox_can_try_send(const struct evox_can_io *io, const struct evox_can_frame *frame);
/* 1 = stable frame, 0 = no frame/busy, -1 = invalid input, -2 = discarded frame.
 * Output is unchanged unless 1 is returned; the caller retries after a discard.
 */
int evox_can_try_receive(const struct evox_can_io *io, struct evox_can_frame *frame);
/* Owned in-flight slot only: 1 consumes completion once, 0 remains pending,
 * -1 invalid IO. An idle/aborted slot without completion does not imply success;
 * the adapter's deadline bounds that case. */
int evox_can_finish_send(const struct evox_can_io *io);
/* Recovery only: request TX abort and disable RX; return 0 while either slot
 * is active, 1 after clearing TX/stale RX and rearming RX, -1 invalid IO.
 * Repeated calls are bounded; preserve the existing slot filters/configuration.
 */
int evox_can_reset_slots(const struct evox_can_io *io);
#endif
