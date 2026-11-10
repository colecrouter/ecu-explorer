/* SPDX-License-Identifier: GPL-3.0-only
 * Link-only reservation fixture. Never executed as a physical agent main.
 */
#include "../kernel/agent.h"
#include "../platform/platform.h"
struct evox_agent evox_layout_agent;
struct evox_platform evox_layout_platform;
void evox_agent_main(void) {
    evox_layout_agent.fault = 1;
    evox_layout_platform.enabled = 0;
}
