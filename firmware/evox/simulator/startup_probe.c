/* SPDX-License-Identifier: GPL-3.0-only
 * Synthetic test main only; excluded from the ordinary firmware build.
 * Inspect dirty-BSS clearing before acknowledging that C entry was reached.
 */
#include <stdint.h>
void evox_agent_main(void) {
    const volatile uint8_t *bss = (const volatile uint8_t *)UINT32_C(0x20000);
    uint32_t dirty = 0;
    for (uint32_t i = 0; i < 32; ++i) dirty |= bss[i];
    volatile uint32_t *marker = (volatile uint32_t *)UINT32_C(0x20020);
    *marker = dirty == 0 ? UINT32_C(0x424f4f54) : UINT32_C(0xbad);
}
