/* SPDX-License-Identifier: GPL-3.0-only */
#include "../platform/flash.h"
#include <assert.h>
static struct evox_flash_snapshot normal = {0, 0x11, 0x80, 0};
int main(void) {
    struct evox_flash_gate gate;
    struct evox_flash_snapshot s = normal;
    assert(evox_flash_normal(&s)); /* External FP high is compatible with normal reads. */
    assert(!evox_flash_init(&gate, 0, 100, 4, 1));
    assert(evox_flash_step(&gate, &s, 0) == EVOX_FLASH_DENY);
    assert(!evox_flash_init(&gate, 1, 32768, 4, 1));
    assert(!evox_flash_init(&gate, 1, 100, 0, 1));
    assert(!evox_flash_init(&gate, 1, 100, 33, 1));
    assert(!evox_flash_init(&gate, 1, 100, 4, 2));
    assert(evox_flash_init(&gate, 1, 100, 4, 0));
    assert(evox_flash_step(&gate, &s, 0) == EVOX_FLASH_READY);
    s.status = 0; /* Fault after admission is latched. */
    assert(evox_flash_step(&gate, &s, 0) == EVOX_FLASH_DENY);
    s = normal;
    assert(evox_flash_step(&gate, &s, 0) == EVOX_FLASH_DENY);
    const struct evox_flash_snapshot denied[] = {
        {1, 0x10, 0x80, 0}, {0x11, 0x10, 0x80, 0}, {0x10, 0, 0x80, 0},
        {0x10, 0x10, 0, 0}, {0x10, 0x10, 0x80, 1}, {0xff, 0x10, 0x80, 0}
    };
    for (unsigned i = 0; i < sizeof(denied) / sizeof(denied[0]); ++i) {
        assert(evox_flash_init(&gate, 1, 100, 4, 1));
        assert(evox_flash_step(&gate, &denied[i], 0) == EVOX_FLASH_DENY);
    }
    s.control = 0x10;
    assert(evox_flash_init(&gate, 1, 100, 4, 0));
    assert(evox_flash_step(&gate, &s, 0) == EVOX_FLASH_DENY); /* No exit attestation. */
    assert(evox_flash_init(&gate, 2, 100, 4, 1));
    assert(evox_flash_step(&gate, &s, 65535) == EVOX_FLASH_CLEAR);
    s = normal; /* Transcript owner performs exactly FCNT1 <- 0 on CLEAR. */
    assert(evox_flash_step(&gate, &s, 0) == EVOX_FLASH_WAIT);
    assert(evox_flash_step(&gate, &s, 1) == EVOX_FLASH_READY);
    assert(evox_flash_step(&gate, &s, 1) == EVOX_FLASH_READY);
    assert(evox_flash_init(&gate, 1, 100, 2, 1));
    s.control = 0x10;
    assert(evox_flash_step(&gate, &s, 0) == EVOX_FLASH_CLEAR);
    assert(evox_flash_step(&gate, &s, 1) == EVOX_FLASH_DENY); /* Clear did not stick. */
    s = normal;
    assert(evox_flash_init(&gate, 2, 100, 2, 1));
    s.control = 0x10; assert(evox_flash_step(&gate, &s, 0) == EVOX_FLASH_CLEAR); s = normal;
    assert(evox_flash_step(&gate, &s, 0) == EVOX_FLASH_WAIT);
    assert(evox_flash_step(&gate, &s, 0) == EVOX_FLASH_DENY); /* Stalled clock: finite budget. */
    assert(evox_flash_init(&gate, 1, 100, 4, 1));
    s.control = 0x10; assert(evox_flash_step(&gate, &s, 0) == EVOX_FLASH_CLEAR); s = normal;
    assert(evox_flash_step(&gate, &s, 101) == EVOX_FLASH_DENY);
    return 0;
}
