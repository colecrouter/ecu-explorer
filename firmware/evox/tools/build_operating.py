"""Repeat-build unadmitted LTO operating-entry ELF; no wire/binary export."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import struct
from build import ROOT, MODULES, sha
from build_platform import FLAGS


def section(path, name):
    """Read one section from a bounded big-endian ELF32 artifact."""
    blob = path.read_bytes()
    if blob[:7] != b"\x7fELF\x01\x02\x01": raise ValueError("unexpected ELF format")
    start = struct.unpack_from(">I", blob, 32)[0]
    size, count, strings_index = struct.unpack_from(">3H", blob, 46)
    if size != 40 or count > 256 or strings_index >= count or start + size * count > len(blob):
        raise ValueError("invalid section table")
    headers = [struct.unpack_from(">10I", blob, start + size * i) for i in range(count)]
    table = headers[strings_index]
    names = blob[table[4]:table[4] + table[5]]
    for header in headers:
        label = names[header[0]:].split(b"\0", 1)[0].decode()
        if label == name:
            if header[4] + header[5] > len(blob): raise ValueError("truncated section")
            return header[3], blob[header[4]:header[4] + header[5]]
    raise ValueError("missing section: " + name)


def build(prefix, output):
    output.mkdir(parents=True, exist_ok=False)
    commands, results = [], []
    tools = {name: prefix / ("m32r-elf-" + name) for name in ("gcc", "as", "ld", "nm", "objcopy", "objdump", "readelf")}
    def run(name, *args):
        argv = [str(tools[name]), *map(str, args)]
        r = subprocess.run(argv, cwd=output, capture_output=True, text=True, timeout=60)
        commands.append(dict(argv=argv, returncode=r.returncode, stdout=r.stdout, stderr=r.stderr))
        (output / "commands.json").write_text(json.dumps(commands, indent=2) + "\n")
        if r.returncode: raise RuntimeError(r.stderr)
        return r.stdout
    versions = {name: run(name, "--version").splitlines()[0] for name in tools}
    internal = {name: Path(run("gcc", "-print-prog-name=" + name).strip()).resolve()
                for name in ("cc1", "collect2", "lto1", "lto-wrapper")}
    internal["liblto_plugin"] = internal["cc1"].parent / "liblto_plugin.so"
    for name in ("ld", "as"):
        driver = Path(run("gcc", "-print-prog-name=" + name).strip()).resolve()
        if sha(driver) != sha(tools[name]): raise ValueError("driver tool differs: " + name)
    flags = [*FLAGS, "-flto", "-ffunction-sections", "-frandom-seed=evox-operating"]
    for label in ("first", "repeat"):
        work = output / label; work.mkdir()
        objects = []
        for folder, names in (("kernel", MODULES), ("platform", ("platform", "flash", "runtime", "main"))):
            for name in names:
                obj = work / (name + ".o")
                run("gcc", *flags, "-c", ROOT / folder / (name + ".c"), "-o", obj)
                objects.append(obj)
        for name, source in (("startup", "kernel/startup.S"), ("physical", "platform/physical.S"),
                             ("profile", "simulator/runtime_profile.S")):
            obj = work / (name + ".o")
            run("as", "-m32r", "-EB", ROOT / source, "-o", obj); objects.append(obj)
        elf = work / "operating.elf"
        run("gcc", *flags, "-nostdlib", "-Wl,-EB,--fatal-warnings,--gc-sections,--orphan-handling=error,--build-id=none",
            "-Wl,-u,evox_runtime_layout", "-Wl,-T," + str(ROOT / "platform/ram-candidate.ld"),
            "-Wl,-Map," + str(work / "operating.map"), *objects, "-o", elf)
        blob = elf.read_bytes()
        if (struct.unpack_from(">H", blob, 18)[0] != 88 or struct.unpack_from(">I", blob, 24)[0] != 0x80b000 or
                struct.unpack_from(">I", blob, 36)[0] != 0 or run("nm", "-u", elf).strip()):
            raise ValueError("unexpected target identity or imports")
        symbols = {parts[2]: int(parts[0], 16) for line in run("nm", "-n", elf).splitlines()
                   if len(parts := line.split()) == 3}
        base, text = section(elf, ".text")
        if base != 0x80b000 or len(text) > 5117: raise ValueError("operating code budget exceeded")
        offset = symbols["evox_runtime_profile"] - base
        if text[offset:offset + 26] != bytes(26): raise ValueError("profile must remain unadmitted")
        layout_offset = symbols["evox_runtime_layout"] - base
        layout = struct.unpack_from(">5I", text, layout_offset)
        if layout[0] != symbols["__evox_bss_end"] - symbols["__evox_bss_start"]:
            raise ValueError("runtime reservation changed")
        stack = []
        for report in work.glob("*.ltrans*.su"):
            for line in report.read_text().splitlines():
                location, amount, policy = line.split("\t")
                if policy != "static": raise ValueError("unbounded LTO frame")
                stack.append(dict(function=location.rsplit(":", 1)[1], bytes=int(amount)))
        # ASM helper wrapper pushes LR; retained factory helper body uses no stack.
        if not stack or sum(row["bytes"] for row in stack) + 4 > 1024:
            raise ValueError("operating stack budget exceeded or LTO reports missing")
        (work / "operating.disasm").write_text(run("objdump", "-dr", elf))
        (work / "operating.sections").write_text(run("readelf", "-S", elf))
        results.append(dict(elf_sha256=sha(elf), text_sha256=hashlib.sha256(text).hexdigest(),
                            code_bytes=len(text), symbols=symbols, runtime_layout=layout,
                            stack=stack, asm_stack_bytes=4))
    if results[0] != results[1]: raise ValueError("operating repeat build differs")
    manifest = dict(schema_version=1, profile="unadmitted-operating-entry", uploadable=False,
                    validation="repeat link of full LTO call graph; zero admission profile; no hardware",
                    flags=flags, versions=versions, target=results[0],
                    tools={name: sha(path) for name, path in {**tools, **internal}.items()},
                    sources={str(p.relative_to(ROOT)): sha(p) for folder in ("kernel", "platform", "tools", "test", "simulator")
                             for p in sorted((ROOT / folder).glob("*")) if p.is_file() and p.name != "validation.json"})
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--toolchain-bin", type=Path, default=os.environ.get("M32R_TOOLCHAIN_BIN"))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not args.toolchain_bin: parser.error("set --toolchain-bin or M32R_TOOLCHAIN_BIN")
    build(args.toolchain_bin.resolve(), args.out.resolve())
