/* SPDX-License-Identifier: GPL-3.0-only */
#ifndef EVOX_DISPATCH_H
#define EVOX_DISPATCH_H
#include <stdint.h>
#define EVOX_READ_VERSION "ECU Explorer M32186 Read Kernel V0.1"
#define EVOX_REPLY_MAX 1025U
/* The backend reads only the validated ROM window. Return exactly 1 on success.
 * Backend failure may modify scratch bytes, but publishes only a one-byte error.
 */
struct evox_rom_io {
    void *context;
    int (*read)(void *context, uint32_t address, uint8_t *bytes, uint16_t length);
};
/* Synchronous, bounded version/size/read/CRC dispatcher. CRC regions, like reads,
 * are limited to 1..1024 bytes. No reset, authentication or programming commands
 * are implemented. Request/reply storage must be valid and disjoint.
 * Returns response size, or 0 for insufficient capacity/invalid output storage
 * (without touching output/backend). Error bytes: f0 unsupported, f1 malformed,
 * f2 backend failure. The identity requires a separate future host profile.
 */
uint16_t evox_dispatch(const uint8_t *request, uint16_t length,
                      uint8_t *reply, uint16_t capacity, const struct evox_rom_io *rom);
#endif
