/* SPDX-License-Identifier: GPL-3.0-only */
#include "agent_io.h"
#include "../platform/runtime.h"
#include <assert.h>
static struct test_bus bus;
static uint8_t sfr[0x1000];
static uint32_t psw, reads, clears, helpers;
static uint16_t raw;
static uint8_t hold_clear;
uint8_t evox_physical_load8(uint32_t address) {
    ++reads;
    if (address < 0x100000) return (uint8_t)address;
    if (address >= 0x801000) return bus_read(&bus, address);
    assert(address >= 0x800000 && address < 0x801000);
    return sfr[address - 0x800000U];
}
uint16_t evox_physical_load16(uint32_t address) {
    ++reads;
    if (address == 0x8003d0) return raw;
    if (address >= 0x801000) {
        uint32_t offset = address - 0x801000U;
        return (uint16_t)(((uint16_t)bus.registers[offset] << 8) | bus.registers[offset + 1U]);
    }
    assert(0); return 0;
}
void evox_physical_store8(uint32_t address, uint8_t value) {
    if (address == 0x8001e2) { assert(value == 0); ++clears; if (!hold_clear) sfr[0x1e2] = 0; }
    else bus_write(&bus, address, value);
}
uint32_t evox_physical_psw(void) { return psw; }
void evox_physical_helper(void) { ++helpers; }
static void setup(void) {
    bus_init(&bus);
    for (uint32_t i = 0; i < sizeof(sfr); ++i) sfr[i] = 0;
    sfr[0x3cb] = 1; sfr[0x1e0] = 0x11; sfr[0x1e1] = 0x80;
    bus.registers[0x100] = 0x1f; bus.registers[0x101] = 0x20;
    psw = reads = clears = helpers = 0; raw = 65535; hold_clear = 0;
}
int main(void) {
    struct evox_runtime r;
    struct evox_runtime_profile p = {0};
    p.platform.tick_numerator_us = 2; p.platform.tick_denominator = 1;
    p.platform.max_delta_ticks = 100; p.platform.timer_control = 1;
    p.settle_ticks = 1; p.polls = 3; p.helper_admitted = 1;
    setup();
    assert(!evox_runtime_begin(&r, &p));
    assert(evox_runtime_step(&r) == -1 && reads == 0 && helpers == 0);
    p.platform.admitted = 1; p.helper_admitted = 0;
    assert(!evox_runtime_begin(&r, &p) && reads == 0);
    p.helper_admitted = 1;
    assert(evox_runtime_begin(&r, &p));
    assert(evox_runtime_step(&r) == 0 && r.phase == 2 && clears == 0);
    const uint8_t request[] = {7,3,0,0,0,0x10,0,2};
    bus_inject(&bus, request, 8); raw = 0;
    assert(evox_runtime_step(&r) == 0 && bus.queued == 1);
    assert(bus.last.data[0] == 3 && bus.last.data[1] == 0x83);
    assert(bus.last.data[2] == 0x10 && bus.last.data[3] == 0x11);
    sfr[0x1e1] = 0;
    assert(evox_runtime_step(&r) == -1 && r.agent.fault && r.platform.fault);
    uint32_t prior = reads;
    assert(evox_runtime_step(&r) == -1 && reads == prior);
    setup(); sfr[0x1e2] = 0x10;
    assert(evox_runtime_begin(&r, &p));
    assert(evox_runtime_step(&r) == -1 && clears == 0 && helpers == 0);
    p.exit_attested = 1;
    assert(evox_runtime_begin(&r, &p));
    assert(evox_runtime_step(&r) == 0 && clears == 1 && bus.queued == 0 && r.phase == 0);
    assert(evox_runtime_step(&r) == 0 && r.phase == 0);
    raw = 0;
    assert(evox_runtime_step(&r) == 0 && r.phase == 2 && clears == 1);
    setup(); sfr[0x1e2] = 0x10;
    assert(evox_runtime_begin(&r, &p));
    assert(evox_runtime_step(&r) == 0);
    assert(evox_runtime_step(&r) == 0);
    assert(evox_runtime_step(&r) == 0);
    assert(evox_runtime_step(&r) == -1); /* Stalled timer exhausts poll budget. */
    setup(); sfr[0x1e2] = 0x10; hold_clear = 1;
    assert(evox_runtime_begin(&r, &p));
    assert(evox_runtime_step(&r) == 0 && clears == 1);
    prior = helpers;
    assert(evox_runtime_step(&r) == -1 && clears == 1 && helpers == prior);
    setup(); sfr[0x202] = 1;
    assert(evox_runtime_begin(&r, &p));
    assert(evox_runtime_step(&r) == -1 && clears == 0 && helpers == 0);
    setup(); bus.hold_abort = 1;
    assert(evox_runtime_begin(&r, &p));
    assert(evox_runtime_step(&r) == 0 && r.phase == 1);
    assert(evox_runtime_step(&r) == 0);
    assert(evox_runtime_step(&r) == -1 && bus.queued == 0);
    setup(); psw = 0x40;
    assert(evox_runtime_begin(&r, &p));
    assert(evox_runtime_step(&r) == -1 && reads == 0 && helpers == 0 && clears == 0);
    return 0;
}
