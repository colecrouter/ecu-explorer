/* SPDX-License-Identifier: GPL-3.0-only */
#include "dispatch.h"
#include "core.h"
static uint32_t be32(const uint8_t *p) {
    return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | p[3];
}
static void put32(uint8_t *p, uint32_t value) {
    for (uint32_t i = 0; i < 4; ++i) p[i] = (uint8_t)(value >> (24U - i * 8U));
}
uint16_t evox_dispatch(const uint8_t *request, uint16_t length,
                      uint8_t *reply, uint16_t capacity, const struct evox_rom_io *rom) {
    if (reply == 0 || capacity == 0) return 0;
    if (request == 0 || length == 0) { reply[0] = 0xf1; return 1; }
    uint8_t command = request[0];
    if (command == 1 && length == 1) {
        static const uint8_t version[] = EVOX_READ_VERSION;
        if (capacity < sizeof version + 1U) return 0;
        reply[0] = 0x81;
        for (uint32_t i = 0; i < sizeof version; ++i) reply[i + 1U] = version[i];
        return (uint16_t)(sizeof version + 1U);
    }
    if (command == 5 && length == 1) {
        if (capacity < 5) return 0;
        reply[0] = 0x85; put32(reply + 1, 1032);
        return 5;
    }
    struct evox_region region;
    int valid = 0;
    if (command == 3) valid = evox_parse_read(request, length, &region);
    if (command == 2 && length == 9) {
        uint32_t address = be32(request + 1), size = be32(request + 5);
        if (size > 0 && size <= 1024 && address < UINT32_C(0x100000) &&
            size <= UINT32_C(0x100000) - address) {
            region.address = address; region.length = size; valid = 1;
        }
    }
    if (valid) {
        uint32_t needed = region.length + 1U;
        if (command == 2 && needed < 5) needed = 5;
        if (capacity < needed) return 0;
        if (rom == 0 || rom->read == 0 || rom->read(rom->context, region.address,
            reply + 1, (uint16_t)region.length) != 1) { reply[0] = 0xf2; return 1; }
        if (command == 2) {
            uint32_t crc = evox_crc32(reply + 1, region.length);
            reply[0] = 0x82; put32(reply + 1, crc); return 5;
        }
        reply[0] = 0x83;
        return (uint16_t)(region.length + 1U);
    }
    reply[0] = (command == 1 || command == 2 || command == 3 || command == 5) ? 0xf1 : 0xf0;
    return 1;
}
