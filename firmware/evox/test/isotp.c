/* SPDX-License-Identifier: GPL-3.0-only */
#include "isotp.h"
#include <assert.h>
#include <string.h>
#include "isotp-version.h"

static struct evox_can_frame input(const uint8_t *bytes, uint8_t length) {
    struct evox_can_frame f = {0x7e0, length, {0}};
    for (uint32_t i = 0; i < length; ++i) f.data[i] = bytes[i];
    return f;
}
static void packet(struct evox_isotp *s, const uint8_t *bytes, uint8_t length, uint32_t now, int result) {
    struct evox_can_frame f = input(bytes, length);
    assert(evox_isotp_frame(s, &f, now) == result);
}
/* Public version exchange, original candump lines 742-750, session sample 1.
 * Source SHA-256 fab438cc369b45298786927d729920a8db5b6dbdc2e72a9987f6576fda39e5ee.
 * Version text only; no ROM or executable payload is included.
 */
static void captured_version(void) {
    struct evox_isotp s;
    struct evox_can_frame out;
    evox_isotp_init(&s);
    const uint8_t request[] = {1,1,0,0,0,0,0,0};
    packet(&s, request, 8, 0, 1);
    assert(s.received == 1 && s.rx[0] == 1);
    evox_isotp_release(&s);
    assert(sizeof version_reply == 44 && evox_isotp_send(&s, version_reply, sizeof version_reply, 0) == 0);
    for (uint32_t i = 0; i < 7; ++i) {
        assert(evox_isotp_poll(&s, &out, i * 10U) == 1);
        assert(memcmp(out.data, version_frames[i], 8) == 0);
        assert(evox_isotp_sent(&s, i * 10U + 1U) == (i == 6 ? 1 : 0));
        if (i == 0) {
            const uint8_t fc[] = {0x30,0,0,0,0,0,0,0};
            packet(&s, fc, 8, 2, 0);
        }
    }
}
static void all_lengths(void) {
    uint8_t source[1032];
    for (uint32_t i = 0; i < sizeof source; ++i) source[i] = (uint8_t)(i * 37U);
    for (uint16_t length = 1; length <= 1032; ++length) {
        struct evox_isotp sender, receiver;
        struct evox_can_frame out;
        evox_isotp_init(&sender);
        evox_isotp_init(&receiver);
        assert(evox_isotp_send(&sender, source, length, 0) == 0);
        uint16_t position = 0;
        uint8_t sequence = 1;
        uint32_t now = 0;
        int completed = 0;
        while (!completed) {
            assert(evox_isotp_poll(&sender, &out, now) == 1);
            uint8_t first = position == 0 ? (length <= 7 ? 1 : 2) : 1;
            uint8_t count = (uint8_t)(length - position > 8U - first ? 8U - first : length - position);
            if (position == 0) {
                assert(out.data[0] == (length <= 7 ? length : (0x10U | (length >> 8))));
                if (length > 7) assert(out.data[1] == (uint8_t)length);
            } else {
                assert(out.data[0] == (uint8_t)(0x20U | sequence));
                sequence = (uint8_t)((sequence + 1U) & 15U);
            }
            assert(memcmp(out.data + first, source + position, count) == 0);
            for (uint32_t i = first + count; i < 8; ++i) assert(out.data[i] == 0);
            position = (uint16_t)(position + count);
            completed = evox_isotp_sent(&sender, now);
            assert(completed == (position == length ? 1 : 0));
            out.id = 0x7e0;
            assert(evox_isotp_frame(&receiver, &out, now) == completed);
            if (length > 7 && position == 6) {
                assert(evox_isotp_poll(&receiver, &out, now) == 1);
                assert(out.data[0] == 0x30 && out.data[1] == 0 && out.data[2] == 0);
                assert(evox_isotp_sent(&receiver, now) == 0);
                out.id = 0x7e0;
                assert(evox_isotp_frame(&sender, &out, now) == 0);
            }
            ++now;
        }
        assert(receiver.received == length && memcmp(receiver.rx, source, length) == 0);
    }
}
static void errors_and_flow(void) {
    struct evox_isotp s;
    struct evox_can_frame out;
    uint8_t data[64] = {0};
    const uint8_t ff[] = {0x10,8,0,1,2,3,4,5};
    const uint8_t flow[] = {0x30,1,0xf1};
    const uint8_t wait[] = {0x31,0,0};
    const uint8_t overflow[] = {0x32,0,0};
    const uint8_t oversize[] = {0x14,9,0,0,0,0,0,0};
    evox_isotp_init(&s);
    assert(evox_isotp_sent(&s, 0) == -1);
    packet(&s, oversize, 8, 0, 0);
    assert(evox_isotp_poll(&s, &out, 0) == 1 && out.data[0] == 0x32);
    assert(evox_isotp_sent(&s, 1) == 0 && s.received == 0);
    for (uint32_t i = 0; i < 3; ++i) {
        const uint8_t bad[] = {0,8,0x81};
        packet(&s, &bad[i], 1, 2, -1);
    }
    packet(&s, ff, 7, 3, -1);
    packet(&s, ff, 8, 4, 0);
    const uint8_t cf[] = {0x21,6,7};
    packet(&s, cf, 3, 5, -1); /* No CF admitted before CTS completion. */
    assert(evox_isotp_send(&s, data, 64, 6) == 0);
    assert(evox_isotp_send(&s, data, 64, 6) == -1);
    assert(evox_isotp_poll(&s, &out, 6) == 1 && evox_isotp_sent(&s, 7) == 0);
    packet(&s, flow, 3, 8, 0);
    assert(evox_isotp_poll(&s, &out, 107) == 0);
    assert(evox_isotp_poll(&s, &out, 108) == 1);
    assert(evox_isotp_sent(&s, 109) == 0);
    assert(evox_isotp_poll(&s, &out, 500) == 0); /* Block size one requires new CTS. */
    for (uint32_t i = 0; i < 3; ++i) packet(&s, wait, 3, 501U + i, 0);
    packet(&s, wait, 3, 504, -1);
    assert(evox_isotp_send(&s, data, 64, 600) == 0);
    assert(evox_isotp_poll(&s, &out, 600) == 1 && evox_isotp_sent(&s, 600) == 0);
    packet(&s, overflow, 3, 601, -1);
    assert(evox_isotp_send(&s, data, 64, 700) == 0);
    assert(evox_isotp_poll(&s, &out, 700) == 1 && evox_isotp_sent(&s, 700) == 0);
    const uint8_t reserved[] = {0x30,0,0x80};
    packet(&s, reserved, 3, 701, -1);
    assert(evox_isotp_send(&s, data, 64, 800) == 0);
    assert(evox_isotp_poll(&s, &out, 800) == 1 && evox_isotp_sent(&s, 800) == 0);
    assert(evox_isotp_tick(&s, 1000800) == -2); /* FC never arrived. */
    packet(&s, ff, 8, 1000900, 0);
    assert(evox_isotp_poll(&s, &out, 1000900) == 1 && evox_isotp_sent(&s, 1000900) == 0);
    packet(&s, cf, 2, 1000901, -1); /* Truncated final CF. */
    const uint8_t sf[] = {1,1};
    packet(&s, sf, 2, 1000902, 1); /* Recovery after abort. */
    assert(evox_isotp_send(&s, data, 1, 1000903) == -1); /* Published RX is retained. */
}
static void timing_and_malformed(void) {
    struct evox_isotp s;
    struct evox_can_frame f;
    uint8_t bytes[8] = {0};
    for (uint32_t st = 0; st < 256; ++st) {
        evox_isotp_init(&s);
        assert(evox_isotp_send(&s, bytes, 8, 0) == 0);
        assert(evox_isotp_poll(&s, &f, 0) == 1 && evox_isotp_sent(&s, 0) == 0);
        uint8_t flow[] = {0x30,0,(uint8_t)st};
        int valid = st <= 0x7f || (st >= 0xf1 && st <= 0xf9);
        packet(&s, flow, 3, 1, valid ? 0 : -1);
        if (valid) {
            uint32_t us = st <= 0x7f ? st * 1000U : (st - 0xf0U) * 100U;
            if (us) assert(evox_isotp_poll(&s, &f, us) == 0);
            assert(evox_isotp_poll(&s, &f, us + 1U) == 1);
            assert(evox_isotp_sent(&s, us + 2U) == 1);
        }
    }
    for (uint8_t status = 3; status < 16; ++status) {
        evox_isotp_init(&s);
        assert(evox_isotp_send(&s, bytes, 8, 0) == 0);
        assert(evox_isotp_poll(&s, &f, 0) == 1 && evox_isotp_sent(&s, 0) == 0);
        uint8_t flow[] = {(uint8_t)(0x30U | status),0,0};
        packet(&s, flow, 3, 1, -1);
    }
    evox_isotp_init(&s);
    assert(evox_isotp_send(&s, bytes, 8, 0xfffffff0U) == 0);
    assert(evox_isotp_poll(&s, &f, 0xfffffff0U) == 1);
    assert(evox_isotp_sent(&s, 0xfffffff0U) == 0);
    const uint8_t flow[] = {0x30,0,1};
    packet(&s, flow, 3, 0xfffffff1U, 0);
    assert(evox_isotp_poll(&s, &f, 984) == 0);
    assert(evox_isotp_poll(&s, &f, 985) == 1);
    assert(evox_isotp_sent(&s, 986) == 1);
    assert(evox_isotp_send(&s, bytes, 1, 1000) == 0);
    f.id = 0x123; f.length = 8;
    assert(evox_isotp_frame(&s, &f, 999999) == 0);
    assert(evox_isotp_tick(&s, 1001000) == -2); /* Unrelated CAN frames do not extend deadlines. */
    const uint8_t ff[] = {0x10,8,0,1,2,3,4,5};
    packet(&s, ff, 8, 1002000, 0);
    assert(evox_isotp_poll(&s, &f, 1002000) == 1 && evox_isotp_sent(&s, 1002000) == 0);
    const uint8_t cf[] = {0x21,6,7};
    packet(&s, cf, 3, 1002001, 1);
    assert(s.received == 8 && s.rx[7] == 7);
    packet(&s, cf, 3, 1002002, -1);
    assert(s.received == 8 && s.rx[7] == 7); /* Retain completed RX until release. */
    evox_isotp_release(&s);
    f.id = 0x7e0; f.length = 9;
    assert(evox_isotp_frame(&s, &f, 1002003) == -1);
    assert(evox_isotp_poll(&s, 0, 1002003) == -1);
    assert(evox_isotp_send(&s, bytes, 1033, 0) == -1);
    assert(evox_isotp_send(&s, bytes, 0, 0) == -1);
    assert(evox_isotp_send(&s, 0, 1, 0) == -1);
}
int main(void) {
    timing_and_malformed();
    captured_version();
    all_lengths();
    errors_and_flow();
    struct evox_isotp s;
    struct evox_can_frame out, again;
    uint8_t data[1032];
    for (uint32_t i = 0; i < sizeof data; ++i) data[i] = (uint8_t)i;
    evox_isotp_init(&s);
    const uint8_t read[] = {7,3,0,0,0,0,4,0};
    packet(&s, read, 8, 0, 1);
    assert(s.received == 7 && s.rx[0] == 3 && s.rx[5] == 4);
    evox_isotp_release(&s);
    assert(evox_isotp_send(&s, data, 8, 1) == 0);
    assert(evox_isotp_poll(&s, &out, 1) == 1);
    assert(out.id == 0x7e8 && out.length == 8 && out.data[0] == 0x10 && out.data[1] == 8);
    assert(evox_isotp_poll(&s, &again, 2) == 1 && out.id == again.id && out.length == again.length && memcmp(out.data, again.data, 8) == 0);
    assert(evox_isotp_sent(&s, 3) == 0);
    const uint8_t fc[] = {0x30, 0, 1};
    packet(&s, fc, 3, 4, 0);
    assert(evox_isotp_poll(&s, &out, 1003) == 0);
    assert(evox_isotp_poll(&s, &out, 1004) == 1 && out.data[0] == 0x21 && out.data[1] == 6 && out.data[2] == 7);
    assert(evox_isotp_sent(&s, 1005) == 1);
    /* A lost/incorrect sequence never publishes partial bytes. */
    const uint8_t ff[] = {0x10,8,0,1,2,3,4,5};
    packet(&s, ff, 8, 2000, 0);
    assert(evox_isotp_poll(&s, &out, 2000) == 1 && out.data[0] == 0x30);
    assert(evox_isotp_sent(&s, 2001) == 0);
    const uint8_t wrong[] = {0x22,6,7};
    packet(&s, wrong, 3, 2002, -1);
    assert(s.received == 0);
    packet(&s, ff, 8, 3000, 0);
    assert(evox_isotp_tick(&s, 1003000) == -2 && s.received == 0);
    /* Unsigned elapsed time across a microsecond counter wrap. */
    assert(evox_isotp_send(&s, data, 1, 0xfffffff0U) == 0);
    assert(evox_isotp_tick(&s, 10) == 0);
    assert(evox_isotp_tick(&s, 1000000) == -2);
    return 0;
}
