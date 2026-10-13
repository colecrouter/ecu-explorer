# Evo X flashing kernel investigation

**Status:** captured upload, readback, flash programming/dry-run, recovery attachment, and diagnostic cleanup implemented. Hardware validation remains in issue #3.
**Last investigated:** 2026-10-13.

This investigation concerns the code EcuFlash may upload to the Evo X ECU,
not the older Evo 7/8/9 K-line kernels. The captured upload and command protocol
now provide direct evidence, and both decoding layers have been reconstructed.
The upload client replays three complete captured transfers byte-for-byte.
The software workflow for [issue #5](https://github.com/colecrouter/ecu-explorer/issues/5)
is implemented; hardware validation remains in [issue #3](https://github.com/colecrouter/ecu-explorer/issues/3),
and other flashing variants remain in [issue #10](https://github.com/colecrouter/ecu-explorer/issues/10).

## Application implementation (2026-10-13)

Related unresolved GitHub work: [#5 ROM flash/readback](https://github.com/colecrouter/ecu-explorer/issues/5),
[#10 flashing variants](https://github.com/colecrouter/ecu-explorer/issues/10),
and [#3 desktop transport validation](https://github.com/colecrouter/ecu-explorer/issues/3).
There were no open pull requests during this implementation. The project board
could not be read because the current GitHub token lacks `read:project`.

- `packages/device/protocols/mut3/src/evox-kernel.ts` uploads the captured
  encoded bootstrap and kernel, verifies the version, performs kernel `08/09`
  authorization, and reads the 1 MiB ROM with 1024-byte `03` requests.
- Images are caller-supplied and copied before validation. Exact lengths and
  SHA-256 hashes are checked before any ECU protocol traffic. Decoded RAM
  images, other kernel versions, and partial files are rejected.
- Factory session steps retain the captured `3b9a` metadata and `36ba02` bytes.
  Their meanings are not generalized. The upload uses `31e101`; the observed
  `31e102` with `36d4d4` belongs to a cleanup/reset flow, not this upload.
- `DeviceConnection.sendOnly()` and `receiveMessage()` are optional capabilities.
  OpenPort USB and serial implement both. Every request send consumes its own adapter `TX_DONE`; upload sends wait for `TX_DONE`
  (`0x10`) without waiting for an ECU application reply. Early ECU replies and
  partially assembled replies survive transmission completion. Request/reply
  exchanges consume their completion even when the ECU reply arrives first,
  preventing the next upload chunk from accepting a stale completion. The adapter
  handles classic ISO-TP segmentation; the 20 x 251 + 97-byte PDU boundaries
  must remain intact. HID lacks these capabilities and is rejected.
- Response-pending handling reads the next response without resending a request,
  under a five-second per-exchange deadline. Wrong headers/lengths, negative
  responses, transmission failures, and a mismatched version abort the operation.
- `Mut3Protocol` opts into this read path through `loadKernelArtifacts`.
  ROM reads reject active live polling until its in-flight transaction has
  completed, including immediately after calling the logging session's `stop()`.
  Logging and additional reads are rejected while a read owns the connection.
  The existing diagnostic path remains the default when no images are supplied.
- VS Code settings `ecuExplorer.evoX.bootstrapPath` and
  `ecuExplorer.evoX.kernelPath` load absolute file paths on the extension host.
  Set both, then use the existing **Read ROM from Device** command.
- The CLI accepts the same encoded wire files:

```sh
npm run tools:inspect-device -- read-rom --protocol mut3 --transport serial \
  --bootstrap ./research.local/evox-kernel/captured-bootstrap-wire.bin \
  --kernel ./research.local/evox-kernel/captured-kernel-upload.bin \
  --out ./evox-readback.bin
```

The initial upload/read milestone had these limits (superseded by the #5 workflow below):
These flags do not support `--dry-run`. This implementation sends upload/preparation
commands and reads ROM; it does not expose erase/program commands. A successful
read leaves the uploaded kernel running. Restoring the factory diagnostic session
through the captured cleanup/reset sequence remains follow-up work before mixing
kernel operations with persistent live logging. No kernel binary is committed or
redistributed. Compatibility is limited to the captured build and ECU family;
real adapter timing and hardware behavior remain unverified.

The transcript tests in `packages/device/protocols/mut3/test/evox-kernel.test.ts`
cover upload, pending responses, authorization failure, file integrity failure,
version mismatch, incomplete read replies, transmission failure, and complete
1 MiB readback through the configured protocol. Synthetic image contents are
used in committed state-machine tests, with only their digest boundary stubbed.
Actual image bytes are independently checked by the ignored local
`replay-application-upload.mjs`: **all three complete source intervals pass**
(51 application messages each), and all 245 factory keys match. The replay result
is saved as `application-upload-replay-validation.json`.

Validation on 2026-10-13: `npm run build`, `npm run check`, and `npm run lint`
passed. After installing the missing Playwright Chromium test dependency,
`npm run test:coverage` passed **1881 tests across 92 files**, including browser
suites. The new kernel client has 97.72% line, 89.74% branch, and 100% function
coverage. The three actual capture replays also passed. Hardware execution is
still pending; the GitHub issues remain open for that and programming support.

For the initial upload-only milestone, an independent agent reviewed the implementation before PR preparation. Its
transmit-completion ownership and concurrent live-polling findings were fixed
and covered by USB/serial and protocol regression tests. Re-review found no
remaining blocking issues. Hardware execution and cleanup/reset remain outside
this change and are tracked by the open issues above.

## Flash, recovery, and cleanup workflow (#5)

The writer reads the 20 nonuniform sector boundaries from the decoded kernel
and compares **live ECU CRC32s** against the complete target image. A supplied
`originalRom` is not trusted as current ECU state. Target images must be exactly
1 MiB; the mitsucan ROM checksum is validated before upload/erase by default.
The checksum-containing sector at `0xb0000` is programmed first, matching both
recorded writes. Every changed sector is erased in full, then every non-erased
4 KiB target block is staged with eight 512-byte `22` requests and committed
through `24` with its CRC32. All-`ff` blocks remain erased. Sector CRCs are
verified after `21` disables programming. Staging/commit and post-write CRC
verification cannot be disabled by `verifyChecksums: false`; that API option
only controls the separate ROM checksum validation.

`dryRunWrite` follows the same sector planning and staging, using `23` to check
the RAM-buffer CRC. It does not send flash enable `20`, erase `25`, or commit
`24`. Use a complete valid target ROM for dry-run; the generic diagnostic
`read-rom --dry-run` placeholder image is not supported by this workflow.

Successful reads, writes, and write dry-runs restore factory diagnostics:
`07`, factory session/security, the captured metadata/download, `36d4d4`,
`37`, `31e102`, then `1101`. Both resets use bounded diagnostic-readiness
probing (up to ten seconds) because an early request can be dropped while the
ECU initializes. The final normal-mode `1a87` prefix must match. The final
`1092` probe uses physical addressing in place of the recorded broadcast;
optional broadcast keepalives/identity probes are not replayed. Reset/cleanup
requests are not issued after a failed flash.

A flash error triggers an attempt to disable programming and retains recovery
state. If both the operation and disable fail, both errors are reported.
Diagnostic logging/ordinary reads remain blocked while a failed kernel is
retained. Repeating the VS Code write operation uses the retained kernel; after
reconnection to the same device ID, it verifies V1.09 and reattaches. MUT-III
writes skip the UI's read-before-write because their live CRC planning already
selects changed sectors and supports recovery. Explicit CLI recovery uses
`--resume-kernel`. Recovery always checks the version, disables programming,
and requires a real write/complete target CRC match before permitting reset.

```sh
# Validate target staging without erasing/programming flash:
npm run tools:inspect-device -- write-rom --protocol mut3 \
  --rom ./target.hex --bootstrap ./research.local/evox-kernel/captured-bootstrap-wire.bin \
  --kernel ./research.local/evox-kernel/captured-kernel-upload.bin --dry-run

# Program the same target (omit --dry-run):
npm run tools:inspect-device -- write-rom --protocol mut3 \
  --rom ./target.hex --bootstrap ./research.local/evox-kernel/captured-bootstrap-wire.bin \
  --kernel ./research.local/evox-kernel/captured-kernel-upload.bin

# Retry an interrupted flash while the V1.09 kernel remains active:
npm run tools:inspect-device -- write-rom --protocol mut3 --rom ./target.hex --resume-kernel
```

CLI flag parsing is tested with actual Sade arguments and the real CLI entry
point. Dashed `--dry-run` / `--resume-kernel` flags are explicitly mapped;
ambiguous nonboolean values are rejected before hardware access.

The local `replay-application-flash.mjs` reproduces **332 recorded flash
transaction messages: two erases and eighteen commits**, plus the two changed
sectors' recorded post-write CRCs. Only those two sectors are reconstructed;
untouched target sectors and their matching CRC replies are synthetic. This
is transaction evidence, not reconstruction of a complete historical ROM.
The local replay explicitly bypasses ROM checksum validation because unknown
untouched bytes prevent validating the historical whole-ROM checksum. Actual
application writes validate that checksum by default.

Independent review found and resolved UI retry, CLI resume, reset readiness,
and dashed-flag parsing issues. Regression tests additionally cover two
non-erased blocks preserved across an 8 KiB erase, invalid inputs, unchanged
sectors, dry-run, commit failures, post-write CRC mismatch, combined errors,
and reconnection recovery. No vehicle was contacted during implementation.
Hardware/runtime transport validation and actual recovery behavior remain
unverified and tracked separately in #3.

Final software validation: `npm run test:coverage` passed **1897 tests across
94 files**. The kernel client's line/branch/function coverage is
**96.01% / 85.59% / 96.55%**. Build, type, lint, and formatting checks passed;
the three upload replays and the bounded 332-message flash replay passed.

## Evidence recovered

The current local artifacts are under `research.local/evox-kernel/`. This
directory is ignored by Git; proprietary executables and extracted kernels
are not included in the repository. Keep a separate copy when moving machines.

| Artifact | Size (bytes) | SHA-256 |
| --- | ---: | --- |
| EcuFlash 1.44.4870 Windows installer | 17012520 | `e9242d8882530fc320164f13e4107ceff9c862f5bd2e66debdbebe4895fffa0b` |
| Extracted 1.44 `ecuflash.exe` | 7840904 | `5e1b1729446d306487bb7ed358b1ee050b11e440902bb23a05663d8575346115` |
| EcuFlash 1.38 macOS disk image | 6861417 | `a019660b20909d631b554a6b1e210d9e3eb3645993cf09d0087d399641d41f18` |
| Extracted 1.38 i386 Mach-O executable | 14213160 | `d431385e7b67e33a5a2848a6a5e543d3e6c603adbb011e124f2bc8ab4ddfa6f6` |

The Windows installer was already in `~/Downloads`. The older disk image was
downloaded from [Tactrix's published download](https://www.tactrix.com/downloads/ecuflash_138_osx.dmg).
Both were extracted with 7-Zip without launching EcuFlash or communicating
with a vehicle. The original executables were not modified.

### Supplied CAN archive: upload confirmed and recovered

The user supplied `OneDrive_2026-10-13.zip`, SHA-256
`33202df0eb99a83802356b464906029e9b88495b81f22ca70fae7014b84d91f2`.
Its 31 files include 13 candump recordings, EcuFlash logs, and generated text
transcripts. The timestamped traffic is from March 27, 2026; the ZIP member
dates are not the recording dates. The startup log in `ecu read 1 log.txt`
identifies **EcuFlash 1.44.4799**, distinct from the 1.44.4870 installer above.

`ecu write 1 log.txt` explicitly records kernel upload followed by the version
`OpenECU Mitsubishi M32186 CAN Kernel V1.09`. More decisively, the raw CAN
recordings contain the upload and that same version reply. The previous
categorical claim that this Evo X path needs no uploaded kernel is contradicted
by these recordings.

The raw recordings were parsed independently of the supplied transcripts.
Frames were sorted by numeric timestamp, preserving original line numbers.
The reassembler checks ISO-TP sequence numbers, respects declared message
lengths, removes frame padding, and rejects interrupted or incomplete messages.
For example, `ecu write 1.candump` contains 129 adjacent timestamp inversions;
after sorting, its upload still has missing frames and must not be treated as
a complete kernel source.

Three transfers across two recordings pass the stricter requirement of a
complete upload followed by a complete version reply, with no reassembly
problems in that interval:

| Recording | `31 e0` line | Version reply first line | Version reply final line |
| --- | ---: | ---: | ---: |
| `session sample 1.candump` | 1040 | 1798 | 1805 |
| `session sample 1.candump` | 2765 | 3525 | 3530 |
| `session sample 2.candump` | 12111 | 12869 | 12876 |

All three contain 20 application payloads of 251 bytes and a final payload
of 97 bytes: **5,117 bytes total**, identical byte-for-byte. A fourth transfer
in `session sample 2.candump` starting at line 1764 has the same complete
payload, but its version reply is interrupted; it was excluded from the
strictly validated set.

| Recovered artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `captured-kernel-upload.bin` | 5117 | `537b4e3893757857da7bc54689d5c6db53a97f0d0a6e343541444432d81c98a9` |
| `captured-bootstrap-wire.bin` | 208 | `8d53b034b6ec0a88311e6c55dd037475933c4572b1406b88ae815e9b1db09fc9` |

Both are under `research.local/evox-kernel/`. The first file preserves the
complete **wire payload**; the separately decoded kernel is described below. The second is the
208 bytes following service byte `36` in the preceding small transfer. The
main upload's 21 payloads are concatenated in full: their leading bytes vary
and must not be discarded as service bytes or sequence counters.

Reproduction scripts and evidence under the same directory:

- `analyze_capture.py`: parses every candump; writes reassembled messages,
  problem lists, source hashes, and summary counts under `captures/`.
- `extract_uploads.py`: requires the 21 expected payload lengths, no problems
  in the interval, a complete version reply, and agreement between transfers;
  writes the two recovered artifacts and `captured-upload-manifest.json`.
- `validate_flash_crc.py`: independently validates buffered write data
  against recorded commit CRCs.

The source SHA-256 values are
`fab438cc369b45298786927d729920a8db5b6dbdc2e72a9987f6576fda39e5ee`
for `session sample 1.candump` and
`2abcdc3a52458e01de7250adcd2d09aaef66d91392554a15472c766ff243d34b`
for `session sample 2.candump`. The manifest retains each chunk's original
line numbers, timestamp, CAN identifier, and full payload.

#### Observed startup and upload sequence

The following application payloads are taken from `ecu write 1.candump`.
The complete upload bytes themselves come from the validated transfers above.
Tester requests use `7E0`; physical ECU replies use `7E8`.

| Original line(s) | Tester request | Observed reply / meaning |
| --- | --- | --- |
| 30–34 | `10 92`, then `10 85` | `50 92`, then pending `7f 10 78`, then `50 85` |
| 35–38 | `27 05`, then `27 06 48 14 20 cb` | Seed `67 05 8f b2 ce f1`; accepted `67 06 34` |
| 40–44 | `3b 9a 01 01 00 26 03 27 00 00 00 01` | Pending, then `7b 9a` |
| 45–52 | `34 20 00 00 01 00 00 02`; `36 ba 02`; `37` | `74 01 01`, `76`, `77` |
| 53–90 | `34 80 85 38 01 00 00 d0`; `36` + 208 bytes; `37` | `74 01 01`, `76`, `77` |
| 91–94 | `31 e1 01`; `31 e0` | `71 e1 00 ff ff ff`; pending `7f 31 78` |
| After `31 e0` | 21 opaque upload payloads | Followed by successful kernel version query |
| 754–762 | `01` | `81` + NUL-terminated `OpenECU Mitsubishi M32186 CAN Kernel V1.09` |

The two `34` requests are consistent with a three-byte address, one format
byte, and three-byte length: candidate addresses `0x200000` and `0x808538`,
format `01`, and lengths 2 and 208. The lengths agree with the subsequent
transfers. Address/format semantics and the exact interpretation of `31 e1`
and `31 e0` still need confirmation from the ECU/loader code.

#### Kernel command contracts supported by traffic and logs

All integers below are big-endian. These are observed contracts, not a claim
that every parameter, status value, or error case is understood.

| Request | Reply | Evidence-supported interpretation |
| --- | --- | --- |
| `01` | `81` + string + NUL | Kernel version |
| `02` + address32 + length32 | `82` + CRC32 | Region CRC; values agree with EcuFlash's page comparison log |
| `03` + address32 + length16 | `83` + bytes | Read memory |
| `05` | `85 00 00 04 08` | Reported communication size 1032; application log selects 1024 |
| `06` | `86 00 00 10 00` | Flash buffer size 4096 |
| `08` | `88` + four bytes | Kernel challenge |
| `09` + four bytes | `89` | Kernel challenge response accepted |
| `20` | `a0` | Flash enable, correlated with log |
| `21` | `a1` | Flash disable, correlated with log |
| `22` + address32 + bytes | `a2` | Write flash buffer; captured data chunks are 512 bytes |
| `24` + address32 + length16 + CRC32 | `a4 00 01` | Commit buffered flash data |
| `25` + address32 | `a5 00 01` | Blank/erase flash page |
| `07` | No reply captured | Kernel reset, followed by diagnostic re-entry |

For `ecu write 1`, all **18 captured commits** have complete buffer-write
data. Each reconstructed 4096-byte block matches the requested CRC using
`zlib.crc32`. For example, address `0x000b0000` matches `0x506686d3` and
`0x00050000` matches `0xee70363a`. This independently supports the `22` and
`24` field boundaries. In `ecu write 2`, 16 of 17 captured commits validate;
the remaining commit lacks 1024 captured data bytes. Missing data was not
filled or guessed. The test-write recording contains no `24` commit requests.

#### Security and completeness limits

The recorded ECU access uses **`27 05` / `27 06` with four-byte values**,
not the older notes' assumed `27 03` / `27 04` with two-byte values. Kernel
commands `08` / `09` are a separate challenge exchange. The archive contains
157 distinct captured ECU seed/key pairs after deduplication. A single
32-bit affine model `key = a * seed + b (mod 2^32)` is inconsistent with that
set. The earlier implementation was subsequently found in commit `da48e26`
(`docs/mitsucan-trace-reconciliation`) and restored selectively. Its byte-wise
transform with carry terms matches all 245 accepted exchanges (157 distinct
seeds). It is implemented as `computeFlashSecurityKey()` in
`packages/device/protocols/mut3/src/security.ts`. The failure of one whole-word
affine model does not contradict this byte-wise transform.

An initial bounded probe of aPLib decoding at offsets 0–8 after constant byte
XOR did not produce a substantial decoded image. Following the actual ECU
decoder and bootstrap subsequently resolved the encoding; neither recovered
layer requires a decompressor.

The CAN parser was checked with synthetic cases covering timestamp reorder,
sequence-number wrap, final-frame padding, and missing-frame rejection.
Raw traffic and supplied logs remain local; vehicle-identifying strings are
not copied into repository documentation.

### Decoded M32186 bootstrap and kernel

The ECU-side route succeeded. GNU Binutils 2.44 was built locally with target
`m32r-elf` because the installed Ghidra distribution has no M32R processor.
This analysis uses GNU `objdump` output and direct byte reconstruction, not
REA/Ghidra decompilation. All addresses in this section are ECU addresses.

#### Stage 1: firmware format `01` decoder

The relevant low-flash code is identical in the two available ROMs:

| Local ROM | SHA-256 |
| --- | --- |
| `56890009_2011_USDM_5MT.hex` | `a8079f405a9b8dc811ec0aab6cd0dec842c7376242e338b99188d914ecbc5fbf` |
| `56890013_2011_USDM_5MT.hex` | `409e23912db9e445a72f6f7aff25c393549cc07eb0a649cf663fcbf07fda59af` |

Of 617 complete 1024-byte read responses in `ecu read 1.candump`, 542 match
the local `56890013` image and 75 match the older `56890009` image. This is a
bounded comparison of captured read ranges, not proof that either local file
is byte-identical to the complete ECU image.

The firmware dispatch at `0x2edc` routes service `34` through `0x4370` to the
download handler at `0x548c`. That handler parses a three-byte address at
`0x54c8`, a three-byte size at `0x54e0`, and the format byte at `0x54f8`.
The low nibble is passed through `0x3acc` and stored at `fp + 0x651c`.
Service `36` reaches `0x5764`; when the stored format is 1, the loop at
`0x580c` calls `0x5894` for each received data byte.

`0x5894..0x58cf` implements this exact byte transform:

```python
expanded = ((wire_byte << 8) | wire_byte) >> 3
adjustment = (0xe3, 0x6b, 0x9a, 0)[expanded & 3]
decoded_byte = (expanded - adjustment) & 0xff
```

The 60 source bytes have SHA-256
`0763111141df2e5cf3362c41bb849d26e63a6c29f0990f357f9959577a78dbbf`
in both ROMs. The transform is a bijection across all 256 byte values.
For example, wire bytes `cc fb 54 d4` decode to `2e 7f f0 00`, which
disassembles as the bootstrap's `push lr || nop` prologue.

This confirms the previously proposed request parsing: `34 80 85 38 01
00 00 d0` downloads 208 format-1 bytes to **`0x808538`**. The separate
`34 20 00 00 01 00 00 02` request selects the special two-byte target
`0x200000`, explicitly recognized at `0x56a0`. The byte transform decodes
its wire data `ba 02` to `57 5d`; its side effect is not yet documented here.

#### Stage 2: bootstrap frame handling and address XOR

The decoded 208-byte bootstrap:

- Initializes its descending destination pointer to **`0x80c3fc`**.
- Receives CAN frames for the tester identifier and sends flow-control replies.
- Reads data bytes in reverse order within each CAN frame. It skips the
  ISO-TP PCI byte and also skips the first frame's length byte: first frames
  contribute six data bytes; consecutive frames contribute seven.
- Stores each byte as `received_byte ^ (destination_address & 0xff)`, then
  decrements the destination address.
- Stops after filling through **`0x80b000`**, then jumps to **`0x80b000`**.

The copy/XOR loop is at `0x8085c0..0x8085d8`; the boundary check and jump are
at `0x8085dc..0x8085f0`. The resulting inclusive RAM span is exactly
`0x80c3fc - 0x80b000 + 1 = 5117` bytes, independently matching the capture.

Frame boundaries matter: simply XORing or reversing the concatenated stream
does not reproduce the memory image. Each six- or seven-byte frame payload
keeps its byte order in ascending memory, while successive frame payloads
occupy progressively lower addresses.

#### Recovered artifacts and checks

| Local artifact under `research.local/evox-kernel/` | Bytes | SHA-256 |
| --- | ---: | --- |
| `bootstrap-decoded.bin` | 208 | `6f93d303a13138ea267519a14428f91821e6ed65e49f9423397bb15990f44092` |
| `kernel-m32186-v109-decoded.bin` | 5117 | `3304fe85517918e2e8ab6a04bf2d702e8b394caf4afd22e90b4c95d86a5bfe00` |
| `kernel-m32186-v109.elf` | 6144 | `b16e7e308c88a37a01bafc0c7e99e9bf55c1b2285a4dbaa38e94f230a3ec1c7f` |

The ELF is a derived, relocatable analysis container with named symbols and
entry address `0x80b000`, not a file intended for flashing. Its symbols are
analyst-assigned. The raw decoded binary is the reconstructed RAM content.
`kernel-m32186-v109.disasm` and `kernel-m32186-v109-symbolized.disasm` retain
the disassembly.

`decode_captured_kernel.py` reproduces both transforms. For each of the three
validated transfers, it independently decodes both the existing reassembled
payloads and **all 734 original data-bearing CAN frames**. All six results
agree byte-for-byte and produce the kernel hash above. Its manifest is
`kernel-decoding-manifest.json`. Five small contract tests in
`test_decode_captured_kernel.py` cover the bootstrap prologue, byte-transform
invertibility, frame ordering, address-byte wrap, and length rejection.

The decoded entry point calls initialization routines and scans a command
table at `0x80c140`. The table's fixed request lengths match the observed
traffic; length zero means the entry does not impose a fixed length at this
dispatch check. The version handler points to the expected NUL-terminated
string at **`0x80c1c8`**.

| Command | Fixed request length | Handler | Interpretation |
| --- | ---: | --- | --- |
| `01` | 1 | `0x80b10c` | Version string |
| `05` | 1 | `0x80b13c` | Communication size, constant 1032 |
| `06` | 1 | `0x80b15c` | Flash buffer size, constant 4096 |
| `02` | 9 | `0x80b22c` | Region CRC32 |
| `03` | 7 | `0x80b2a8` | Memory read |
| `04` | 1 | `0x80b340` | Returns constant 600 as big-endian uint16; units unresolved |
| `20` | 1 | `0x80b360` | Flash enable |
| `21` | 1 | `0x80b39c` | Flash disable |
| `22` | 0 | `0x80b3b4` | Write buffer |
| `23` | 11 | `0x80b414` | Check buffer CRC32 |
| `24` | 11 | `0x80b4a0` | Commit flash |
| `25` | 5 | `0x80b574` | Erase page |
| `07` | 1 | `0x80b130` | Reset; calls address zero |
| `08` | 1 | `0x80b17c` | Get challenge |
| `09` | 5 | `0x80b1a0` | Check challenge response |
| `30` | 1 | `0x80b0a0` | Transport diagnostic counters; fifth field reset to zero |

The dispatch table, version text, constants, and control flow provide checks
beyond byte-count agreement. The existing 18 captured commit CRC matches
remain additional protocol evidence. No decoded image has been executed on
an ECU, and flash-operation safety/error semantics remain to be audited.

#### Behavior traced from the decoded instructions

The entry initializes CAN transport state, clears authorization state, disables
flash programming, and then loops receiving and dispatching requests. Unknown
commands and fixed-length mismatches are ignored by this dispatcher.

The kernel has its own authorization exchange, separate from the factory ECU's
`27 05/06` exchange used before uploading it. At `0x80c010`, command `08`
combines two hardware register values into a 32-bit challenge and computes the
expected key using this transform:

```python
def kernel_key(seed):
    for _ in range(32):
        seed = (seed >> 1) ^ (0xA723B0F1 if seed & 1 else 0x395E1C22)
    return seed
```

`validate_kernel_keys.py` checks **145 accepted captured exchanges with 30
distinct challenges**; every calculated key matches. These observations
validate the kernel transform, separately from the factory ECU algorithm.
The authorization state at `0x80d860` begins at 0, becomes 1 after issuing a
challenge, 2 after a correct key, or 3 after a failed/out-of-order attempt.
A repeated challenge before unlocking also sets state 3. Once state is 2,
subsequent authorization checks succeed without comparing another key.

Read/CRC handlers require authorization and restrict their memory ranges to
the 1 MiB ROM window. Flash operation handlers require authorization too.
The main write path is:

1. `20` enables the flash hardware if its readiness bit permits it.
2. `25` erases the sector containing the supplied address, using the sector
   boundary table at `0x80c1fc` and the `0x2020`, `0xd0d0` command sequence.
3. `22` copies data into a **4096-byte RAM staging buffer at `0x80c85c`**.
   The destination offset is the supplied address masked with `0xfff`.
4. `23` optionally compares a staging-buffer CRC against the supplied value.
5. `24` also verifies the staging-buffer CRC before programming. Its low-level
   routine at `0x80bf34` requires an 8-byte-aligned destination and length,
   then programs eight bytes per iteration through the `0x4343` command.
6. `21` disables flash programming; `07` transfers execution to address zero.

The CRC routine at `0x80bc7c` uses reflected polynomial `0xedb88320`, initial
value `0xffffffff`, and final inversion, consistent with the independently
validated captured commit CRCs. A CRC mismatch returns `f5` and disables
programming; programming/erase failure returns `f2` and disables programming.
Unauthorized operations return `f6`. These checks do not establish that every
malformed request or cross-sector write is safe; that audit remains open.

Two smaller findings: `04` **does not measure a hardware value in this build**;
it serializes the literal 600 and replies `84 02 58`. Its intended units remain
unconfirmed. `30` returns five big-endian transport diagnostic fields; the
fifth is explicitly cleared before serialization. The exact names of all
counters remain unassigned.

The analysis ELF was regenerated with the section `contents` flag after a
check found the earlier carrier did not expose the reconstructed instructions.
Its extracted `.text` now matches the raw kernel byte-for-byte. The raw kernel
and its hash have not changed. These findings are from static disassembly and
recorded traffic, not execution of the reconstructed image on hardware.

The local disassembler was built from the
[GNU Binutils 2.44 source release](https://ftp.gnu.org/gnu/binutils/binutils-2.44.tar.xz),
SHA-256 `ce2017e059d63e67ddb9240e9d4ec49c2893605035cd60e92ad53177f4377237`,
using `--target=m32r-elf --with-system-zlib`. Build products and logs remain
in `research.local/evox-kernel/toolchain/`; the system installation was not
changed.

### Windows 1.44: target identity confirmed, payload still inaccessible

The installer contains
`rommetadata/mitsubishi/evo/56890009 2011 USDM Lancer Evolution X 5MT.xml`.
Its `romid` explicitly selects:

```xml
<flashmethod>mitsucan</flashmethod>
<memmodel>M32186F8</memmodel>
<checksummodule>mitsucan</checksummodule>
```

`evo10base.xml` selects the same three values. These are observations of
shipped metadata, not proof of the upload protocol or instructions executed
by the ECU.

Ghidra 12.1.4's defined-string search for `mitsucan|kernel` returned only
`kernel32.dll` at `0x1013053`. REA evidence:
`ev_594b7711cfe58f457fdb76ed8a37dc0ec7be0e18b30cf66a7345a14c9413effb`.
The full response is saved as `kernel_strings.json` in the local artifact
directory. This search does **not** establish that kernel data is absent:
packed or undefined data is outside its coverage.

Additional bounded observations:

- PE section names include `yzxczxtn`, `iyuokhzd`, and blank names. The first
  section has virtual size `0xc10000` and raw size `0x5ae400`. This is consistent
  with packing; it does not independently identify the packer as Enigma.
- REA's PE resource inventory rejected the image because a resource range was
  not entirely file-backed in one section. The inventory did not complete.
- A scan for complete zlib streams beginning with `78 01`, `78 5e`, `78 9c`, or
  `78 da`, with an 8 MiB decompressed-output cap per candidate, recovered none.
  Other encodings, compression methods, and encrypted data remain unexamined.

### Windows 1.44: three loader layers decoded offline

A follow-up pass recovered loader code from the packed executable without
launching EcuFlash. This establishes that the older assertion that static
analysis is impossible is too strong. It does **not** establish that the
application or Evo X kernel is fully unpacked.

1. The original entry point is `0x15d9000`. The stub at `0x15d9009` computes
   `0x1410000` and calls `0x15d9044` on its first `0x1000` bytes. That routine
   transforms each little-endian 32-bit word as
   `((word ^ 0x5e947b85) + 0x2d52015d) & 0xffffffff`. The corresponding file
   range is `[0x5b0000, 0x5b1000)`. Evidence:
   `ev_ae23db5260bf598e34fdf56abac38efc9ab1013e988602a81589faccffa9cd93`
   and `ev_bb5ede0e4cd4b46ec2ca574da0f175f614696ab548952efea008bacceea504d0`.
2. The decoded stub calls a bitstream/back-reference decompressor at
   `0x14100bf`, passing source `0x1410212` and destination `0x1014014`.
   A direct Python translation consumes 1,860,492 bytes starting at file
   offset `0x5b0212` and produces 4,173,012 bytes before reaching its explicit
   end marker. All back-references and output bounds are checked. Evidence:
   `ev_ebcc48e87d30de9fe59fc4a48a950f83b64bd6347bcbd79676a6a8e989333d00`
   and `ev_3accf202e092cba1a71d3f57c42edde33cfdd3c16c694d1eef5ae66dafed795c`.
3. The resulting loader enters at `0x1014014`, jumping to `0x101577d`.
   Its routine at `0x1015955` decrements each byte in the `0x7000`-byte range
   starting at `0x1015966`, exposing the next loader layer. Evidence:
   `ev_71afc358a679913b6308d80d83bcbda08dc86984304999e83781268407739fa9`
   and `ev_87a9b3f0cb6d0c1f92b58337a4fb470cecad66c67be45e11cfbd5b153ba68f07`.

The third layer walks PE headers and loaded-module memory using an imported
function pointer. Its control flow also contains overlapping instructions,
exception handlers, and a heavily obfuscated subsequent loop. Ghidra's
warnings make its pseudocode insufficient to reproduce that loop without
checking the instructions or emulating it. Relevant next locations are
`0x10159d8` (module/header discovery) and `0x1015b47` (continuation into the
obfuscated path). Evidence:
`ev_5f0531e3c02a4b499b141a8a046728e1c36d6f3210cb2dfcd614957b28bdbf88`
and `ev_6f5c29af73417283c1bf73a9f3e43f0e7bd21986f3c5807658cd381e7419a73a`.

The local script `research.local/evox-kernel/decode_stages.py` reproduces the
three layers and rejects a source with a different SHA-256. The generated
PE files change their analysis entry points; stages 2 and 3 also append the
decompressed region and adjust its section's raw-file mapping. These files
are **analysis carriers, not runnable repaired executables**. They do not
reproduce all runtime state or loader side effects.

| Local output | SHA-256 |
| --- | --- |
| `ecuflash-stage1-analysis.exe` | `a017f042f01f9bb14ad49f18a39617b69a03d65edd83f43ee9c939eb197a95fc` |
| `stage2-loader.bin` | `7f01029e62b1e337413ae587716026c312a12dc7f265b7962bf0130499fa2539` |
| `ecuflash-stage2-analysis.exe` | `0229027e45c744d550824c15d71f911a6bbc2502e8eb10e47e087ffc1e857d4d` |
| `ecuflash-stage3-analysis.exe` | `91973803f40678ae140513b2befae024d0ed5433326c2f91b38cfb199b00168d` |

The artifact directory also retains `stages-manifest.json` and
`stage0-evidence.json` through `stage3-evidence.json`. Rerunning the script
reproduced the output hashes. A literal/end-marker sample and three truncated
input cases were checked independently of the real stream. Neither a valid
decode nor plausible x86 instructions alone prove runtime equivalence.

The installed Wine launcher is x86-64 and currently fails on this machine
with `bad CPU type in executable`, even for `wine --version`. No Windows
application was launched. A compatible execution environment or a bounded
offline emulator would enable the next layer to be observed without a car.

### macOS 1.38: embedded kernel resources recovered

The symbol `qInitResources_ecuflash()` is at `0x7a14c`. Its call to
`qRegisterResourceData` supplies resource format 1 and the following arrays.
For this Mach-O their virtual addresses equal file offsets:

| Array | Offset |
| --- | --- |
| Resource tree | `0x99a5a0` |
| Names | `0x99a120` |
| Payloads | `0x988600` |

These come from the PC-relative base `0x7a155` plus displacements
`0x92144b`, `0x920fcb`, and `0x90f4ab`, respectively. The extraction follows
the 14-byte resource-node layout and flags in
[Qt's resource implementation](https://github.com/qt/qt/blob/4.8/src/corelib/io/qresource.cpp).
These observations came from `otool` disassembly and a Python resource-tree
walk, not a completed REA decompilation. The separate Ghidra analysis of this
older executable was stopped before completion.
The complete tree contains 39 nodes and 34 files, including these 11 kernels:

| Resource under `:/kernels/` | Payload file offset | Stored bytes | Decoded bytes |
| --- | --- | ---: | ---: |
| `mitsuh8539f.hex` | `0x98c3d8` | 1531 | 1531 |
| `mitsush7052.hex` | `0x988604` | 3560 | 3560 |
| `mitsush7055.hex` | `0x98af64` | 3592 | 3592 |
| `mitsush7055ocp.hex` | `0x98e813` | 3212 | 3212 |
| `mitsush7055dual.hex` | `0x98d6d3` | 4412 | 4412 |
| `subaru68hc916y5.hex` | `0x98bd70` | 1636 | 1636 |
| `subarush7055.hex` | `0x98a0e8` | 3704 | 3704 |
| `subarush7055dual.hex` | `0x98f4a3` | 4560 | 4560 |
| `subarush7055ocp.hex` | `0x98c9d7` | 3320 | 3320 |
| `subarush7058ocp.hex` | `0x9893f0` | 3316 | 3316 |
| `subarush7058ocpcan.hex` | `0x990677` | 2354 | 8192 |

The final entry has the compressed flag; its qCompress length and zlib
decompression were checked against the decoded length. The other kernel
entries are uncompressed. Files and SHA-256 hashes are retained in
`mac-kernels/resource-manifest.json`. The `.hex` suffix does not imply Intel
HEX: the recovered `mitsush7052.hex` starts `00 09 00 09 a0 02 00 09`.

There is no M32R-labelled entry in **this resource tree**. This is a bounded
negative finding about version 1.38, not evidence that version 1.44 does not
upload an Evo X kernel. The older resources must not be substituted for an
unidentified `mitsucan` payload.

## Corrections to the earlier research assumptions

[HANDSHAKE_ANALYSIS.md](HANDSHAKE_ANALYSIS.md) and
[MITSUCAN_WRITE_RESEARCH_PLAN.md](MITSUCAN_WRITE_RESEARCH_PLAN.md) contain
categorical statements that Evo X flashing needs no uploaded kernel. The
supplied CAN recordings now contradict those statements for the observed
M32186 path.

Likewise, the proposed sequence of `0x34` followed by 8192 128-byte `0x36`
blocks is not a verified EcuFlash transcript. Service numbers alone would not
distinguish uploading an executable to RAM from writing a ROM image; target
addresses, payload bytes, and the subsequent execution request are needed.

The candidate seed/key multipliers in the older notes remain hypotheses.
Proximity to a constant in packed bytes does not establish executable
instructions or data flow, and matching one pair would not prove an algorithm.

## Next evidence needed

1. Audit the decoded kernel's authentication, flash programming/erase guards,
   error responses, and commands `04` and `30`. The host executable is no
   longer needed to obtain this captured kernel.
2. Use the complete, matching upload intervals and recorded kernel command
   exchanges as the primary evidence. Preserve missing-frame limitations in
   other intervals rather than repairing them with guessed bytes.
3. Build any future protocol implementation around the now-established load
   addresses, transforms, entry point, and dispatch table. Use captured
   exchanges as transcript tests and preserve the distinction between static
   reconstruction and validation on hardware.

No live capture, ECU write, or runtime unpacking was performed in this thread.
The initial local search found no CAN capture; the subsequently supplied
OneDrive archive provided the traffic analyzed above.

## Milestones

- [x] Recover and identify the available installers/executables.
- [x] Verify the target ROM's shipped flash-method and memory-model metadata.
- [x] Extract and inventory the older embedded kernels as comparison artifacts.
- [x] Decode the first three Windows 1.44 loader layers without executing EcuFlash.
- [x] Recover matching complete Evo X upload wire payloads and successful kernel replies.
- [x] Decode the wire payload into executable kernel bytes.
- [x] Confirm load/entry addresses, version string, and command dispatch table.
- [ ] Establish the upload, execution, and kernel command protocol.
- [ ] Validate any implementation against captured exchanges.
