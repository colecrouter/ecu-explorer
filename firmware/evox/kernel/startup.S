/* SPDX-License-Identifier: GPL-3.0-only
 * RAM entry contract: inherited CPU mode and interrupt exclusion are required.
 * The platform linker must supply exclusively owned stack/BSS ranges. This
 * SM/IE are checked before any SP/BSS write. This entry does not select a CPU
 * mode, disable interrupts, or initialize hardware.
 */
    .section .text.evox_entry,"ax"
    .align 2
    .global evox_ram_entry
    .global evox_startup_park
    .global evox_startup_rejected
evox_ram_entry:
    mvfc r0,psw
    and3 r0,r0,#0xc0
    bnez r0,evox_startup_rejected
    ld24 sp,#__evox_stack_top
    ld24 r0,#__evox_bss_start
    ld24 r1,#__evox_bss_end
    ldi r2,#0
.Lclear_test:
    cmpu r0,r1
    bnc .Lclear_done
    stb r2,@r0
    addi r0,#1
    bra .Lclear_test
.Lclear_done:
    bl evox_agent_main
evox_startup_park:
    bra evox_startup_park
evox_startup_rejected:
    bra evox_startup_rejected
