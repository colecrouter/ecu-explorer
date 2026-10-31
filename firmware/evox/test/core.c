/* Original contract vectors; no ROM or captured executable bytes. */
#include "core.h"
#include <assert.h>
#include <stdint.h>

int main(void) {
    static const uint8_t vector[] = "123456789";
    uint8_t read[] = {3, 0, 0x0f, 0xfc, 0, 4, 0};
    struct evox_region region = {123, 456};
    assert(evox_crc32(vector, 9) == UINT32_C(0xcbf43926));
    assert(evox_crc32(vector, 0) == 0);
    assert(evox_parse_read(read, sizeof read, &region) == 1);
    assert(region.address == UINT32_C(0xffc00) && region.length == 1024);
    read[4] = 1; /* One byte beyond the end of ROM. */
    assert(evox_parse_read(read, sizeof read, &region) == 0);
    assert(region.address == UINT32_C(0xffc00) && region.length == 1024);
    read[4] = 0;
    read[5] = 0;
    assert(evox_parse_read(read, sizeof read, &region) == 0); /* zero length */
    read[5] = 4;
    read[6] = 1;
    assert(evox_parse_read(read, sizeof read, &region) == 0); /* too large */
    read[6] = 0;
    read[1] = 0xff; /* Reject wraparound addresses. */
    assert(evox_parse_read(read, sizeof read, &region) == 0);
    read[1] = 0;
    for (uint32_t command = 0; command < 256; ++command) {
        read[0] = (uint8_t)command;
        assert(evox_parse_read(read, sizeof read, &region) == (command == 3));
    }
    read[0] = 3;
    for (uint32_t length = 0; length < 7; ++length)
        assert(evox_parse_read(read, length, &region) == 0);
    assert(evox_parse_read(read, 8, &region) == 0);
    assert(evox_parse_read(0, 7, &region) == 0);
    assert(evox_parse_read(read, 7, 0) == 0);
    read[2] = 0;
    read[3] = 0;
    read[5] = 0;
    read[6] = 1;
    assert(evox_parse_read(read, 7, &region) == 1);
    assert(region.address == 0 && region.length == 1);
    return 0;
}
