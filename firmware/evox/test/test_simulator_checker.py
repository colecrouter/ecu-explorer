"""Failure injection for the simulator's acceptance checks, without libsim."""
import copy
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "simulator"))
from contracts import check, corpus, RETURN


class SimulatorChecker(unittest.TestCase):
    def setUp(self):
        self.case = corpus(dict(evox_crc32=0x1004, evox_parse_read=0x1040,
                               evox_offline_entry=0x1000), b"code")[1]
        self.row = dict(id=0, status="return", steps=50,
                        before=self.case["seed"][:], after=self.case["seed"][:],
                        memory=self.case["expected_memory"][:])
        self.row["after"][0] = self.case["result"]
        self.row["after"][21] = RETURN

    def test_valid_snapshot(self):
        check(self.case, self.row, 0)

    def test_rejects_corrupted_observations(self):
        for field in ("result", "register", "code", "data", "stack", "return", "status", "seed", "steps"):
            with self.subTest(field=field):
                row = copy.deepcopy(self.row)
                if field == "result":
                    row["after"][0] ^= 1
                elif field == "register":
                    row["after"][8] ^= 1
                elif field in ("code", "data", "stack"):
                    row["memory"][("code", "data", "stack").index(field)] = "00"
                elif field == "return":
                    row["after"][21] ^= 4
                elif field == "status":
                    row["status"] = "fault"
                elif field == "seed":
                    row["before"][0] ^= 1
                else:
                    row["steps"] = self.case["limit"] + 1
                with self.assertRaises(ValueError):
                    check(self.case, row, 0)


if __name__ == "__main__":
    unittest.main()
