"""Fresh M32R build and finite GNU libsim execution; no hardware or ROM inputs."""
import argparse
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys

from contracts import check, corpus

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))
from build import build, sha


def execute(args):
    output = args.out.resolve()
    output.mkdir(parents=True, exist_ok=False)
    source, engine = args.gdb_source.resolve(), args.gdb_build.resolve()
    lock = json.loads((ROOT / "simulator/engine-lock.json").read_text())
    pinned = {}
    for kind, base in (("source", source), ("build", engine)):
        for relative, digest in lock["files"][kind].items():
            path = base / relative
            if sha(path) != digest:
                raise ValueError(f"simulator pin mismatch: {path}")
            pinned[str(path)] = digest
    # Also bind all implementation inputs before compiling anything.
    for directory in ("kernel", "tools", "test", "simulator"):
        for path in sorted((ROOT / directory).glob("*")):
            if path.is_file() and path.name != "validation.json":
                pinned[str(path)] = sha(path)
    compiler = Path(shutil.which(args.host_cc) or args.host_cc).resolve()
    pinned[str(compiler)] = sha(compiler)
    commands = []

    def run(argv, binary_input=None):
        result = subprocess.run(list(map(str, argv)), capture_output=True,
                                input=binary_input, timeout=180)
        commands.append(dict(argv=list(map(str, argv)), returncode=result.returncode,
                             stdout=result.stdout.decode(), stderr=result.stderr.decode()))
        (output / "commands.json").write_text(json.dumps(commands, indent=2) + "\n")
        if result.returncode:
            raise RuntimeError(result.stderr.decode())
        return result.stdout

    for name in ("gcc", "as", "ld", "nm", "objcopy", "objdump", "readelf"):
        path = args.toolchain_bin.resolve() / ("m32r-elf-" + name)
        pinned[str(path)] = sha(path)
    cc1 = Path(run([args.toolchain_bin.resolve() / "m32r-elf-gcc",
                    "-print-prog-name=cc1"]).decode().strip())
    pinned[str(cc1)] = sha(cc1)
    build(args.toolchain_bin.resolve(), output / "target")
    target_manifest = json.loads((output / "target/manifest.json").read_text())
    for name in ("gcc", "as", "ld", "nm", "objcopy", "objdump", "readelf"):
        path = args.toolchain_bin.resolve() / ("m32r-elf-" + name)
        if pinned[str(path)] != target_manifest["tools"][name]:
            raise ValueError(f"target tool changed during build: {path}")
    elf = output / "target/first/core.elf"
    binary = output / "target/first/core.bin"
    pinned[str(elf)], pinned[str(binary)] = sha(elf), sha(binary)
    symbols = {}
    for line in run([args.toolchain_bin.resolve() / "m32r-elf-nm", "-n", elf]).decode().splitlines():
        fields = line.split()
        if len(fields) == 3 and fields[1] == "T":
            symbols[fields[2]] = int(fields[0], 16)
    runner = output / "runner"
    link = [compiler, "-std=c11", "-O2", "-Wall", "-Wextra", "-Werror",
            "-include", engine / "sim/config.h", "-I", source / "include",
            "-I", engine / "bfd", "-I", source / "bfd",
            ROOT / "simulator/runner.c"]
    link.extend(engine / path for path in lock["files"]["build"] if path.endswith(".a"))
    if args.library_dir:
        link.extend(["-L", args.library_dir.resolve()])
    link.extend(["-lz", "-lzstd"])
    if sys.platform == "darwin":
        link.append("-liconv")
    link.extend(["-lm", "-o", runner])
    run(link)
    pinned[str(runner)] = sha(runner)
    cases = corpus(symbols, binary.read_bytes())
    packet = bytearray(struct.pack(">I", len(cases)))
    for case in cases:
        packet.extend(struct.pack(">III", case["entry"], len(case["code"]), case["limit"]))
        packet.extend(struct.pack(">24I", *case["seed"]))
        packet.extend(case["code"] + case["data"] + case["stack"])
    packet_path = output / "input.packet"
    packet_path.write_bytes(packet)
    pinned[str(packet_path)] = sha(packet_path)
    rows_path = output / "snapshots.jsonl"
    rows_path.write_bytes(run([runner], packet))
    pinned[str(rows_path)] = sha(rows_path)
    rows = [json.loads(line) for line in rows_path.read_text().splitlines()]
    if len(rows) != len(cases):
        raise ValueError("incomplete simulator output")
    for index, (case, row) in enumerate(zip(cases, rows)):
        check(case, row, index)
    for path, digest in pinned.items():
        if sha(Path(path)) != digest:
            raise ValueError(f"input/output changed during execution: {path}")
    result = dict(schema_version=1, validation="finite compiled M32R execution; no ECU hardware",
                  engine=lock["engine"], model=lock["model"], cases=len(cases),
                  returned=sum(row["status"] == "return" for row in rows),
                  limit_controls=sum(row["status"] == "limit" for row in rows),
                  fault_controls=sum(row["status"] == "fault" for row in rows),
                  max_steps=max(row["steps"] for row in rows), symbols=symbols,
                  target=target_manifest["target"], host_cc_version=run([compiler, "--version"]).decode(),
                  pins=pinned, case_results=[dict(name=case["name"], status=row["status"],
                                                 steps=row["steps"]) for case, row in zip(cases, rows)])
    (output / "validation.json").write_text(json.dumps(result, indent=2) + "\n")
    print(f'PASS: {result["returned"]} returns, {result["limit_controls"]} instruction-limit control, {result["fault_controls"]} fault control')
    print(f'Evidence: {output / "validation.json"}')


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--toolchain-bin", type=Path, default=os.environ.get("M32R_TOOLCHAIN_BIN"))
    parser.add_argument("--gdb-source", type=Path, required=True)
    parser.add_argument("--gdb-build", type=Path, required=True)
    parser.add_argument("--library-dir", type=Path)
    parser.add_argument("--host-cc", default=os.environ.get("CC", "cc"))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not args.toolchain_bin:
        parser.error("set --toolchain-bin or M32R_TOOLCHAIN_BIN")
    execute(args)
