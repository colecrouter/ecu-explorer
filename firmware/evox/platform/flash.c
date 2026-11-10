/* SPDX-License-Identifier: GPL-3.0-only */
#include "flash.h"
static int ready(const struct evox_flash_snapshot *s) {
    return (s->mode & 0x10U) != 0 && (s->status & 0x80U) != 0 && (s->reset & 1U) == 0;
}
int evox_flash_normal(const struct evox_flash_snapshot *s) {
    return s->control == 0 && ready(s);
}
int evox_flash_init(struct evox_flash_gate *g, uint16_t settle,
                    uint16_t maximum, uint8_t polls, uint8_t attested) {
    g->stage = 3;
    if (settle == 0 || settle > maximum || maximum >= 32768 || polls == 0 || polls > 32 || attested > 1) return 0;
    g->settle_ticks = settle; g->max_ticks = maximum; g->remaining = polls;
    g->exit_attested = attested; g->started = 0; g->stage = 0;
    return 1;
}
enum evox_flash_action evox_flash_step(struct evox_flash_gate *g,
                                        const struct evox_flash_snapshot *s, uint16_t now) {
    if (g->stage == 3) return EVOX_FLASH_DENY;
    if (evox_flash_normal(s)) {
        if (g->stage != 1) { g->stage = 2; return EVOX_FLASH_READY; }
        uint16_t elapsed = (uint16_t)(now - g->started);
        if (elapsed <= g->max_ticks) {
            if (elapsed >= g->settle_ticks) { g->stage = 2; return EVOX_FLASH_READY; }
            if (--g->remaining != 0) return EVOX_FLASH_WAIT;
        }
    } else if (g->stage == 0 && g->exit_attested == 1 && s->control == 0x10 && ready(s)) {
        g->started = now; g->stage = 1; return EVOX_FLASH_CLEAR;
    }
    g->stage = 3;
    return EVOX_FLASH_DENY;
}
