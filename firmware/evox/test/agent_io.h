/* SPDX-License-Identifier: GPL-3.0-only
 * Test register bank with manually injected completion/busy/race events.
 * This is not an emulation of CAN arbitration, timers or silicon.
 */
#include "../kernel/agent.h"
struct test_bus {
    uint8_t registers[512];
    struct evox_can_frame last;
    uint32_t queued, rx_accesses, rom_calls, rom_address, bad;
    uint16_t rom_length;
    uint8_t hold_abort, rx_busy, race, rom_fail;
};
static inline void bus_init(struct test_bus *b) {
    for (uint32_t i = 0; i < 512; ++i) b->registers[i] = 0;
    b->queued = b->rx_accesses = b->rom_calls = b->rom_address = b->bad = 0;
    b->rom_length = 0;
    b->hold_abort = b->rx_busy = b->race = b->rom_fail = 0;
}
static inline uint8_t bus_read(void *context, uint32_t address) {
    struct test_bus *b = context;
    if (address < 0x801000 || address >= 0x801200) { ++b->bad; return 0; }
    uint32_t offset = address - 0x801000U;
    if (offset == 0x50 || (offset >= 0x100 && offset <= 0x10d)) ++b->rx_accesses;
    if (b->race && offset >= 0x106 && offset <= 0x10d) b->registers[0x50] = 0x41;
    return b->registers[offset];
}
static inline void bus_write(void *context, uint32_t address, uint8_t value) {
    struct test_bus *b = context;
    if (address < 0x801000 || address >= 0x801200) { ++b->bad; return; }
    uint32_t offset = address - 0x801000U;
    if (offset == 0x51 && value == 0x0f) value = b->hold_abort ? 2 : 0;
    if (offset == 0x50 && value == 0 && b->rx_busy) value = 2;
    b->registers[offset] = value;
    if (offset == 0x51 && value == 0x80) {
        ++b->queued;
        b->last.id = (uint16_t)(((uint16_t)b->registers[0x110] << 6) | b->registers[0x111]);
        b->last.length = b->registers[0x115];
        for (uint32_t i = 0; i < 8; ++i) b->last.data[i] = b->registers[0x116U + i];
    }
}
static inline int bus_rom(void *context, uint32_t address, uint8_t *bytes, uint16_t length) {
    struct test_bus *b = context;
    ++b->rom_calls; b->rom_address = address; b->rom_length = length;
    if (address >= 0x100000 || length == 0 || length > 1024 || length > 0x100000U - address) {
        ++b->bad; return 0;
    }
    for (uint32_t i = 0; i < length; ++i) bytes[i] = (uint8_t)(address + i);
    return !b->rom_fail;
}
static inline void bus_inject(struct test_bus *b, const uint8_t *data, uint8_t length) {
    b->registers[0x100] = 0x1f; b->registers[0x101] = 0x20;
    b->registers[0x105] = length;
    for (uint32_t i = 0; i < 8; ++i) b->registers[0x106U + i] = i < length ? data[i] : 0;
    b->registers[0x50] = 0x41;
}
