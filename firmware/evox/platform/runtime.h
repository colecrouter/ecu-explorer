/* SPDX-License-Identifier: GPL-3.0-only */
#ifndef EVOX_RUNTIME_H
#define EVOX_RUNTIME_H
#include "platform.h"
#include "../kernel/agent.h"
struct evox_runtime_profile {
    struct evox_platform_profile platform;
    uint16_t settle_ticks;
    uint8_t polls, exit_attested, helper_admitted;
};
struct evox_runtime {
    struct evox_agent agent;
    struct evox_platform platform;
    struct evox_flash_gate flash;
    struct evox_can_io can;
    struct evox_rom_io rom;
    const struct evox_runtime_profile *profile;
    uint8_t phase, remaining;
};
/* Immutable profile must outlive runtime. Admission includes verified helper at
 * 0x808640, bounded service/ROM timing and an accepted park/watchdog fault policy.
 * This initializes owned RAM only; no MMIO for rejected profiles. */
int evox_runtime_begin(struct evox_runtime *runtime, const struct evox_runtime_profile *profile);
/* One bounded iteration: startup flash gate, idle-confirmed CAN arming, service.
 * Only an attested startup may write FCNT1=0. Faults latch, disable callbacks and
 * stop helper servicing; no automatic reset/recovery or further IO after fault.
 * Return 0 to continue, -1 to park. Caller owns scheduling and liveness. */
int evox_runtime_step(struct evox_runtime *runtime);
#endif
