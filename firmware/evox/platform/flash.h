/* SPDX-License-Identifier: GPL-3.0-only */
#ifndef EVOX_FLASH_H
#define EVOX_FLASH_H
#include <stdint.h>
struct evox_flash_snapshot { uint8_t control, mode, status, reset; };
struct evox_flash_gate {
    uint16_t started, settle_ticks, max_ticks;
    uint8_t remaining, exit_attested, stage;
};
enum evox_flash_action {
    EVOX_FLASH_DENY = -1, EVOX_FLASH_WAIT = 0, EVOX_FLASH_READY = 1, EVOX_FLASH_CLEAR = 2
};
/* Pure normal-read predicate; external FP may remain high. Does not establish
 * transition history, settling, physical mapping or freedom from other writers. */
int evox_flash_normal(const struct evox_flash_snapshot *snapshot);
/* Caller owns/initializes gate and provides a calibrated monotonically advancing
 * modular tick stream. settle_ticks must exceed eight CPU clocks on admitted
 * silicon. exit_attested=1 attests completed reset/read-array history and owned
 * flash/IRQ state. No hardware operation is performed by these functions. */
int evox_flash_init(struct evox_flash_gate *gate, uint16_t settle_ticks,
                    uint16_t max_ticks, uint8_t polls, uint8_t exit_attested);
/* CLEAR requests exactly one FCNT1 byte-clear by a separate admitted startup
 * owner. Next sample must confirm normal state. WAIT consumes finite poll budget;
 * DENY latches until reinitialized. READY must precede ROM binding and follow
 * an independent CPU/configuration check. All pointers must be valid/non-null. */
enum evox_flash_action evox_flash_step(struct evox_flash_gate *gate,
                                        const struct evox_flash_snapshot *snapshot, uint16_t now);
#endif
