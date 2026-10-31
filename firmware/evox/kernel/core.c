/* SPDX-License-Identifier: GPL-3.0-only
 * Original implementation of documented protocol contracts; no recovered code.
 */
#include "core.h"

uint32_t evox_crc32(const uint8_t *data, uint32_t length) {
    uint32_t crc = UINT32_C(0xffffffff);
    for (uint32_t i = 0; i < length; ++i) {
        crc ^= data[i];
        for (uint32_t bit = 0; bit < 8; ++bit)
            crc = (crc >> 1) ^ ((crc & 1U) ? UINT32_C(0xedb88320) : 0U);
    }
    return ~crc;
}

int evox_parse_read(const uint8_t *request, uint32_t size, struct evox_region *region) {
    if (request == 0 || region == 0 || size != 7 || request[0] != 3)
        return 0;
    uint32_t address = ((uint32_t)request[1] << 24) |
        ((uint32_t)request[2] << 16) | ((uint32_t)request[3] << 8) | request[4];
    uint32_t length = ((uint32_t)request[5] << 8) | request[6];
    if (length == 0 || length > 1024 || address >= UINT32_C(0x100000) ||
        length > UINT32_C(0x100000) - address)
        return 0;
    region->address = address;
    region->length = length;
    return 1;
}
