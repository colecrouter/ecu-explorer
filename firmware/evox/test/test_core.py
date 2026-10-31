"""Compile and execute the original C contracts on the host, without hardware."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class CoreContracts(unittest.TestCase):
    def test_host_contracts(self):
        with tempfile.TemporaryDirectory(prefix="evox-core-") as directory:
            binary = Path(directory) / "contracts"
            subprocess.run([
                os.environ.get("CC", "cc"), "-std=c11", "-Wall", "-Wextra",
                "-Wconversion", "-Wshadow", "-Werror", "-pedantic",
                "-fsanitize=address,undefined", "-I", str(ROOT / "kernel"),
                str(ROOT / "kernel/core.c"), str(ROOT / "test/core.c"),
                "-o", str(binary),
            ], check=True, timeout=60)
            subprocess.run([str(binary)], check=True, timeout=10)


if __name__ == "__main__":
    unittest.main()
