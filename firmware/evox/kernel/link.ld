/* SPDX-License-Identifier: GPL-3.0-only
 * Synthetic addresses only; not a declaration of free ECU RAM.
 */
OUTPUT_FORMAT("elf32-m32r")
ENTRY(evox_offline_entry)
MEMORY {
    CODE (rx) : ORIGIN = 0x1000, LENGTH = 5117
    RAM (rw) : ORIGIN = 0x10000, LENGTH = 4096
}
SECTIONS {
    .text : { *(.text*) *(.rodata*) } > CODE
    .rela.text : { *(.rela.text*) }
    .data : { *(.data*) *(.sdata*) } > RAM
    .bss (NOLOAD) : { *(.bss*) *(.sbss*) *(COMMON) } > RAM
    /DISCARD/ : { *(.comment) *(.note*) }
}
ASSERT(SIZEOF(.data) == 0, "offline core must not require initialized RAM")
ASSERT(SIZEOF(.bss) == 0, "offline core must not require BSS initialization")

ASSERT(SIZEOF(.rela.text) == 0, "offline image must not retain relocations")
