"""Synthetic admitted-profile execution of operating instructions; never hardware."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys
import tempfile
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from build_operating import section


def execute(base):
    validation = json.loads((base / 'validation.json').read_text())
    for path, digest in validation['pins'].items():
        candidate = Path(path)
        if candidate.is_file() and candidate.parent.name in ('kernel', 'platform'):
            if hashlib.sha256(candidate.read_bytes()).hexdigest() != digest:
                raise ValueError('implementation changed: ' + path)
    target = json.loads((base / 'target/manifest.json').read_text())['target']
    symbols = target['symbols']
    elf = base / 'target/first/operating.elf'
    if hashlib.sha256(elf.read_bytes()).hexdigest() != target['elf_sha256']:
        raise ValueError('operating image changed')
    _, original = section(elf, '.text')
    layout = target['runtime_layout']; runtime = symbols['__evox_bss_start']
    runner = (Path(__file__).parent / 'runner.c').read_text()
    marker = '        store(sd, 16, registers[16]);'
    setup = '''        unsigned char sfr[0x2000] = {0};
        sfr[0x3cb] = 1; sfr[0x1e0] = 0x11; sfr[0x1e1] = 0x80;
        sfr[0x1100] = 0x1f; sfr[0x1101] = 0x20;
        sim_do_command(sd, "memory-region 0x800000,0x2000");
        require(sim_write(sd, 0x800000, sfr, sizeof(sfr)) == sizeof(sfr), "SFR setup");
        unsigned char helper[4] = {0x1f,0xce,0xf0,0x00};
        sim_do_command(sd, "memory-region 0x808640,4");
        require(sim_write(sd, 0x808640, helper, 4) == 4, "helper stub setup");
        unsigned injected = 0, queued = 0, helper_calls = 0;
'''
    runner = runner.replace(marker, setup + marker)
    runner = runner.replace('if (pc < CODE_BASE || pc >= CODE_BASE + code_size)', 'if ((pc < CODE_BASE || pc >= CODE_BASE + code_size) && pc != 0x808640)')
    hook = f'''            if (pc == 0x808640) ++helper_calls;
            if (pc == 0x808640) {{ /* Synthetic time event, not silicon timing. */
                unsigned char tick[2] = {{0, (unsigned char)helper_calls}};
                require(sim_write(sd, 0x8003d0, tick, 2) == 2, "timer event");
            }}
            unsigned char phase, control;
            require(sim_read(sd, {runtime + layout[1]}, &phase, 1) == 1, "phase snapshot");
            if (phase == 2 && !injected) {{
                unsigned char request[8] = {{1,5,0,0,0,0,0,0}};
                unsigned char dlc = 2, complete = 0x41;
                require(sim_write(sd, 0x801106, request, 8) == 8, "request event");
                require(sim_write(sd, 0x801105, &dlc, 1) == 1, "DLC event");
                require(sim_write(sd, 0x801050, &complete, 1) == 1, "RX event");
                injected = 1;
            }}
            require(sim_read(sd, 0x801051, &control, 1) == 1, "TX snapshot");
            if (control == 0x0f) {{
                unsigned char idle = 0;
                require(sim_write(sd, 0x801051, &idle, 1) == 1, "abort completion event");
            }}
            if (control == 0x80) {{
                unsigned char reply[8], expected[8] = {{5,0x85,0,0,4,8,0,0}};
                require(sim_read(sd, 0x801116, reply, 8) == 8, "reply snapshot");
                for (unsigned n = 0; n < 8; ++n) require(reply[n] == expected[n], "wrong compiled reply");
                unsigned char busy = 0; /* Flash drift must latch the runtime fault. */
                require(sim_write(sd, 0x8001e1, &busy, 1) == 1, "fault event");
                queued = 1;
            }}
'''
    runner = runner.replace('            sim_resume(sd, 1, 0);', hook + '            sim_resume(sd, 1, 0);')
    runner = runner.replace('        printf("{\\"id', '''        require(injected && queued && helper_calls, "service path not reached");
        unsigned char phase_end;
        require(sim_read(sd, ''' + str(runtime + layout[1]) + ''', &phase_end, 1) == 1 && phase_end == 3, "fault not latched");
        printf("{\\"id''')
    output = Path(tempfile.mkdtemp(prefix='transcripts-', dir=base))
    source = output / 'runner.c'; source.write_text(runner)
    commands = json.loads((base / 'commands.json').read_text())
    compile_command = next(row['argv'] for row in commands if '-std=c11' in row['argv'])
    compile_command = [str(source) if x.endswith('/simulator/runner.c') else x for x in compile_command]
    compile_command[-1] = str(output / 'runner')
    subprocess.run(compile_command, check=True, capture_output=True)
    profile = struct.pack('>5H9B', 2,1,100,0,0,1,0,0,0,0,0,0,0,1) + bytes(1) + struct.pack('>H3B',1,4,0,1) + bytes(1)
    assert len(profile) == 26
    code = bytearray(original); offset = symbols['evox_runtime_profile'] - 0x80b000
    code[offset:offset+26] = profile
    seed = [0x01010101 * (r+1) for r in range(16)] + [0]*8
    seed[14],seed[15],seed[21] = 0x8000,0x80d3c0,0x80b000
    packet = struct.pack('>I',1) + struct.pack('>III24I',0x80b000,len(code),100000,*seed) + code + bytes([0xa5])*3072 + bytes([0x5a])*1024
    result = subprocess.run([output/'runner'], input=packet, capture_output=True)
    if result.returncode: raise RuntimeError(result.stderr.decode())
    row = json.loads(result.stdout)
    assert row['status'] == 'limit' and row['after'][21] == symbols['evox_startup_park']
    assert row['memory'][0] == code.hex(), 'instructions/profile unexpectedly changed'
    (output/'snapshots.json').write_bytes(result.stdout)
    receipt = dict(cases=1, validation='synthetic admitted profile: startup, size reply, flash-drift fault/park',
                   original_elf_sha256=target['elf_sha256'], profile_patch_offset=offset,
                   limitations='Only profile bytes patched. Inert SFR storage, injected CAN/time events and source helper return stub; no ECU, arbitration or physical helper behavior.',
                   runner_sha256=hashlib.sha256(source.read_bytes()).hexdigest())
    (output/'validation.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print('PASS: optimized admitted startup, CAN size reply, latched flash fault and park')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evidence',type=Path,required=True)
    execute(parser.parse_args().evidence.resolve())
