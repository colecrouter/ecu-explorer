/* SPDX-License-Identifier: GPL-3.0-only
 * Fail-closed profile fixture. No calibration/ownership/helper attestation.
 * Separate assembly prevents LTO folding away the conditional operating graph.
 */
    .section .rodata.evox_profile,"a"
    .align 2
    .global evox_runtime_profile
evox_runtime_profile:
    .space 26
