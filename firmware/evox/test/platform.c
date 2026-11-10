/* SPDX-License-Identifier: GPL-3.0-only
 * Physical-access shims: no actual MMIO or host low-address dereferences.
 */
#include "../platform/platform.h"
#include <assert.h>
#include <string.h>
static uint8_t registers[0x2000];
static uint32_t loads, stores, psw;
uint8_t evox_physical_load8(uint32_t address) {
    ++loads;
    if (address < 0x100000) return (uint8_t)address;
    assert(address >= 0x800000 && address < 0x802000);
    return registers[address - 0x800000U];
}
uint16_t evox_physical_load16(uint32_t address) {
    ++loads;
    assert((address & 1U) == 0 && address >= 0x800000 && address < 0x801fff);
    uint32_t offset = address - 0x800000U;
    return (uint16_t)(((uint16_t)registers[offset] << 8) | registers[offset + 1U]);
}
void evox_physical_store8(uint32_t address, uint8_t value) {
    ++stores;
    assert(address >= 0x800000 && address < 0x802000);
    registers[address - 0x800000U] = value;
}
uint32_t evox_physical_psw(void) { return psw; }
static void timer(uint16_t raw) {
    registers[0x3d0] = (uint8_t)(raw >> 8); registers[0x3d1] = (uint8_t)raw;
}
int main(void) {
    struct evox_platform_profile profile = {0};
    profile.admitted = 1; profile.tick_numerator_us = 2; profile.tick_denominator = 1;
    profile.max_delta_ticks = 100; profile.timer_control = 1;
    struct evox_platform p = {0};
    struct evox_can_io can;
    struct evox_rom_io rom;
    uint8_t bytes[16];
    uint32_t now = 123;
    assert(evox_platform_bind(&p, 0, 0) == 0); /* Set state before other bind calls below. */
    registers[0x3cb] = 1; registers[0x1100] = 0x1f; registers[0x1101] = 0x20;
    registers[0x1e0] = 0x11; registers[0x1e1] = 0x80;
    profile.admitted = 0;
    assert(!evox_platform_open(&p, &profile) && loads == 0 && stores == 0);
    profile.admitted = 1;
    profile.tick_denominator = 0;
    assert(!evox_platform_open(&p, &profile) && loads == 0);
    profile.tick_denominator = 1;
    profile.timer_control = 3;
    assert(!evox_platform_open(&p, &profile) && loads == 0);
    profile.timer_control = 1;
    timer(65530);
    assert(evox_platform_open(&p, &profile) && stores == 0);
    assert(evox_platform_bind(&p, &can, &rom));
    timer(5);
    assert(evox_platform_now(&p, &now) && now == 22);
    assert(rom.read(rom.context, 0, bytes, 9) == 1);
    for (uint32_t i = 0; i < 9; ++i) assert(bytes[i] == i);
    assert(rom.read(rom.context, 0xfffff, bytes, 1) == 1 && bytes[0] == 0xff);
    uint32_t prior = loads;
    assert(!rom.read(rom.context, 0xfffff, bytes, 2) && loads == prior && p.fault);
    assert(can.read8(can.context, 0x801050) == 0xff && loads == prior);
    assert(evox_platform_open(&p, &profile));
    assert(evox_platform_bind(&p, &can, &rom));
    can.write8(can.context, 0x801116, 0x81);
    assert(stores == 1 && registers[0x1116] == 0x81);
    prior = stores;
    can.write8(can.context, 0x8001e1, 1); /* Flash control is never allowed. */
    assert(p.fault && stores == prior);
    assert(evox_platform_open(&p, &profile));
    prior = loads;
    assert(can.read8(can.context, 0x801102) == 0xff && loads == prior && p.fault);
    assert(evox_platform_open(&p, &profile));
    registers[0x202] = 1; /* Upstream clock configuration changed. */
    now = 456;
    assert(!evox_platform_now(&p, &now) && p.fault && now == 456);
    registers[0x202] = 0;
    psw = 0x40; prior = loads;
    assert(!evox_platform_open(&p, &profile));
    assert(loads == prior);
    psw = 0x80;
    assert(!evox_platform_open(&p, &profile));
    psw = 0;
    registers[0x101c] = 0x80; /* Slot 0 extended format is not admitted. */
    assert(!evox_platform_open(&p, &profile));
    registers[0x101c] = 0;
    assert(evox_platform_open(&p, &profile));
    timer(106); /* More than 100 ticks since last open sample 5. */
    assert(!evox_platform_now(&p, &now) && now == 456 && p.fault);
    assert(evox_platform_open(&p, &profile));
    registers[0x1e2] = 0x10;
    assert(!evox_platform_open(&p, &profile) && p.fault && stores == 1);
    registers[0x1e2] = 0;
    assert(evox_platform_open(&p, &profile));
    registers[0x1e0] = 0;
    struct evox_can_io saved_can = can;
    struct evox_rom_io saved_rom = rom;
    assert(!evox_platform_bind(&p, &can, &rom) && p.fault);
    assert(memcmp(&can, &saved_can, sizeof(can)) == 0);
    assert(memcmp(&rom, &saved_rom, sizeof(rom)) == 0);
    registers[0x1e0] = 0x11;
    assert(evox_platform_open(&p, &profile));
    assert(evox_platform_bind(&p, &can, &rom));
    memset(bytes, 0xcc, sizeof(bytes));
    registers[0x1e1] = 0; /* Busy after binding: no ROM loads/output changes. */
    prior = loads;
    assert(!rom.read(rom.context, 0, bytes, 9) && loads == prior + 4 && p.fault);
    for (uint32_t i = 0; i < sizeof(bytes); ++i) assert(bytes[i] == 0xcc);
    prior = loads;
    assert(!rom.read(rom.context, 0, bytes, 9) && loads == prior);
    registers[0x1e1] = 0x80;
    assert(evox_platform_open(&p, &profile));
    registers[0x1e5] = 1;
    assert(!evox_platform_now(&p, &now) && p.fault && now == 456);
    registers[0x1e5] = 0;
    struct evox_clock clock;
    assert(evox_clock_init(&clock, 0, 4, 5, 100));
    for (uint16_t raw = 1; raw <= 5; ++raw) {
        assert(evox_clock_advance(&clock, raw, &now) && now == raw - 1U);
    }
    assert(evox_clock_init(&clock, 0, 2, 1, 100));
    clock.microseconds = UINT32_MAX - 1U;
    assert(evox_clock_advance(&clock, 2, &now) && now == 2);
    assert(!evox_clock_init(&clock, 0, 0, 1, 100));
    assert(!evox_clock_advance(&clock, 1, &now));
    return 0;
}
