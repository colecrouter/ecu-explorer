/* SPDX-License-Identifier: GPL-3.0-only
 * Original CAN0 mailbox operations from Renesas 32185/32186 manual Rev.1.10
 * sections 13.2.17/18 and 13.5/6; see ../platform/STARTUP_CAN.md for assumptions.
 */
#include "can.h"
#define RX_CONTROL UINT32_C(0x801050)
#define TX_CONTROL UINT32_C(0x801051)
#define RX_SLOT UINT32_C(0x801100)
#define TX_SLOT UINT32_C(0x801110)
#define ACTIVE 0x02U
#define FINISHED 0x01U
#define LOST 0x04U
#define REMOTE 0x20U
#define TX_REQUEST 0x80U
#define RX_REQUEST 0x40U

static int valid_io(const struct evox_can_io *io) {
    return io != 0 && io->read8 != 0 && io->write8 != 0;
}

int evox_can_try_send(const struct evox_can_io *io, const struct evox_can_frame *frame) {
    if (!valid_io(io) || frame == 0 || frame->id > 0x7ffU || frame->length > 8)
        return -1;
    if ((io->read8(io->context, TX_CONTROL) & (TX_REQUEST | ACTIVE)) != 0)
        return 0;
    io->write8(io->context, TX_CONTROL, 0);
    if ((io->read8(io->context, TX_CONTROL) & ACTIVE) != 0)
        return 0;
    io->write8(io->context, TX_SLOT, (uint8_t)(frame->id >> 6));
    io->write8(io->context, TX_SLOT + 1U, (uint8_t)(frame->id & 0x3fU));
    io->write8(io->context, TX_SLOT + 5U, frame->length);
    for (uint32_t i = 0; i < 8; ++i)
        io->write8(io->context, TX_SLOT + 6U + i,
                   i < frame->length ? frame->data[i] : 0);
    io->write8(io->context, TX_CONTROL, TX_REQUEST);
    return 1;
}

int evox_can_try_receive(const struct evox_can_io *io, struct evox_can_frame *frame) {
    if (!valid_io(io) || frame == 0)
        return -1;
    uint8_t status = io->read8(io->context, RX_CONTROL);
    if ((status & ACTIVE) != 0 || (status & FINISHED) == 0)
        return 0;
    /* Clear completion before copying; hardware may update the slot meanwhile.
     * Recheck after the copy and never publish a raced/remote/lost snapshot.
     */
    io->write8(io->context, RX_CONTROL, RX_REQUEST);
    uint8_t started = io->read8(io->context, RX_CONTROL);
    if ((started & (ACTIVE | FINISHED)) != 0)
        return -2;
    struct evox_can_frame candidate;
    for (uint32_t i = 0; i < 8; ++i) candidate.data[i] = 0;
    uint8_t id0 = io->read8(io->context, RX_SLOT);
    uint8_t id1 = io->read8(io->context, RX_SLOT + 1U);
    candidate.id = (uint16_t)(((uint16_t)id0 << 6) | id1);
    candidate.length = io->read8(io->context, RX_SLOT + 5U);
    if (id0 > 0x1fU || id1 > 0x3fU || candidate.length > 8)
        return -2;
    for (uint32_t i = 0; i < candidate.length; ++i)
        candidate.data[i] = io->read8(io->context, RX_SLOT + 6U + i);
    uint8_t finished = io->read8(io->context, RX_CONTROL);
    if (((status | started | finished) & (REMOTE | LOST)) != 0 ||
        (finished & (ACTIVE | FINISHED)) != 0)
        return -2;
    /* Field copies keep C struct padding out of the observable contract. */
    frame->id = candidate.id;
    frame->length = candidate.length;
    for (uint32_t i = 0; i < 8; ++i)
        frame->data[i] = candidate.data[i];
    return 1;
}

int evox_can_finish_send(const struct evox_can_io *io) {
    if (!valid_io(io)) return -1;
    uint8_t status = io->read8(io->context, TX_CONTROL);
    if ((status & ACTIVE) != 0 || (status & FINISHED) == 0) return 0;
    io->write8(io->context, TX_CONTROL, 0);
    return 1;
}
int evox_can_reset_slots(const struct evox_can_io *io) {
    if (!valid_io(io)) return -1;
    io->write8(io->context, TX_CONTROL, 0x0f);
    io->write8(io->context, RX_CONTROL, 0);
    uint8_t tx = io->read8(io->context, TX_CONTROL);
    uint8_t rx = io->read8(io->context, RX_CONTROL);
    if (((tx | rx) & ACTIVE) != 0) return 0;
    io->write8(io->context, TX_CONTROL, 0);
    io->write8(io->context, RX_CONTROL, RX_REQUEST);
    return 1;
}
