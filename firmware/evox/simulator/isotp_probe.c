/* SPDX-License-Identifier: GPL-3.0-only
 * Simulation-only ISO-TP contracts. The context is in a bounded mapped arena;
 * sentinel memory outside it and outside a 256-byte stack budget is checked.
 */
#include "../kernel/isotp.h"
#include "../test/isotp-version.h"
#define CHECK(condition) do { if (!(condition)) return 0; } while (0)
_Static_assert(sizeof(struct evox_isotp) <= 1100, "probe context exceeds mapped allowance");
static int same(const uint8_t *a, const uint8_t *b, uint32_t size) {
    for (uint32_t i = 0; i < size; ++i) if (a[i] != b[i]) return 0;
    return 1;
}
uint32_t evox_isotp_probe(uint32_t scenario, struct evox_isotp *s, struct evox_can_frame *f) {
    evox_isotp_init(s);
    if (scenario == 0) {
        CHECK(evox_isotp_send(s, version_reply, sizeof version_reply, 0) == 0);
        for (uint32_t i = 0; i < 7; ++i) {
            CHECK(evox_isotp_poll(s, f, i * 10U) == 1);
            CHECK(f->id == 0x7e8 && f->length == 8 && same(f->data, version_frames[i], 8));
            CHECK(evox_isotp_sent(s, i * 10U + 1U) == (i == 6 ? 1 : 0));
            if (i == 0) {
                f->id = 0x7e0; f->length = 3;
                f->data[0] = 0x30; f->data[1] = 0; f->data[2] = 0;
                CHECK(evox_isotp_frame(s, f, 2) == 0);
            }
        }
        return 1;
    }
    if (scenario == 1) {
        f->id = 0x7e0; f->length = 8;
        f->data[0] = 0x14; f->data[1] = 8;
        for (uint32_t i = 0; i < 6; ++i) f->data[i + 2U] = (uint8_t)i;
        CHECK(evox_isotp_frame(s, f, 0) == 0);
        CHECK(evox_isotp_poll(s, f, 0) == 1 && f->data[0] == 0x30);
        CHECK(evox_isotp_sent(s, 0) == 0);
        uint32_t offset = 6, sequence = 1;
        while (offset < 1032) {
            f->id = 0x7e0; f->length = 8;
            f->data[0] = (uint8_t)(0x20U | sequence);
            uint32_t size = 1032U - offset;
            if (size > 7) size = 7;
            for (uint32_t i = 0; i < 7; ++i) f->data[i + 1U] = (uint8_t)(offset + i);
            CHECK(evox_isotp_frame(s, f, offset) == (offset + size == 1032 ? 1 : 0));
            offset += size; sequence = (sequence + 1U) & 15U;
        }
        CHECK(s->received == 1032);
        for (uint32_t i = 0; i < 1032; ++i) CHECK(s->rx[i] == (uint8_t)i);
        return 1;
    }
    CHECK(scenario == 2);
    /* Zero-copy TX may borrow the released RX buffer. */
    for (uint32_t i = 0; i < 64; ++i) s->rx[i] = (uint8_t)i;
    CHECK(evox_isotp_send(s, s->rx, 64, 0) == 0);
    CHECK(evox_isotp_poll(s, f, 0) == 1 && f->data[0] == 0x10);
    CHECK(evox_isotp_sent(s, 0) == 0);
    uint32_t offset = 6, now = 1, sequence = 1;
    while (offset < 64) {
        f->id = 0x7e0; f->length = 3;
        f->data[0] = 0x30; f->data[1] = 1; f->data[2] = 0xf1;
        CHECK(evox_isotp_frame(s, f, now) == 0);
        CHECK(evox_isotp_poll(s, f, now + 99U) == 0);
        CHECK(evox_isotp_poll(s, f, now + 100U) == 1);
        CHECK(f->data[0] == (uint8_t)(0x20U | sequence));
        uint32_t size = 64U - offset;
        if (size > 7) size = 7;
        for (uint32_t i = 0; i < size; ++i) CHECK(f->data[i + 1U] == (uint8_t)(offset + i));
        offset += size;
        CHECK(evox_isotp_sent(s, now + 101U) == (offset == 64 ? 1 : 0));
        if (offset < 64) CHECK(evox_isotp_poll(s, f, now + 102U) == 0);
        ++sequence; now += 103U;
    }
    return 1;
}
