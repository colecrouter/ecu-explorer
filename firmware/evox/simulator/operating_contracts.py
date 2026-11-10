"""Exact unadmitted LTO image startup; no SFR/helper mapping or hardware."""
import struct


def corpus(symbols, code):
    base, data_base, stack_base = 0x80b000, 0x80c400, 0x80d000
    size, phase, agent_fault, platform_fault, enabled = struct.unpack_from(
        ">5I", code, symbols["evox_runtime_layout"] - base)
    if not (0 < size <= 3072 and all(0 <= n < size for n in (phase, agent_fault, platform_fault, enabled))):
        raise ValueError("unsupported runtime fixture ABI")
    offset = symbols["evox_runtime_profile"] - base
    if code[offset:offset + 26] != bytes(26): raise ValueError("operating profile is admitted")
    cases = []
    for pattern, psw in ((0x5a, 0), (0xa5, 0), (0x5a, 0x40), (0xa5, 0x80)):
        seed = [0x01010101 * (r + 1) for r in range(16)] + [0] * 8
        seed[14], seed[15], seed[16], seed[21] = 0x8000, stack_base + 960, psw, symbols["evox_ram_entry"]
        data = bytes([pattern]) * 3072
        stack = bytes([pattern]) * 1024
        wanted = bytearray(data)
        if psw == 0:
            wanted[:size] = bytes(size)
            wanted[phase] = 3; wanted[agent_fault] = wanted[platform_fault] = 1
            wanted[enabled] = 0
        cases.append(dict(name=f"operating-entry-{pattern}-{psw}", seed=seed,
                          entry=seed[21], code=code, data=data, stack=stack,
                          expected_memory=[code.hex(), wanted.hex(), stack.hex()],
                          status="limit", limit=20000, result=None,
                          park=symbols["evox_startup_rejected" if psw else "evox_startup_park"],
                          expected_sp=seed[15] if psw else stack_base + 1024,
                          preserve_link=bool(psw), mutable=[] if psw else [(2, 768, 1024)]))
    return cases
