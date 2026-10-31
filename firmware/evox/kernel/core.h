/* SPDX-License-Identifier: GPL-3.0-only */
#ifndef EVOX_CORE_H
#define EVOX_CORE_H
#include <stdint.h>

struct evox_region {
    uint32_t address;
    uint32_t length;
};

/* Reflected IEEE CRC32; data must contain length readable bytes. */
uint32_t evox_crc32(const uint8_t *data, uint32_t length);
/* Parse command 03 only, without touching ROM; leave region unchanged on failure. */
int evox_parse_read(const uint8_t *request, uint32_t size, struct evox_region *region);
#endif
