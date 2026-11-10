/* SPDX-License-Identifier: GPL-3.0-only */
#include "runtime.h"
extern void evox_physical_store8(uint32_t address, uint8_t value);
extern void evox_physical_helper(void);
static int fail(struct evox_runtime *r) {
    r->phase = 3; r->agent.fault = 1;
    r->platform.fault = 1; r->platform.enabled = 0;
    return -1;
}
int evox_runtime_begin(struct evox_runtime *r, const struct evox_runtime_profile *p) {
    (void)fail(r);
    if (p == 0 || p->platform.admitted != 1 || p->helper_admitted != 1 ||
        !evox_flash_init(&r->flash, p->settle_ticks, p->platform.max_delta_ticks,
                         p->polls, p->exit_attested)) return 0;
    r->profile = p; r->remaining = p->polls; r->phase = 0;
    evox_agent_init(&r->agent);
    return 1;
}
int evox_runtime_step(struct evox_runtime *r) {
    if (r->phase == 3) return -1;
    const struct evox_runtime_profile *p = r->profile;
    if (r->phase == 0) {
        struct evox_flash_snapshot flash;
        uint16_t raw;
        if (!evox_platform_observe(&p->platform, &flash, &raw)) return fail(r);
        enum evox_flash_action action = evox_flash_step(&r->flash, &flash, raw);
        if (action == EVOX_FLASH_DENY) return fail(r);
        if (action == EVOX_FLASH_CLEAR) evox_physical_store8(0x8001e2, 0);
        if (action != EVOX_FLASH_READY) { evox_physical_helper(); return 0; }
        if (!evox_platform_open(&r->platform, &p->platform) ||
            !evox_platform_bind(&r->platform, &r->can, &r->rom)) return fail(r);
        r->phase = 1;
    }
    uint32_t now;
    if (!evox_platform_now(&r->platform, &now)) return fail(r);
    evox_physical_helper();
    int result;
    if (r->phase == 1) {
        result = evox_agent_recover(&r->agent, &r->can);
        if (result == 1) { r->phase = 2; return 0; }
        if (result < 0 || --r->remaining == 0) return fail(r);
    } else if (evox_agent_step(&r->agent, &r->can, &r->rom, now) < 0 || r->platform.fault) return fail(r);
    return 0;
}
