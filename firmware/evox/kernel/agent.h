/* SPDX-License-Identifier: GPL-3.0-only */
#ifndef EVOX_AGENT_H
#define EVOX_AGENT_H
#include "dispatch.h"
#include "isotp.h"
struct evox_agent {
    struct evox_isotp transport;
    uint8_t reply[EVOX_REPLY_MAX];
    struct evox_can_frame io_frame;
    uint8_t inflight, fault;
};
/* Initialize protocol storage in a faulted/unarmed state. */
void evox_agent_init(struct evox_agent *agent);
/* Explicit recovery/first arming. 1 armed, 0 waiting for idle, -1 invalid IO.
 * While faulted, step cannot queue or dispatch. Requires exclusive configured
 * CAN0 slots and interrupt exclusion; does not initialize clocks/filters/CPU.
 */
int evox_agent_recover(struct evox_agent *agent, const struct evox_can_io *can);
/* One bounded service iteration, with a validated wrapping microsecond clock.
 * 0 progressed/idle, -1 fault/protocol error, -2 deadline or receive loss/race.
 * Completion is consumed before reading an early reply from the RX mailbox.
 * Faults latch until explicit recovery confirms both slots are idle and drops
 * stale traffic. ROM callbacks must be bounded and service platform obligations.
 */
int evox_agent_step(struct evox_agent *agent, const struct evox_can_io *can,
                    const struct evox_rom_io *rom, uint32_t now);
#endif
