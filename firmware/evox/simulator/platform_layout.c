/* SPDX-License-Identifier: GPL-3.0-only
 * Target layout contract for synthetic serialized ABI fixtures only.
 */
#include <stddef.h>
#include "../platform/platform.h"
_Static_assert(offsetof(struct evox_clock, numerator) == 8, "clock fixture layout changed");
_Static_assert(offsetof(struct evox_clock, fault) == 14, "clock fault offset changed");
_Static_assert(sizeof(struct evox_flash_gate) == 10, "flash fixture layout changed");
_Static_assert(offsetof(struct evox_flash_gate, stage) == 8, "flash stage offset changed");
const uint32_t evox_platform_layout[] = {
    sizeof(struct evox_platform_profile), sizeof(struct evox_platform_snapshot),
    sizeof(struct evox_clock), sizeof(struct evox_platform),
    offsetof(struct evox_platform, enabled), offsetof(struct evox_platform, fault)
};
