"""Compile and execute the original C contracts on the host, without hardware."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CoreContracts(unittest.TestCase):
    def test_isotp_contracts(self):
        self.compile_contract("isotp")

    def test_can_contracts(self):
        self.compile_contract("can")

    def test_host_contracts(self):
        self.compile_contract("core")

    def compile_contract(self, name):
        with tempfile.TemporaryDirectory(prefix="evox-core-") as directory:
            binary = Path(directory) / "contracts"
            subprocess.run([
                os.environ.get("CC", "cc"), "-std=c11", "-Wall", "-Wextra",
                "-Wconversion", "-Wshadow", "-Werror", "-pedantic",
                "-fsanitize=address,undefined", "-I", str(ROOT / "kernel"),
                str(ROOT / "kernel" / (name + ".c")), str(ROOT / "test" / (name + ".c")),
                "-o", str(binary),
            ], check=True, timeout=60)
            subprocess.run([str(binary)], check=True, timeout=10)


if __name__ == "__main__":
    unittest.main()
