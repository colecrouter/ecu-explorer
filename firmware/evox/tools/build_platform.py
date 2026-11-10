"""Repeat-build physical-backend library and unadmitted layout proof, no upload."""
import argparse
import json
import os
from pathlib import Path
import subprocess
from build import ROOT, FLAGS as CORE_FLAGS, MODULES, sha

# The candidate linker constrains all code/state/stack below 16 MiB.
FLAGS = ["-mmodel=small" if flag == "-mmodel=large" else flag for flag in CORE_FLAGS]


def build(prefix, output, probe=False):
    output.mkdir(parents=True, exist_ok=False)
    commands, runs = [], []
    tools = {name: prefix / ("m32r-elf-" + name)
             for name in ("gcc", "as", "ld", "nm", "objcopy", "objdump", "readelf")}

    def run(tool, *args):
        argv = [str(tools[tool]), *map(str, args)]
        result = subprocess.run(argv, capture_output=True, text=True, cwd=output, timeout=60)
        commands.append(dict(argv=argv, returncode=result.returncode, stdout=result.stdout, stderr=result.stderr))
        (output / "commands.json").write_text(json.dumps(commands, indent=2) + "\n")
        if result.returncode:
            raise RuntimeError(result.stderr)
        return result.stdout

    versions = {name: run(name, "--version").splitlines()[0] for name in tools}
    cc1 = Path(run("gcc", "-print-prog-name=cc1").strip())

    def symbols(elf):
        return {parts[2]: int(parts[0], 16) for line in run("nm", "-n", elf).splitlines()
                if len(parts := line.split()) == 3}

    def stack_bytes(files):
        reports = []
        for path in files:
            for line in path.read_text().splitlines():
                location, size, policy = line.split("\t")
                if policy != "static": raise ValueError("unbounded stack")
                reports.append(dict(function=location.rsplit(":", 1)[1], bytes=int(size)))
        return reports

    def inspect(elf, expected_entry):
        header = elf.read_bytes()
        if (header[:7] != b"\x7fELF\x01\x02\x01" or int.from_bytes(header[18:20], "big") != 88 or
                int.from_bytes(header[24:28], "big") != expected_entry or int.from_bytes(header[36:40], "big") != 0):
            raise ValueError("unexpected target identity")
        if run("nm", "-u", elf).strip(): raise ValueError("unresolved target symbols")
        elf.with_suffix(".disasm").write_text(run("objdump", "-dr", elf))
        elf.with_suffix(".sections").write_text(run("readelf", "-S", elf))

    for label in ("first", "repeat"):
        work = output / label
        work.mkdir()
        run("gcc", *FLAGS, "-ffunction-sections", "-c", ROOT / "platform/platform.c", "-o", work / "platform.o")
        run("gcc", *FLAGS, "-ffunction-sections", "-c", ROOT / "platform/flash.c", "-o", work / "flash.o")
        run("as", "-m32r", "-EB", ROOT / "platform/physical.S", "-o", work / "physical.o")
        run("as", "-m32r", "-EB", ROOT / "kernel/entry.S", "-o", work / "entry.o")
        library_objects = [work / "entry.o", work / "platform.o", work / "physical.o", work / "flash.o"]
        library_reports = [work / "platform.su", work / "flash.su"]
        if probe:
            run("gcc", *FLAGS, "-c", ROOT / "simulator/platform_layout.c", "-o", work / "probe.o")
            library_objects.append(work / "probe.o")
            library_reports.append(work / "probe.su")
        library = work / "core.elf"
        run("ld", "-EB", "--fatal-warnings", "--orphan-handling=error", "-T", ROOT / "kernel/link.ld",
            "-Map", work / "core.map", *library_objects, "-o", library)
        inspect(library, 0x1000)
        binary = work / "core.bin"
        run("objcopy", "-O", "binary", library, binary)
        reports = stack_bytes(library_reports)
        if binary.stat().st_size > 5117 or sum(r["bytes"] for r in reports) > 256:
            raise ValueError("backend code/stack budget exceeded")
        # Real-address link validation only: test main, no executable/wire export.
        for module in MODULES:
            run("gcc", *FLAGS, "-c", ROOT / "kernel" / (module + ".c"), "-o", work / (module + ".o"))
        run("as", "-m32r", "-EB", ROOT / "kernel/startup.S", "-o", work / "startup.o")
        run("gcc", *FLAGS, "-c", ROOT / "simulator/layout_probe.c", "-o", work / "layout_probe.o")
        layout = work / "layout-probe.elf"
        run("ld", "-EB", "--fatal-warnings", "--gc-sections", "--orphan-handling=error", "-T", ROOT / "platform/ram-candidate.ld",
            *["--undefined=" + name for name in (
                "evox_platform_open", "evox_platform_now", "evox_platform_bind",
                "evox_platform_validate", "evox_clock_init", "evox_clock_advance")],
            "-Map", work / "layout.map", work / "startup.o", work / "layout_probe.o", work / "platform.o",
            work / "physical.o", work / "flash.o", *[work / (name + ".o") for name in MODULES], "-o", layout)
        inspect(layout, 0x80b000)
        addresses = symbols(layout)
        if max(addresses[name] for name in ("__evox_code_end", "__evox_bss_end", "__evox_stack_top")) >= 0x1000000:
            raise ValueError("small-model candidate exceeds 24-bit placement")
        if "evox_flash_init" in addresses or "evox_flash_step" in addresses:
            raise ValueError("link-only fixture unexpectedly invokes transition planner")
        if "evox_flash_normal" not in addresses or "evox_agent_step" not in addresses:
            raise ValueError("candidate admission/service code was removed")
        layout_reports = stack_bytes([work / (name + ".su") for name in (*MODULES, "platform", "flash", "layout_probe")])
        if sum(r["bytes"] for r in layout_reports) > 1024: raise ValueError("candidate stack reservation exceeded")
        runs.append(dict(elf_sha256=sha(library), binary_sha256=sha(binary), code_bytes=binary.stat().st_size,
                         stack=reports, layout=dict(elf_sha256=sha(layout), uploadable=False,
                         unreferenced_transition_planner_omitted=True,
                         code_bytes=addresses["__evox_code_end"] - 0x80b000,
                         bss_start=addresses["__evox_bss_start"], bss_end=addresses["__evox_bss_end"],
                         stack_bottom=addresses["__evox_stack_bottom"], stack_top=addresses["__evox_stack_top"],
                         stack=layout_reports)))
    if runs[0] != runs[1]: raise ValueError("repeat build differs")
    manifest = dict(schema_version=1, profile="physical-backend-library", probe=probe, uploadable=False,
                    validation="static repeat build; real-address layout is link-only and unadmitted",
                    flags=FLAGS, versions=versions, target=runs[0],
                    tools={name: sha(path) for name, path in {**tools, "cc1": cc1}.items()},
                    sources={str(path.relative_to(ROOT)): sha(path) for folder in ("kernel", "platform", "tools", "test", "simulator")
                             for path in sorted((ROOT / folder).glob("*")) if path.is_file() and path.name != "validation.json"})
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--toolchain-bin", type=Path, default=os.environ.get("M32R_TOOLCHAIN_BIN"))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    if not args.toolchain_bin: parser.error("set --toolchain-bin or M32R_TOOLCHAIN_BIN")
    build(args.toolchain_bin.resolve(), args.out.resolve())
