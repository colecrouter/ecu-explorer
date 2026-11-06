/* SPDX-License-Identifier: GPL-3.0-only
 * Bounded normal-address ISO-TP state machine; no MMIO or blocking waits.
 */
#include "isotp.h"
#define RX_FC 1U
#define RX_CF 2U
#define RX_READY 3U
#define TX_FIRST 1U
#define TX_FLOW 2U
#define TX_CF 3U
#define P_SINGLE 1U
#define P_FIRST 2U
#define P_CF 3U
#define P_CTS 4U
#define P_OVERFLOW 5U

void evox_isotp_init(struct evox_isotp *s) {
    s->tx = 0;
    s->received = s->total = s->used = s->tx_length = s->offset = 0;
    s->activity = s->last_sent = s->separation = 0;
    s->rx_state = s->tx_state = s->sequence = s->tx_sequence = 0;
    s->block = s->remaining = s->waits = s->pending = s->amount = 0;
}
static int abort_transfer(struct evox_isotp *s, int error) {
    s->tx_state = s->pending = 0;
    s->tx = 0;
    if (s->rx_state != RX_READY) {
        s->rx_state = 0;
        s->received = s->total = s->used = 0;
    }
    return error;
}
int evox_isotp_tick(struct evox_isotp *s, uint32_t now) {
    if ((s->tx_state || s->pending || s->rx_state == RX_FC || s->rx_state == RX_CF) &&
        (uint32_t)(now - s->activity) >= UINT32_C(1000000))
        return abort_transfer(s, -2);
    return 0;
}
int evox_isotp_send(struct evox_isotp *s, const uint8_t *data, uint16_t length, uint32_t now) {
    if (data == 0 || length == 0 || length > EVOX_ISOTP_MAX || s->tx_state || s->pending || s->rx_state)
        return -1;
    s->tx = data;
    s->tx_length = length;
    s->offset = 0;
    s->tx_sequence = 1;
    s->waits = 0;
    s->tx_state = TX_FIRST;
    s->activity = now;
    return 0;
}
void evox_isotp_release(struct evox_isotp *s) {
    if (s->rx_state == RX_READY) s->rx_state = 0;
    s->received = 0;
}
static void prepare(struct evox_isotp *s, uint8_t kind) {
    s->frame.id = 0x7e8;
    s->frame.length = 8;
    for (uint32_t i = 0; i < 8; ++i) s->frame.data[i] = 0;
    s->pending = kind;
}
int evox_isotp_poll(struct evox_isotp *s, struct evox_can_frame *frame, uint32_t now) {
    int timed = evox_isotp_tick(s, now);
    if (timed) return timed;
    if (frame == 0) return -1;
    if (!s->pending && s->tx_state == TX_FIRST) {
        prepare(s, s->tx_length <= 7 ? P_SINGLE : P_FIRST);
        uint8_t start;
        if (s->pending == P_SINGLE) {
            s->frame.data[0] = (uint8_t)s->tx_length;
            start = 1;
            s->amount = (uint8_t)s->tx_length;
        } else {
            s->frame.data[0] = (uint8_t)(0x10U | (s->tx_length >> 8));
            s->frame.data[1] = (uint8_t)s->tx_length;
            start = 2;
            s->amount = 6;
        }
        for (uint32_t i = 0; i < s->amount; ++i) s->frame.data[start + i] = s->tx[i];
    } else if (!s->pending && s->tx_state == TX_CF &&
               (uint32_t)(now - s->last_sent) >= s->separation) {
        prepare(s, P_CF);
        s->frame.data[0] = (uint8_t)(0x20U | s->tx_sequence);
        uint16_t left = (uint16_t)(s->tx_length - s->offset);
        s->amount = (uint8_t)(left > 7 ? 7 : left);
        for (uint32_t i = 0; i < s->amount; ++i) s->frame.data[i + 1U] = s->tx[s->offset + i];
    }
    if (!s->pending) return 0;
    frame->id = s->frame.id;
    frame->length = 8;
    for (uint32_t i = 0; i < 8; ++i) frame->data[i] = s->frame.data[i];
    return 1;
}
int evox_isotp_sent(struct evox_isotp *s, uint32_t now) {
    int timed = evox_isotp_tick(s, now);
    if (timed) return timed;
    uint8_t kind = s->pending;
    if (!kind) return -1;
    s->pending = 0;
    s->activity = s->last_sent = now;
    if (kind == P_CTS) { s->rx_state = RX_CF; return 0; }
    if (kind == P_OVERFLOW) return 0;
    s->offset = (uint16_t)(s->offset + s->amount);
    if (s->offset == s->tx_length) { s->tx_state = 0; s->tx = 0; return 1; }
    if (kind == P_FIRST) s->tx_state = TX_FLOW;
    else {
        s->tx_sequence = (uint8_t)((s->tx_sequence + 1U) & 15U);
        if (s->block && --s->remaining == 0) s->tx_state = TX_FLOW;
    }
    return 0;
}
int evox_isotp_frame(struct evox_isotp *s, const struct evox_can_frame *f, uint32_t now) {
    int timed = evox_isotp_tick(s, now);
    if (timed) return timed;
    if (f == 0) return -1;
    if (f->id != 0x7e0) return 0;
    if (f->length == 0 || f->length > 8) return abort_transfer(s, -1);
    uint8_t type = (uint8_t)(f->data[0] >> 4);
    if (type == 3) {
        if (s->tx_state != TX_FLOW || s->pending || f->length < 3) return abort_transfer(s, -1);
        uint8_t status = (uint8_t)(f->data[0] & 15U);
        if (status == 1 && ++s->waits <= 3) { s->activity = now; return 0; }
        if (status != 0) return abort_transfer(s, -1);
        uint8_t st = f->data[2];
        if (st <= 0x7f) s->separation = (uint32_t)st * 1000U;
        else if (st >= 0xf1 && st <= 0xf9) s->separation = (uint32_t)(st - 0xf0U) * 100U;
        else return abort_transfer(s, -1);
        s->block = s->remaining = f->data[1];
        s->waits = 0;
        s->tx_state = TX_CF;
        s->activity = s->last_sent = now;
        return 0;
    }
    if (s->tx_state || s->pending || s->rx_state == RX_READY) return abort_transfer(s, -1);
    if (type == 0) {
        uint8_t size = (uint8_t)(f->data[0] & 15U);
        if (s->rx_state || size == 0 || size > 7 || f->length < size + 1U) return abort_transfer(s, -1);
        for (uint32_t i = 0; i < size; ++i) s->rx[i] = f->data[i + 1U];
        s->received = size;
        s->rx_state = RX_READY;
        return 1;
    }
    if (type == 1) {
        if (s->rx_state || f->length != 8) return abort_transfer(s, -1);
        uint16_t size = (uint16_t)(((uint16_t)(f->data[0] & 15U) << 8) | f->data[1]);
        if (size <= 7) return abort_transfer(s, -1);
        if (size > EVOX_ISOTP_MAX) { prepare(s, P_OVERFLOW); s->frame.data[0] = 0x32; s->activity = now; return 0; }
        s->total = size;
        s->used = 6;
        s->sequence = 1;
        for (uint32_t i = 0; i < 6; ++i) s->rx[i] = f->data[i + 2U];
        s->rx_state = RX_FC;
        prepare(s, P_CTS);
        s->frame.data[0] = 0x30;
        s->activity = now;
        return 0;
    }
    if (type == 2 && s->rx_state == RX_CF) {
        uint16_t left = (uint16_t)(s->total - s->used);
        uint8_t size = (uint8_t)(left > 7 ? 7 : left);
        if ((f->data[0] & 15U) != s->sequence || f->length < size + 1U) return abort_transfer(s, -1);
        for (uint32_t i = 0; i < size; ++i) s->rx[s->used + i] = f->data[i + 1U];
        s->used = (uint16_t)(s->used + size);
        s->sequence = (uint8_t)((s->sequence + 1U) & 15U);
        s->activity = now;
        if (s->used == s->total) { s->received = s->total; s->rx_state = RX_READY; return 1; }
        return 0;
    }
    return abort_transfer(s, -1);
}
