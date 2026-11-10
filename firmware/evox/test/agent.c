/* SPDX-License-Identifier: GPL-3.0-only */
#include "agent_io.h"
#include <assert.h>
#include <string.h>
static void setup(struct evox_agent *a, struct test_bus *b, struct evox_can_io *can, struct evox_rom_io *rom) {
    bus_init(b);
    can->context = b; can->read8 = bus_read; can->write8 = bus_write;
    rom->context = b; rom->read = bus_rom;
    evox_agent_init(a);
    assert(evox_agent_step(a, can, rom, 0) == -1); /* Recovery/arming required. */
    assert(evox_agent_recover(a, can) == 1);
}
int main(void) {
    struct evox_agent a;
    struct test_bus b;
    struct evox_can_io can;
    struct evox_rom_io rom;
    setup(&a, &b, &can, &rom);
    const uint8_t read8[] = {7,3,0,0,0,0x10,0,8};
    const uint8_t flow[] = {0x30,0,0};
    bus_inject(&b, read8, 8);
    b.registers[0x51] = 1; /* Stale completion must not complete our new FF. */
    assert(evox_agent_step(&a, &can, &rom, 1) == 0 && b.queued == 1 && a.inflight);
    const uint8_t ff[] = {0x10,9,0x83,0x10,0x11,0x12,0x13,0x14};
    assert(memcmp(b.last.data, ff, 8) == 0 && b.rom_calls == 1);
    bus_inject(&b, flow, 3);
    uint32_t reads = b.rx_accesses;
    assert(evox_agent_step(&a, &can, &rom, 2) == 0 && b.queued == 1 && b.rx_accesses == reads);
    b.registers[0x51] = 1;
    assert(evox_agent_step(&a, &can, &rom, 3) == 0 && b.queued == 2 && !a.fault);
    const uint8_t cf[] = {0x21,0x15,0x16,0x17,0,0,0,0};
    assert(memcmp(b.last.data, cf, 8) == 0);
    b.registers[0x51] = 1;
    assert(evox_agent_step(&a, &can, &rom, 4) == 0 && !a.inflight && b.queued == 2);
    /* Backpressure: prepare/dispatch once and retain bytes until admitted. */
    setup(&a, &b, &can, &rom);
    b.registers[0x51] = 0x80;
    bus_inject(&b, read8, 8);
    assert(evox_agent_step(&a, &can, &rom, 10) == 0 && b.queued == 0 && b.rom_calls == 1);
    assert(evox_agent_step(&a, &can, &rom, 11) == 0 && b.queued == 0 && b.rom_calls == 1);
    b.registers[0x51] = 0;
    assert(evox_agent_step(&a, &can, &rom, 12) == 0 && b.queued == 1);
    bus_inject(&b, flow, 3);
    assert(evox_agent_step(&a, &can, &rom, 1000010) == -2 && a.fault);
    assert(evox_agent_step(&a, &can, &rom, 1000011) == -1 && b.queued == 1);
    b.hold_abort = 1;
    assert(evox_agent_recover(&a, &can) == 0 && a.fault);
    assert(evox_agent_step(&a, &can, &rom, 1000012) == -1 && b.queued == 1);
    b.hold_abort = 0; b.rx_busy = 1;
    assert(evox_agent_recover(&a, &can) == 0 && a.fault);
    b.rx_busy = 0;
    assert(evox_agent_recover(&a, &can) == 1 && !a.fault && !a.inflight && b.registers[0x50] == 0x40);
    bus_inject(&b, read8, 8);
    assert(evox_agent_step(&a, &can, &rom, 1000013) == 0 && b.queued == 2 && b.rom_calls == 2);
    /* Lost/raced request bytes must never reach the ROM backend. */
    setup(&a, &b, &can, &rom);
    bus_inject(&b, read8, 8); b.race = 1;
    assert(evox_agent_step(&a, &can, &rom, 0) < 0 && a.fault && b.rom_calls == 0 && b.queued == 0);
    setup(&a, &b, &can, &rom);
    b.rom_fail = 1; bus_inject(&b, read8, 8);
    assert(evox_agent_step(&a, &can, &rom, 0) == 0 && !a.fault && b.queued == 1);
    assert(b.last.data[0] == 1 && b.last.data[1] == 0xf2);
    setup(&a, &b, &can, &rom);
    const uint8_t write_request[] = {1,0x20};
    bus_inject(&b, write_request, 2);
    assert(evox_agent_step(&a, &can, &rom, 0) == 0 && b.rom_calls == 0);
    assert(b.last.data[0] == 1 && b.last.data[1] == 0xf0);
    /* Version is the source kernel identity, not the captured V1.09 string. */
    setup(&a, &b, &can, &rom);
    const uint8_t version[] = {1,1};
    bus_inject(&b, version, 2);
    assert(evox_agent_step(&a, &can, &rom, 0) == 0 && b.rom_calls == 0);
    assert(b.last.data[0] == 0x10 && b.last.data[1] == sizeof(EVOX_READ_VERSION) + 1U);
    assert(b.last.data[2] == 0x81 && b.last.data[3] == 'E');
    /* A full 1024-byte read survives response sequence wrap. */
    setup(&a, &b, &can, &rom);
    const uint8_t full[] = {7,3,0,0x0f,0xfc,0,4,0};
    bus_inject(&b, full, 8);
    assert(evox_agent_step(&a, &can, &rom, 0) == 0);
    uint32_t offset = 0, sequence = 1, now = 1;
    while (offset < 1025) {
        uint32_t start = offset == 0 ? 2 : 1;
        uint32_t count = 1025U - offset;
        if (count > 8U - start) count = 8U - start;
        assert(b.last.id == 0x7e8 && b.last.length == 8);
        assert(b.last.data[0] == (offset == 0 ? 0x14 : (0x20U | sequence)));
        if (offset == 0) assert(b.last.data[1] == 1);
        for (uint32_t i = 0; i < count; ++i) {
            uint32_t position = offset + i;
            assert(b.last.data[start + i] == (position == 0 ? 0x83 : (uint8_t)(0xffc00U + position - 1U)));
        }
        for (uint32_t i = start + count; i < 8; ++i) assert(b.last.data[i] == 0);
        if (offset != 0) sequence = (sequence + 1U) & 15U;
        else bus_inject(&b, flow, 3); /* Buffered before FF completion. */
        offset += count;
        b.registers[0x51] = 1;
        assert(evox_agent_step(&a, &can, &rom, now++) == 0 && !a.fault);
    }
    assert(!a.inflight && b.queued == 147 && b.rom_calls == 1 && b.bad == 0);
    return 0;
}
