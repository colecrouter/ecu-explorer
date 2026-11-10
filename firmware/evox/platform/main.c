/* SPDX-License-Identifier: GPL-3.0-only */
#include "runtime.h"
#include <stddef.h>
_Static_assert(sizeof(struct evox_runtime_profile) == 26, "profile fixture layout changed");
/* Supplied by separate link input; checked-in fixture is entirely unadmitted. */
extern const struct evox_runtime_profile evox_runtime_profile;
static struct evox_runtime runtime;
/* Retained diagnostic constants for exact-image synthetic startup checking. */
const uint32_t evox_runtime_layout[] = {
    sizeof(runtime), offsetof(struct evox_runtime, phase),
    offsetof(struct evox_runtime, agent) + offsetof(struct evox_agent, fault),
    offsetof(struct evox_runtime, platform) + offsetof(struct evox_platform, fault),
    offsetof(struct evox_runtime, platform) + offsetof(struct evox_platform, enabled)
};
void evox_agent_main(void) {
    if (!evox_runtime_begin(&runtime, &evox_runtime_profile)) return;
    while (evox_runtime_step(&runtime) == 0) { }
}
