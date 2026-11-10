/* SPDX-License-Identifier: GPL-3.0-only
 * Unadmitted layout candidate. Disjoint ranges do not establish live ownership.
 */
OUTPUT_FORMAT("elf32-m32r")
ENTRY(evox_ram_entry)
MEMORY {
    CODE (rx) : ORIGIN = 0x80b000, LENGTH = 5117
    STATE (rw) : ORIGIN = 0x80c400, LENGTH = 3072
    STACK (rw) : ORIGIN = 0x80d000, LENGTH = 1024
}
SECTIONS {
    .text : { KEEP(*(.text.evox_entry)) *(.text*) *(.rodata*) } > CODE
    __evox_code_end = .;
    .rela.text : { *(.rela.text*) }
    .data : { *(.data*) *(.sdata*) } > STATE
    .bss (NOLOAD) : {
        . = ALIGN(4); __evox_bss_start = .;
        *(.bss*) *(.sbss*) *(COMMON)
        . = ALIGN(4); __evox_bss_end = .;
    } > STATE
    .stack (NOLOAD) : {
        __evox_stack_bottom = .;
        . += LENGTH(STACK); __evox_stack_top = .;
    } > STACK
    /DISCARD/ : { *(.comment) *(.note*) }
}
ASSERT(evox_ram_entry == ORIGIN(CODE), "RAM entry must begin at captured loader destination")
ASSERT(SIZEOF(.data) == 0, "initialized RAM data is not supported")
ASSERT(SIZEOF(.rela.text) == 0, "unresolved image relocations")
ASSERT(__evox_code_end <= 0x80c3fd, "captured loader span exceeded")
ASSERT(__evox_bss_end <= ORIGIN(STACK), "BSS overlaps stack")
ASSERT((__evox_stack_top & 3) == 0, "unaligned stack")
ASSERT(__evox_stack_top <= 0x80d860, "preserve captured security state")
ASSERT(ORIGIN(CODE) >= 0x808804, "preserve factory helpers and scratch")
