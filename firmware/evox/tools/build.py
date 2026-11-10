"""Build an offline M32R core twice. Outputs cannot be used by the ECU uploader."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
MODULES = ("core", "can", "isotp", "dispatch", "agent")
FLAGS = ["-std=c11", "-Os", "-m32r", "-Wa,-EB", "-mmodel=large", "-msdata=none",
         "-ffreestanding", "-fno-builtin", "-fno-common", "-fno-pic", "-fno-ident",
         "-fstack-usage", "-Wall", "-Wextra", "-Wconversion", "-Wshadow", "-Werror"]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(prefix, output, startup_probe=False):
    output.mkdir(parents=True, exist_ok=False)
    commands = []
    tools = {name: prefix / ("m32r-elf-" + name)
             for name in ("gcc", "as", "ld", "nm", "objcopy", "objdump", "readelf")}

    def run(name, *args):
        argv = [str(tools[name]), *map(str, args)]
        result = subprocess.run(argv, cwd=output, capture_output=True, text=True, timeout=60)
        commands.append(dict(argv=argv, returncode=result.returncode,
                             stdout=result.stdout, stderr=result.stderr))
        (output / "commands.json").write_text(json.dumps(commands, indent=2) + "\n")
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout

    versions = {name: run(name, "--version").splitlines()[0] for name in tools}
    cc1 = Path(run("gcc", "-print-prog-name=cc1").strip())
    results = []
    for name in ("first", "repeat"):
        work = output / name
        work.mkdir()
        for module in MODULES:
            run("gcc", *FLAGS, "-I", ROOT / "kernel", "-c", ROOT / "kernel" / (module + ".c"),
                "-o", work / (module + ".o"))
        run("as", "-m32r", "-EB", ROOT / "kernel/entry.S", "-o", work / "entry.o")
        extra = []
        if startup_probe:
            run("as", "-m32r", "-EB", ROOT / "kernel/startup.S", "-o", work / "startup.o")
            run("gcc", *FLAGS, "-c", ROOT / "simulator/startup_probe.c",
                "-o", work / "startup_probe.o")
            run("gcc", *FLAGS, "-c", ROOT / "simulator/isotp_probe.c",
                "-o", work / "isotp_probe.o")
            run("as", "-m32r", "-EB", ROOT / "simulator/dispatch_probe.S", "-o", work / "dispatch_probe.o")
            extra = [work / "dispatch_probe.o", work / "startup.o", work / "startup_probe.o", work / "isotp_probe.o",
                     "--defsym=__evox_stack_top=0x30400",
                     "--defsym=__evox_bss_start=0x20000",
                     "--defsym=__evox_bss_end=0x20020"]
        elf = work / "core.elf"
        run("ld", "-EB", "--fatal-warnings", "--orphan-handling=error",
            "-T", ROOT / "kernel/link.ld", "-Map", work / "core.map",
            work / "entry.o", *[work / (module + ".o") for module in MODULES], *extra, "-o", elf)
        if run("nm", "-u", elf).strip():
            raise ValueError("unresolved target symbols")
        header = elf.read_bytes()
        if (header[:7] != b"\x7fELF\x01\x02\x01" or
                int.from_bytes(header[18:20], "big") != 88 or
                int.from_bytes(header[24:28], "big") != 0x1000 or
                int.from_bytes(header[36:40], "big") != 0):
            raise ValueError("unexpected M32R ELF identity/entry/flags")
        binary = work / "core.bin"
        run("objcopy", "-O", "binary", elf, binary)
        if not 0 < binary.stat().st_size <= 5117:
            raise ValueError("offline code exceeds captured loader span")
        (work / "disassembly.txt").write_text(run("objdump", "-dr", elf))
        (work / "sections.txt").write_text(run("readelf", "-S", elf))
        stack = []
        stack_reports = "".join((work / (module + ".su")).read_text() for module in MODULES)
        if startup_probe:
            stack_reports += (work / "startup_probe.su").read_text() + (work / "isotp_probe.su").read_text()
        for line in stack_reports.splitlines():
            location, size, policy = line.split("\t")
            if policy != "static":
                raise ValueError("unbounded stack usage")
            stack.append(dict(function=location.rsplit(":", 1)[1], bytes=int(size)))
        if sum(item["bytes"] for item in stack) > 256:
            raise ValueError("offline core stack budget exceeded")
        results.append(dict(elf_sha256=sha(elf), binary_sha256=sha(binary),
                            code_bytes=binary.stat().st_size, stack=stack))
    if results[0] != results[1]:
        raise ValueError("repeat builds differ")
    manifest = dict(schema_version=1, validation="offline static link and repeat build only",
                    uploadable=False, startup_probe=startup_probe, flags=FLAGS, versions=versions,
                    tools={name: sha(path) for name, path in {**tools, "cc1": cc1}.items()},
                    sources={str(path.relative_to(ROOT)): sha(path)
                             for directory in ("kernel", "tools", "test")
                             for path in sorted((ROOT / directory).glob("*")) if path.is_file()},
                    target=results[0])
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--toolchain-bin", type=Path,
                        default=os.environ.get("M32R_TOOLCHAIN_BIN"))
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if not args.toolchain_bin:
        parser.error("set --toolchain-bin or M32R_TOOLCHAIN_BIN")
    build(args.toolchain_bin.resolve(), args.out.resolve())
