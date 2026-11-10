/* SPDX-License-Identifier: GPL-3.0-only
 * Synthetic ROM callback using GNU r0..r3 ABI: context, address, output, size.
 * Returns a byte ramp based on address; no MMIO, stack use or recovered code.
 */
    .text
    .align 2
    .global evox_test_rom_read
evox_test_rom_read:
.Lrom_loop:
    beqz r3,.Lrom_done
    stb r1,@r2
    addi r1,#1
    addi r2,#1
    addi r3,#-1
    bra .Lrom_loop
.Lrom_done:
    ldi r0,#1
    jmp lr
