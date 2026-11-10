"""Expected synthetic memory/ABI contracts for the physical-backend library."""
import struct
from contracts import DATA, OUTPUT, SP, RETURN


def corpus(symbols, code):
    layout = symbols["evox_platform_layout"] - 0x1000
    if struct.unpack(">6I", code[layout:layout + 24]) != (20, 20, 16, 24, 20, 21):
        raise ValueError("unsupported backend fixture ABI layout")
    cases = []

    def add(name, function, args, result, patches=None, expected=None, stack_arg=None, psw=0):
        pattern = 0x5a if len(cases) % 2 == 0 else 0xa5
        data = bytearray([pattern] * 4096)
        for offset, value in (patches or {}).items(): data[offset:offset + len(value)] = value
        wanted = bytearray(data)
        for offset, value in (expected or {}).items(): wanted[offset:offset + len(value)] = value
        seed = [(0x01010101 * (r + 1)) ^ (pattern * 0x01010101) for r in range(16)] + [0] * 8
        seed[:len(args)] = args
        seed[14], seed[15], seed[16], seed[21] = RETURN, SP - 16, psw, symbols[function]
        stack = bytearray([pattern] * 1024)
        if stack_arg is not None: stack[1008:1012] = struct.pack(">I", stack_arg)
        cases.append(dict(name=name, seed=seed, entry=symbols[function], code=code,
                          data=bytes(data), stack=bytes(stack),
                          expected_memory=[code.hex(), wanted.hex(), stack.hex()],
                          result=result, status="return", limit=200000,
                          mutable=[(2, 752, 1008)]))
        return pattern

    add("physical-byte-load", "evox_physical_load8", [DATA + 2], 0x81, patches={2: b"\x81"})
    add("physical-halfword-load", "evox_physical_load16", [DATA + 2], 0xabcd, patches={2: b"\xab\xcd"})
    add("physical-byte-store", "evox_physical_store8", [DATA + 3, 0x81], DATA + 3, expected={3: b"\x81"})
    cases[-1]["void_return"] = True
    for psw in (0, 0x40, 0x80): add(f"physical-psw-{psw}", "evox_physical_psw", [], psw, psw=psw)
    valid_profile = struct.pack(">5H9B", 2, 1, 100, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1)
    for psw, fmt, admitted in ((0, 0, 1), (0x40, 0, 1), (0x80, 0, 1), (0, 0x8000, 1), (0, 0, 0)):
        profile = bytearray(valid_profile); profile[18] = admitted
        snapshot = struct.pack(">I3H10B", psw, 0, 0, fmt, 1, 0, 0, 0, 0, 0, 0, 0, 0x1f, 0x20)
        add(f"profile-{psw}-{fmt}-{admitted}", "evox_platform_validate", [DATA + 256, DATA + 512],
            int(psw == 0 and fmt == 0 and admitted == 1), patches={256: profile, 512: snapshot})
    clock = struct.pack(">I5HB", 0, 65530, 0, 2, 1, 100, 0)
    add("clock-init", "evox_clock_init", [DATA + 256, 65530, 2, 1], 1,
        expected={256: clock}, stack_arg=100)
    add("clock-invalid", "evox_clock_init", [DATA + 256, 0, 2, 0], 0,
        expected={270: b"\x01"}, stack_arg=100)
    for name, micro, previous, rem, num, den, maximum, raw, success in (
        ("fraction-wrap", 10, 65530, 3, 4, 5, 100, 5, True),
        ("microsecond-wrap", 0xfffffffe, 0, 0, 2, 1, 100, 2, True),
        ("excess-gap", 10, 0, 0, 2, 1, 100, 101, False),
    ):
        initial = struct.pack(">I5HB", micro, previous, rem, num, den, maximum, 0)
        if success:
            scaled = ((raw - previous) & 0xffff) * num + rem
            total = (micro + scaled // den) & 0xffffffff
            final = struct.pack(">I5HB", total, raw, scaled % den, num, den, maximum, 0)
            changes = {256: final, OUTPUT - DATA: struct.pack(">I", total)}
        else: changes = {270: b"\x01"}
        add(name, "evox_clock_advance", [DATA + 256, raw, OUTPUT], int(success),
            patches={256: initial}, expected=changes)
    # Enable the callback only in this controlled mapped arena; profile admission
    # itself is exercised separately. No physical SFR address is mapped/executed.
    state = bytearray(24); state[20] = 1
    pattern = 0x5a if len(cases) % 2 == 0 else 0xa5
    add("rom-byte-backend", "read_rom", [DATA + 256, DATA + 512, OUTPUT, 9], 1,
        patches={256: state}, expected={OUTPUT - DATA: bytes([pattern]) * 9})
    disabled = bytearray(state); disabled[20] = 0; disabled[21] = 1
    add("rom-backend-reject-wrap", "read_rom", [DATA + 256, 0xffffffff, OUTPUT, 2], 0,
        patches={256: state}, expected={256: disabled})
    profile = bytearray(valid_profile); profile[18] = 0
    add("unadmitted-open-no-mmio", "evox_platform_open", [DATA + 256, DATA + 512], 0,
        patches={512: profile}, expected={276: b"\x00\x01"})
    return cases
