"""Independent vectors and observable contracts for compiled M32R execution."""
import binascii
import struct

DATA, OUTPUT, SP, RETURN = 0x20000, 0x20800, 0x30400, 0x8000


def corpus(symbols, code):
    cases = []

    def add(name, function, args, payload=b"", expected=0, region=None, status="return", limit=200000):
        pattern = 0xa5 if len(cases) % 2 else 0x5a
        data = bytearray([pattern] * 4096)
        data[1:1 + len(payload)] = payload
        wanted = bytearray(data)
        if region is not None:
            wanted[OUTPUT - DATA:OUTPUT - DATA + 8] = struct.pack(">II", *region)
        seed = [((r + 1) * 0x01010101 ^ (pattern * 0x01010101)) & 0xffffffff
                for r in range(16)] + [0] * 8
        seed[:len(args)] = args
        seed[14], seed[15], seed[21] = RETURN, SP, symbols[function]
        cases.append(dict(name=name, seed=seed, entry=symbols[function],
                          code=code, data=bytes(data), stack=bytes([pattern] * 1024),
                          expected_memory=[code.hex(), wanted.hex(), bytes([pattern] * 1024).hex()],
                          result=expected, status=status, limit=limit))

    vectors = [b"", b"123456789", bytes(range(256)), bytes(1024), bytes([255]) * 1024]
    vectors.extend(bytes([value]) for value in range(256))
    for i, value in enumerate(vectors):
        add(f"crc-{i}", "evox_crc32", [DATA + 1, len(value)], value,
            binascii.crc32(value) & 0xffffffff)
    add("crc-null-empty", "evox_crc32", [0, 0])

    def request(name, command=3, address=0, length=1, size=7, pointer=DATA + 1, output=OUTPUT):
        wire = bytes([command]) + struct.pack(">IH", address, length)
        valid = (pointer != 0 and output != 0 and command == 3 and size == 7 and
                 1 <= length <= 1024 and 0 <= address < 1048576 and
                 address + length <= 1048576)
        add(name, "evox_parse_read", [pointer, size, output], wire, int(valid),
            (address, length) if valid else None)

    for command in range(256):
        request(f"command-{command}", command=command)
    for address in (0, 1, 1047552, 1048575, 1048576, 0xffffffff, 0xfffffc00):
        for length in (0, 1, 2, 1023, 1024, 1025, 65535):
            request(f"region-{address}-{length}", address=address, length=length)
    for size in (*range(7), 8, 0xffffffff):
        # An unmapped pointer proves malformed sizes return without inspecting it.
        request(f"size-{size}", size=size, pointer=0xdead0000)
    request("null-input", pointer=0)
    request("null-output", output=0)
    add("unmapped-read-control", "evox_crc32", [0xdead0000, 1], status="fault")
    add("instruction-limit-control", "evox_offline_entry", [], status="limit", limit=8)
    if "evox_ram_entry" in symbols:
        for variant in range(2):
            add(f"startup-dirty-bss-{variant}", "evox_ram_entry", [], status="limit", limit=1500)
            case = cases[-1]
            case["seed"][15] = SP - 256
            memory = bytearray(case["data"])
            memory[:32] = bytes(32)
            memory[32:36] = b"BOOT"
            case["expected_memory"][1] = memory.hex()
            case["park"] = symbols["evox_startup_park"]
    if "evox_isotp_probe" in symbols:
        for scenario in range(3):
            add(f"isotp-probe-{scenario}", "evox_isotp_probe", [scenario, DATA + 256], expected=1)
            cases[-1]["mutable"] = [(1, 256, 1356), (2, 768, 1024)]
    return cases


def check(case, row, index):
    """Reject incorrect results, hidden writes, ABI damage, and unexpected stops."""
    if row["id"] != index or row["status"] != case["status"]:
        raise ValueError(f'{case["name"]}: unexpected execution status/order')
    if not 0 < row["steps"] <= case["limit"]:
        raise ValueError(f'{case["name"]}: invalid instruction count')
    if row["before"][:16] != case["seed"][:16] or row["before"][21] != case["entry"]:
        raise ValueError(f'{case["name"]}: input registers not established')
    if len(row["memory"]) != len(case["expected_memory"]):
        raise ValueError("missing memory snapshots")
    for segment, (actual, expected) in enumerate(zip(row["memory"], case["expected_memory"])):
        got, wanted = bytearray.fromhex(actual), bytearray.fromhex(expected)
        if len(got) != len(wanted):
            raise ValueError("incorrect snapshot size")
        for index_segment, begin, end in case.get("mutable", []):
            if segment == index_segment:
                got[begin:end] = wanted[begin:end]
        if got != wanted:
            raise ValueError(f'{case["name"]}: unexpected memory changes')
    end = 14 if "park" in case else 16
    if row["after"][8:end] != row["before"][8:end]:
        raise ValueError(f'{case["name"]}: callee-preserved register changed')
    if "park" in case:
        if row["after"][15] != SP or row["after"][21] != case["park"]:
            raise ValueError("startup did not establish stack and park after C main")
    if case["status"] == "return":
        if row["after"][21] != RETURN or row["after"][0] != case["result"]:
            raise ValueError(f'{case["name"]}: incorrect result/return')
    elif case["status"] == "limit" and row["steps"] != case["limit"]:
        raise ValueError("instruction-limit control did not exhaust its budget")
