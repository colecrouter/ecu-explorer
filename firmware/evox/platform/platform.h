/* SPDX-License-Identifier: GPL-3.0-only */
#ifndef EVOX_PLATFORM_H
#define EVOX_PLATFORM_H
#include "../kernel/can.h"
#include "flash.h"
#include "../kernel/dispatch.h"
/* Immutable, externally admitted calibration/configuration. No production
 * profile is supplied. Admission includes RAM ownership, fixed upstream clock,
 * DMA/NMI exclusion, helper preservation, settled normal flash/read-array
 * state and validated sampling cadence.
 */
struct evox_platform_profile {
    uint16_t tick_numerator_us, tick_denominator, max_delta_ticks;
    uint16_t can_control, can_configuration;
    uint8_t timer_control, timer_clock[5], can_prescaler, can_clock, admitted;
};
struct evox_platform_snapshot {
    uint32_t psw;
    uint16_t can_control, can_configuration, frame_format;
    uint8_t timer_control, timer_clock[5], can_prescaler, can_clock, rx_id0, rx_id1;
};
struct evox_clock {
    uint32_t microseconds;
    uint16_t previous, remainder, numerator, denominator, max_delta;
    uint8_t fault;
};
struct evox_platform {
    const struct evox_platform_profile *profile;
    struct evox_clock clock;
    uint8_t enabled, fault;
};
/* Pure validation: PSW SM/IE must be clear, timer enabled, CAN normal/standard,
 * and calibration/configuration admitted and exactly matched. */
int evox_platform_validate(const struct evox_platform_profile *profile,
                            const struct evox_platform_snapshot *snapshot);
int evox_clock_init(struct evox_clock *clock, uint16_t first,
                     uint16_t numerator, uint16_t denominator, uint16_t max_delta);
/* Output unchanged on error. Sample before a counter wrap, within max_delta;
 * multiple missed wraps/stalled hardware are not detectable from this counter.
 */
int evox_clock_advance(struct evox_clock *clock, uint16_t raw, uint32_t *now);
/* Open performs read-only physical snapshot checks. An unadmitted profile causes
 * no physical access. Flash normal/readiness/reset checks are mandatory.
 * Profile storage must remain immutable/alive until closed. */
/* Internal startup sampling: validate admitted CPU/CAN/timer configuration,
 * then read flash state and timer without requiring normal flash or enabling IO.
 * All output storage must be valid. Rejection may leave partial snapshot output. */
int evox_platform_observe(const struct evox_platform_profile *profile,
                         struct evox_flash_snapshot *flash, uint16_t *raw);
int evox_platform_open(struct evox_platform *platform, const struct evox_platform_profile *profile);
int evox_platform_now(struct evox_platform *platform, uint32_t *now);
/* Bind guarded physical callbacks only after open. Invalid accesses latch a
 * platform fault and disable further physical accesses. Call now/check fault
 * before servicing the agent. Bind and each ROM batch recheck flash and PSW.
 * No CPU/peripheral configuration is changed. */
int evox_platform_bind(struct evox_platform *platform, struct evox_can_io *can, struct evox_rom_io *rom);
#endif
