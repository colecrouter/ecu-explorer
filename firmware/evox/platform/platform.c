/* SPDX-License-Identifier: GPL-3.0-only */
#include "platform.h"
/* Target assembly uses explicit load/store widths, including valid ROM address
 * zero without a C null dereference. Host contracts provide independent shims. */
extern uint8_t evox_physical_load8(uint32_t address);
extern uint16_t evox_physical_load16(uint32_t address);
extern void evox_physical_store8(uint32_t address, uint8_t value);
extern uint32_t evox_physical_psw(void);

static int calibrated(const struct evox_platform_profile *p) {
    return p != 0 && p->admitted == 1 && p->tick_numerator_us > 0 &&
        p->tick_numerator_us <= 1000 && p->tick_denominator > 0 &&
        p->tick_denominator <= 1000 && p->max_delta_ticks > 0 && p->max_delta_ticks < 32768 &&
        (p->timer_control & 1U) != 0 && (p->timer_control & 0x0aU) == 0 && (p->can_control & 0xfcffU) == 0;
}
int evox_platform_validate(const struct evox_platform_profile *p,
                            const struct evox_platform_snapshot *s) {
    if (!calibrated(p) || s == 0 || (s->psw & 0xc0U) != 0 ||
        s->timer_control != p->timer_control || s->can_control != p->can_control ||
        s->can_configuration != p->can_configuration || (s->frame_format & 0xc000U) != 0 ||
        s->can_prescaler != p->can_prescaler || s->can_clock != p->can_clock ||
        s->rx_id0 != 0x1f || s->rx_id1 != 0x20) return 0;
    for (uint32_t i = 0; i < 5; ++i) if (s->timer_clock[i] != p->timer_clock[i]) return 0;
    return 1;
}
int evox_clock_init(struct evox_clock *c, uint16_t first,
                     uint16_t numerator, uint16_t denominator, uint16_t max_delta) {
    c->fault = 1;
    if (numerator == 0 || numerator > 1000 || denominator == 0 || denominator > 1000 ||
        max_delta == 0 || max_delta >= 32768) return 0;
    c->previous = first; c->numerator = numerator; c->denominator = denominator;
    c->max_delta = max_delta; c->remainder = 0; c->microseconds = 0; c->fault = 0;
    return 1;
}
int evox_clock_advance(struct evox_clock *c, uint16_t raw, uint32_t *now) {
    if (c->fault || now == 0) return 0;
    uint16_t delta = (uint16_t)(raw - c->previous);
    if (delta > c->max_delta) { c->fault = 1; return 0; }
    uint32_t scaled = (uint32_t)delta * c->numerator + c->remainder;
    c->microseconds += scaled / c->denominator;
    c->remainder = (uint16_t)(scaled % c->denominator);
    c->previous = raw;
    *now = c->microseconds;
    return 1;
}
static void snapshot(struct evox_platform_snapshot *s) {
    s->psw = evox_physical_psw();
    s->timer_control = evox_physical_load8(0x8003cb);
    for (uint32_t i = 0; i < 5; ++i) s->timer_clock[i] = evox_physical_load8(0x800200U + i);
    s->can_control = evox_physical_load16(0x801000);
    s->can_configuration = evox_physical_load16(0x801006);
    s->frame_format = evox_physical_load16(0x80101c);
    s->can_prescaler = evox_physical_load8(0x801016);
    s->can_clock = evox_physical_load8(0x80101b);
    s->rx_id0 = evox_physical_load8(0x801100);
    s->rx_id1 = evox_physical_load8(0x801101);
}
static int disable(struct evox_platform *p) {
    p->fault = 1; p->enabled = 0; return 0;
}
int evox_platform_open(struct evox_platform *p, const struct evox_platform_profile *profile) {
    p->enabled = 0; p->fault = 1;
    if (!calibrated(profile) || (evox_physical_psw() & 0xc0U) != 0) return 0;
    struct evox_platform_snapshot observed;
    snapshot(&observed);
    if (!evox_platform_validate(profile, &observed)) return 0;
    p->profile = profile;
    if (!evox_clock_init(&p->clock, evox_physical_load16(0x8003d0),
        profile->tick_numerator_us, profile->tick_denominator, profile->max_delta_ticks)) return 0;
    p->enabled = 1; p->fault = 0;
    return 1;
}
int evox_platform_now(struct evox_platform *p, uint32_t *now) {
    if (!p->enabled || p->fault || now == 0) return 0;
    if ((evox_physical_psw() & 0xc0U) != 0) return disable(p);
    struct evox_platform_snapshot observed;
    snapshot(&observed);
    if (!evox_platform_validate(p->profile, &observed) ||
        !evox_clock_advance(&p->clock, evox_physical_load16(0x8003d0), now)) return disable(p);
    return 1;
}
static uint8_t read_can(void *context, uint32_t address) {
    struct evox_platform *p = context;
    if (!p->enabled || p->fault) return 0xff;
    if (address == 0x801050 || address == 0x801051 || address == 0x801100 || address == 0x801101 ||
        (address >= 0x801105 && address <= 0x80110d)) return evox_physical_load8(address);
    (void)disable(p); return 0xff;
}
static void write_can(void *context, uint32_t address, uint8_t value) {
    struct evox_platform *p = context;
    if (!p->enabled || p->fault) return;
    if (address == 0x801050 || address == 0x801051 || address == 0x801110 || address == 0x801111 ||
        (address >= 0x801115 && address <= 0x80111d)) { evox_physical_store8(address, value); return; }
    (void)disable(p);
}
static int read_rom(void *context, uint32_t address, uint8_t *output, uint16_t length) {
    struct evox_platform *p = context;
    if (!p->enabled || p->fault) return 0;
    if (output == 0 || length == 0 || length > 1024 || address >= 0x100000 ||
        length > 0x100000U - address) return disable(p);
    for (uint32_t i = 0; i < length; ++i) output[i] = evox_physical_load8(address + i);
    return 1;
}
int evox_platform_bind(struct evox_platform *p, struct evox_can_io *can, struct evox_rom_io *rom) {
    if (!p->enabled || p->fault || can == 0 || rom == 0) return 0;
    can->context = p; can->read8 = read_can; can->write8 = write_can;
    rom->context = p; rom->read = read_rom;
    return 1;
}
