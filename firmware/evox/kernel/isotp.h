/* SPDX-License-Identifier: GPL-3.0-only */
#ifndef EVOX_ISOTP_H
#define EVOX_ISOTP_H
#include "can.h"
#define EVOX_ISOTP_MAX 1032U
/* Classic CAN, normal addressing, fixed 7e0/7e8, half duplex. All storage is
 * caller-owned. Time is a monotonic wrapping uint32 microsecond counter; call
 * at least once per second. TX data must remain immutable until completion or
 * abort. RX bytes are published only when received != 0, until release().
 */
struct evox_isotp {
    uint8_t rx[EVOX_ISOTP_MAX];
    const uint8_t *tx;
    uint32_t activity, last_sent, separation;
    uint16_t received, total, used, tx_length, offset;
    uint8_t rx_state, tx_state, sequence, tx_sequence, block, remaining, waits;
    uint8_t pending, amount;
    struct evox_can_frame frame;
};
void evox_isotp_init(struct evox_isotp *s);
/* send: 0 started; -1 invalid/busy. tick: -2 abort on a 1-second timeout. */
int evox_isotp_send(struct evox_isotp *s, const uint8_t *data, uint16_t length, uint32_t now);
int evox_isotp_tick(struct evox_isotp *s, uint32_t now);
/* frame: 1 complete RX, 0 progress/ignored other CAN ID, -1 protocol abort,
 * -2 timeout. poll also returns -2 on timeout. Context pointers must be valid. */
int evox_isotp_frame(struct evox_isotp *s, const struct evox_can_frame *frame, uint32_t now);
/* poll: 1 stable pending frame; retry unchanged on mailbox backpressure.
 * sent must be called ONCE after actual CAN completion, before delivering an
 * ECU reply. Queue acceptance alone is insufficient. -1 = no pending frame;
 * otherwise 1 completes a TX PDU, 0 progresses the transfer.
 */
int evox_isotp_poll(struct evox_isotp *s, struct evox_can_frame *frame, uint32_t now);
int evox_isotp_sent(struct evox_isotp *s, uint32_t now);
void evox_isotp_release(struct evox_isotp *s);
#endif
