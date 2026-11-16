"""Cache integrity contracts independent of GNU installation or network."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('evox_setup', Path(__file__).resolve().parents[1] / 'simulator/setup.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class InstallationIntegrity(unittest.TestCase):
    def test_complete_cache_and_tampering(self):
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)
            (work / 'gdb-16.3').mkdir(); (work / 'build').mkdir()
            header = work / 'gdb-16.3/api.h'; header.write_bytes(b'API')
            library = work / 'build/libsim.a'; library.write_bytes(b'library')
            lock = dict(archive_sha256='release', files=dict(source={'api.h': module.digest(header)}, build={'libsim.a': 'host-specific-old-hash'}))
            saved = dict(archive_sha256='release', files=dict(source=lock['files']['source'], build={'libsim.a': module.digest(library)}))
            manifest = work / 'installation.json'; manifest.write_text(json.dumps(saved))
            self.assertEqual(module.verify_installation(work, lock), saved)
            library.write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'changed'): module.verify_installation(work, lock)
            saved['files']['build'] = {}; manifest.write_text(json.dumps(saved))
            with self.assertRaisesRegex(ValueError, 'incomplete'): module.verify_installation(work, lock)
