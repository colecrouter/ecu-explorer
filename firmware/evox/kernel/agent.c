/* SPDX-License-Identifier: GPL-3.0-only */
#include "agent.h"
void evox_agent_init(struct evox_agent *agent) {
    evox_isotp_init(&agent->transport);
    agent->inflight = 0;
    agent->fault = 1;
}
int evox_agent_recover(struct evox_agent *agent, const struct evox_can_io *can) {
    agent->fault = 1;
    int idle = evox_can_reset_slots(can);
    if (idle != 1) return idle;
    evox_isotp_init(&agent->transport);
    agent->inflight = agent->fault = 0;
    return 1;
}
static int fault(struct evox_agent *agent, int error) {
    agent->fault = 1;
    return error;
}
int evox_agent_step(struct evox_agent *agent, const struct evox_can_io *can,
                    const struct evox_rom_io *rom, uint32_t now) {
    if (agent->fault) return -1;
    struct evox_isotp *transport = &agent->transport;
    int result = evox_isotp_tick(transport, now);
    if (result < 0) return fault(agent, result);
    if (agent->inflight) {
        result = evox_can_finish_send(can);
        if (result < 0) return fault(agent, result);
        if (result == 0) return 0;
        agent->inflight = 0;
        result = evox_isotp_sent(transport, now);
        if (result < 0) return fault(agent, result);
    }
    struct evox_can_frame *frame = &agent->io_frame;
    result = evox_can_try_receive(can, frame);
    if (result < 0) return fault(agent, result);
    if (result == 1) {
        result = evox_isotp_frame(transport, frame, now);
        if (result < 0) return fault(agent, result);
    }
    if (transport->received) {
        uint16_t size = evox_dispatch(transport->rx, transport->received,
                                     agent->reply, sizeof agent->reply, rom);
        evox_isotp_release(transport);
        if (size == 0 || evox_isotp_send(transport, agent->reply, size, now) != 0)
            return fault(agent, -1);
    }
    result = evox_isotp_poll(transport, frame, now);
    if (result < 0) return fault(agent, result);
    if (result == 1) {
        result = evox_can_try_send(can, frame);
        if (result < 0) return fault(agent, result);
        if (result == 1) agent->inflight = 1;
    }
    return 0;
}
