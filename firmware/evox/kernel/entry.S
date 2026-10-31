/* SPDX-License-Identifier: GPL-3.0-only
 * Offline link fixture only. No ECU startup state or peripherals are configured.
 * An uploadable entry requires audited stack, BSS and hardware initialization.
 */
    .text
    .align 2
    .global evox_offline_entry
evox_offline_entry:
    bra evox_offline_entry
