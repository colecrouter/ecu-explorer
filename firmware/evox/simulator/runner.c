/* SPDX-License-Identifier: GPL-3.0-only
 * Original bounded driver of GNU libsim's public register/memory/step API.
 * Execution semantics come from libsim; there is no local ISA/MMIO emulation.
 */
#include <inttypes.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include "sim/sim.h"
#include "sim/callback.h"

static void require(int valid, const char *message) {
    if (!valid) { fprintf(stderr, "%s\n", message); exit(1); }
}
static uint32_t word(void) {
    unsigned char b[4];
    require(fread(b, 1, 4, stdin) == 4, "truncated word");
    return (uint32_t)b[0] << 24 | (uint32_t)b[1] << 16 | (uint32_t)b[2] << 8 | b[3];
}
static void store(SIM_DESC sd, int index, uint32_t value) {
    unsigned char b[4] = {value >> 24, value >> 16, value >> 8, value};
    require(sim_store_register(sd, index, b, 4) == 4, "register store failed");
}
static uint32_t fetch(SIM_DESC sd, int index) {
    unsigned char b[4];
    require(sim_fetch_register(sd, index, b, 4) == 4, "register fetch failed");
    return (uint32_t)b[0] << 24 | (uint32_t)b[1] << 16 | (uint32_t)b[2] << 8 | b[3];
}
static void print_hex(const unsigned char *bytes, unsigned size) {
    putchar('"');
    for (unsigned i = 0; i < size; ++i) printf("%02x", bytes[i]);
    putchar('"');
}
int main(void) {
    char *options[] = {"evox-core-simulator", "--architecture=m32r", "--model", "m32r/d", NULL};
    default_callback.init(&default_callback);
    SIM_DESC sd = sim_open(SIM_OPEN_DEBUG, &default_callback, NULL, options);
    require(sd != NULL, "simulator open failed");
    uint32_t count = word();
    require(count > 0 && count <= 10000, "invalid case count");
    for (uint32_t c = 0; c < count; ++c) {
        uint32_t entry = word(), code_size = word(), limit = word();
        require(code_size > 0 && code_size <= 5117 && entry >= 0x1000 &&
                entry < 0x1000 + code_size && limit > 0 && limit <= 200000,
                "invalid execution bounds");
        uint32_t registers[24], before[24];
        for (int r = 0; r < 24; ++r) registers[r] = word();
        require(registers[21] == entry && registers[14] == 0x8000 &&
                registers[15] >= 0x30000 && registers[15] <= 0x30400 &&
                (registers[15] & 3U) == 0, "invalid entry/return/stack seed");
        unsigned sizes[3] = {code_size, 4096, 1024};
        uint32_t bases[3] = {0x1000, 0x20000, 0x30000};
        unsigned char code[5117], data[4096], stack[1024];
        unsigned char *segments[3] = {code, data, stack};
        sim_do_command(sd, "memory-delete all");
        for (unsigned s = 0; s < 3; ++s) {
            require(fread(segments[s], 1, sizes[s], stdin) == sizes[s], "truncated memory");
            char command[100];
            snprintf(command, sizeof(command), "memory-region 0x%" PRIx32 ",0x%x", bases[s], sizes[s]);
            sim_do_command(sd, command);
            require(sim_write(sd, bases[s], segments[s], sizes[s]) == sizes[s], "memory setup failed");
        }
        store(sd, 16, registers[16]);
        for (int r = 17; r < 24; ++r) store(sd, r, registers[r]);
        for (int r = 0; r < 16; ++r) store(sd, r, registers[r]);
        for (int r = 0; r < 24; ++r) before[r] = fetch(sd, r);
        const char *status = "limit";
        unsigned steps = 0;
        while (steps < limit) {
            uint32_t pc = fetch(sd, 21);
            if (pc == 0x8000) { status = "return"; break; }
            if (pc < 0x1000 || pc >= 0x1000 + code_size) { status = "escape"; break; }
            sim_resume(sd, 1, 0);
            ++steps;
            enum sim_stop reason;
            int signal_number;
            sim_stop_reason(sd, &reason, &signal_number);
            if (reason != sim_stopped || signal_number != SIGTRAP) { status = "fault"; break; }
        }
        if (fetch(sd, 21) == 0x8000) status = "return";
        printf("{\"id\":%" PRIu32 ",\"status\":\"%s\",\"steps\":%u,\"before\":[", c, status, steps);
        for (int r = 0; r < 24; ++r) printf("%s%" PRIu32, r ? "," : "", before[r]);
        printf("],\"after\":[");
        for (int r = 0; r < 24; ++r) printf("%s%" PRIu32, r ? "," : "", fetch(sd, r));
        printf("],\"memory\":[");
        for (unsigned s = 0; s < 3; ++s) {
            require(sim_read(sd, bases[s], segments[s], sizes[s]) == sizes[s], "snapshot failed");
            if (s) putchar(',');
            print_hex(segments[s], sizes[s]);
        }
        printf("]}\n");
    }
    require(getchar() == EOF, "trailing input");
    sim_close(sd, 0);
    return 0;
}
