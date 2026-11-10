/* SPDX-License-Identifier: GPL-3.0-only
 * Explicit register-access transcripts; this is not a CAN peripheral emulator.
 */
#include "can.h"
#include <assert.h>
#include <stddef.h>
#include <string.h>

struct access { uint32_t address; uint8_t value; int write; };
struct transcript { const struct access *steps; size_t size; size_t cursor; };
static uint8_t read_byte(void *context, uint32_t address) {
    struct transcript *t = context;
    assert(t->cursor < t->size);
    const struct access *a = &t->steps[t->cursor++];
    assert(!a->write && a->address == address);
    return a->value;
}
static void write_byte(void *context, uint32_t address, uint8_t value) {
    struct transcript *t = context;
    assert(t->cursor < t->size);
    const struct access *a = &t->steps[t->cursor++];
    assert(a->write && a->address == address && a->value == value);
}
static void run_tx(const struct access *steps, size_t count, int expected) {
    struct transcript t = {steps, count, 0};
    const struct evox_can_io io = {&t, read_byte, write_byte};
    const struct evox_can_frame frame = {0x7e8, 2, {0x01, 0x81}};
    assert(evox_can_try_send(&io, &frame) == expected);
    assert(t.cursor == t.size);
}
int main(void) {
    static const struct access pending_tx[] = {{0x801051, 0x80, 0}};
    struct transcript completion = {pending_tx, 1, 0};
    const struct evox_can_io owner = {&completion, read_byte, write_byte};
    assert(evox_can_finish_send(&owner) == 0 && completion.cursor == 1);
    static const struct access active_tx[] = {{0x801051, 0x83, 0}};
    completion = (struct transcript){active_tx, 1, 0};
    assert(evox_can_finish_send(&owner) == 0 && completion.cursor == 1);
    static const struct access done_tx[] = {{0x801051, 1, 0}, {0x801051, 0, 1}};
    completion = (struct transcript){done_tx, 2, 0};
    assert(evox_can_finish_send(&owner) == 1 && completion.cursor == 2);
    static const struct access aborting[] = {
        {0x801051,0x0f,1}, {0x801050,0,1}, {0x801051,2,0}, {0x801050,0,0}
    };
    completion = (struct transcript){aborting, 4, 0};
    assert(evox_can_reset_slots(&owner) == 0 && completion.cursor == 4);
    static const struct access idle_slots[] = {
        {0x801051,0x0f,1}, {0x801050,0,1}, {0x801051,0,0}, {0x801050,0,0},
        {0x801051,0,1}, {0x801050,0x40,1}
    };
    completion = (struct transcript){idle_slots, 6, 0};
    assert(evox_can_reset_slots(&owner) == 1 && completion.cursor == 6);
    assert(evox_can_finish_send(NULL) == -1 && evox_can_reset_slots(NULL) == -1);

    static const struct access busy[] = {{0x801051, 0x80, 0}};
    run_tx(busy, 1, 0); /* Pending request, even before hardware accepts it. */
    static const struct access active[] = {{0x801051, 0x02, 0}};
    run_tx(active, 1, 0);
    static const struct access tx_race[] = {
        {0x801051, 0, 0}, {0x801051, 0, 1}, {0x801051, 2, 0}
    };
    run_tx(tx_race, 3, 0);
    static const struct access tx[] = {
        {0x801051, 1, 0}, {0x801051, 0, 1}, {0x801051, 0, 0},
        {0x801110, 0x1f, 1}, {0x801111, 0x28, 1}, {0x801115, 2, 1},
        {0x801116, 1, 1}, {0x801117, 0x81, 1},
        {0x801118, 0, 1}, {0x801119, 0, 1}, {0x80111a, 0, 1},
        {0x80111b, 0, 1}, {0x80111c, 0, 1}, {0x80111d, 0, 1},
        {0x801051, 0x80, 1}
    };
    run_tx(tx, sizeof tx / sizeof tx[0], 1);
    struct transcript t = {NULL, 0, 0};
    struct evox_can_io io = {&t, read_byte, write_byte};
    struct evox_can_frame frame = {0x800, 8, {0}};
    assert(evox_can_try_send(&io, &frame) == -1);
    frame.id = 0x7e8;
    frame.length = 9;
    assert(evox_can_try_send(&io, &frame) == -1);
    assert(evox_can_try_send(NULL, &frame) == -1);
    assert(evox_can_try_receive(&io, NULL) == -1);
    struct evox_can_io invalid_io = {&t, NULL, write_byte};
    assert(evox_can_try_receive(&invalid_io, &frame) == -1);
    assert(evox_can_try_send(&io, NULL) == -1);
    for (uint32_t status = 0; status < 4; status += 2) {
        struct access idle = {0x801050, (uint8_t)status, 0};
        t = (struct transcript){&idle, 1, 0};
        assert(evox_can_try_receive(&io, &frame) == 0 && t.cursor == 1);
    }
    /* RX clears completion before copying, then rechecks for a raced frame. */
    static const struct access rx[] = {
        {0x801050, 0x41, 0}, {0x801050, 0x40, 1}, {0x801050, 0x40, 0},
        {0x801100, 0x1f, 0}, {0x801101, 0x20, 0}, {0x801105, 2, 0},
        {0x801106, 1, 0}, {0x801107, 3, 0}, {0x801050, 0x40, 0}
    };
    t = (struct transcript){rx, sizeof rx / sizeof rx[0], 0};
    assert(evox_can_try_receive(&io, &frame) == 1);
    assert(t.cursor == t.size && frame.id == 0x7e0 && frame.length == 2);
    assert(frame.data[0] == 1 && frame.data[1] == 3 && frame.data[7] == 0);
    struct access raced[sizeof rx / sizeof rx[0]];
    for (size_t i = 0; i < sizeof rx / sizeof rx[0]; ++i) raced[i] = rx[i];
    raced[sizeof rx / sizeof rx[0] - 1].value = 0x41;
    t = (struct transcript){raced, sizeof raced / sizeof raced[0], 0};
    frame.id = 123;
    assert(evox_can_try_receive(&io, &frame) == -2);
    assert(frame.id == 123 && t.cursor == t.size);
    /* Message-lost, remote-frame and in-progress snapshots must not escape. */
    for (size_t variant = 0; variant < 4; ++variant) {
        for (size_t i = 0; i < sizeof rx / sizeof rx[0]; ++i) raced[i] = rx[i];
        if (variant == 0) raced[0].value |= 4;
        if (variant == 1) raced[0].value |= 0x20;
        if (variant == 2) raced[sizeof rx / sizeof rx[0] - 1].value |= 2;
        if (variant == 3) raced[sizeof rx / sizeof rx[0] - 1].value |= 4;
        t = (struct transcript){raced, sizeof raced / sizeof raced[0], 0};
        unsigned char previous[sizeof frame];
        memcpy(previous, &frame, sizeof frame);
        assert(evox_can_try_receive(&io, &frame) == -2);
        assert(memcmp(&frame, previous, sizeof frame) == 0 && t.cursor == t.size);
    }
    /* Reject an invalid DLC before attempting a data-buffer read. */
    for (size_t i = 0; i < 6; ++i) raced[i] = rx[i];
    raced[5].value = 9;
    t = (struct transcript){raced, 6, 0};
    assert(evox_can_try_receive(&io, &frame) == -2 && t.cursor == 6);
    return 0;
}
