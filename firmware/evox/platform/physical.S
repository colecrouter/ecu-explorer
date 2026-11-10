/* SPDX-License-Identifier: GPL-3.0-only
 * Internal target access primitives, GNU integer ABI. No C null-pointer access.
 */
    .text
    .align 2
    .global evox_physical_load8
evox_physical_load8:
    ldub r0,@r0
    jmp lr
    .align 2
    .global evox_physical_load16
evox_physical_load16:
    lduh r0,@r0
    jmp lr
    .align 2
    .global evox_physical_store8
evox_physical_store8:
    stb r1,@r0
    jmp lr
    .align 2
    .global evox_physical_psw
evox_physical_psw:
    mvfc r0,psw
    jmp lr
