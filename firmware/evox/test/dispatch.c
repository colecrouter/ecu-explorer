/* SPDX-License-Identifier: GPL-3.0-only */
#include "dispatch.h"
#include <assert.h>
#include <string.h>
static uint32_t calls, last_address;
static uint16_t last_length;
static int fail;
static int read_rom(void *context, uint32_t address, uint8_t *bytes, uint16_t length) {
    (void)context;
    ++calls; last_address = address; last_length = length;
    static const uint8_t vector[] = "123456789";
    for (uint32_t i = 0; i < length; ++i) bytes[i] = address == 0 ? vector[i % 9U] : (uint8_t)(address + i);
    return !fail;
}
int main(void) {
    const struct evox_rom_io rom = {0, read_rom};
    uint8_t reply[1025], request[9] = {3,0,0x0f,0xff,0xff,0,1,0,0};
    assert(evox_dispatch(request, 7, reply, sizeof reply, &rom) == 2);
    assert(reply[0] == 0x83 && reply[1] == 0xff && calls == 1 && last_address == 0xfffff && last_length == 1);
    request[6] = 2;
    assert(evox_dispatch(request, 7, reply, sizeof reply, &rom) == 1 && reply[0] == 0xf1 && calls == 1);
    uint8_t crc[] = {2,0,0,0,0,0,0,0,9};
    assert(evox_dispatch(crc, 9, reply, sizeof reply, &rom) == 5);
    const uint8_t golden[] = {0x82,0xcb,0xf4,0x39,0x26};
    assert(memcmp(reply, golden, 5) == 0);
    fail = 1;
    assert(evox_dispatch(crc, 9, reply, sizeof reply, &rom) == 1 && reply[0] == 0xf2);
    fail = 0;
    uint32_t previous = calls;
    for (uint32_t command = 0; command < 256; ++command) {
        request[0] = (uint8_t)command;
        if (command == 1 || command == 2 || command == 3 || command == 5) continue;
        assert(evox_dispatch(request, 1, reply, sizeof reply, &rom) == 1 && reply[0] == 0xf0);
    }
    assert(calls == previous); /* No destructive command has a backend path. */
    for (uint32_t size = 0; size < 9; ++size) {
        assert(evox_dispatch(crc, (uint16_t)size, reply, sizeof reply, &rom) == 1 && reply[0] == 0xf1);
    }
    assert(calls == previous);
    uint8_t bad_crc[] = {2,0xff,0xff,0xff,0xff,0,0,0,1};
    assert(evox_dispatch(bad_crc, 9, reply, sizeof reply, &rom) == 1 && reply[0] == 0xf1);
    bad_crc[1] = 0; bad_crc[2] = 0; bad_crc[3] = 0; bad_crc[4] = 0; bad_crc[8] = 0;
    assert(evox_dispatch(bad_crc, 9, reply, sizeof reply, &rom) == 1 && reply[0] == 0xf1);
    bad_crc[7] = 4; bad_crc[8] = 1;
    assert(evox_dispatch(bad_crc, 9, reply, sizeof reply, &rom) == 1 && reply[0] == 0xf1);
    assert(calls == previous);
    const uint8_t version[] = {1};
    uint16_t length = evox_dispatch(version, 1, reply, sizeof reply, 0);
    assert(length == sizeof(EVOX_READ_VERSION) + 1U && reply[0] == 0x81);
    assert(strcmp((const char *)reply + 1, EVOX_READ_VERSION) == 0);
    memset(reply, 0xa5, sizeof reply);
    assert(evox_dispatch(crc, 9, reply, 5, &rom) == 0 && calls == previous);
    for (uint32_t i = 0; i < sizeof reply; ++i) assert(reply[i] == 0xa5);
    assert(evox_dispatch(0, 0, reply, sizeof reply, &rom) == 1 && reply[0] == 0xf1);
    assert(evox_dispatch(crc, 9, 0, sizeof reply, &rom) == 0);
    assert(evox_dispatch(version, 1, reply, 0, &rom) == 0);
    request[0] = 5;
    assert(evox_dispatch(request, 1, reply, sizeof reply, &rom) == 5 && reply[0] == 0x85 && reply[3] == 4 && reply[4] == 8);
    return 0;
}
