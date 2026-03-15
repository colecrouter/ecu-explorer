# OpenPort 2.0 macOS Serial Backend

## Summary

OpenPort 2.0 on macOS desktop should prefer the CDC ACM serial endpoint exposed as `/dev/cu.usbmodem*`. The shared OpenPort transport remains responsible for adapter protocol semantics, while desktop entrypoints inject a serial backend implemented with Node-only dependencies.

## Design

- `packages/device/transports/openport2` owns:
  - `ati`
  - `ata`
  - `ato...`
  - `att...`
  - `AR...` packet parsing
- Desktop entrypoints inject serial runtime support.
- Browser/web runtimes continue to rely on WebUSB, with HID remaining provisional until validated end-to-end.

## Runtime matrix

| Runtime | Preferred OpenPort backend |
|---------|----------------------------|
| VS Code web / browser | WebUSB |
| VS Code desktop on macOS | CDC ACM serial |
| CLI on macOS | CDC ACM serial |
| Other desktop runtimes | transport-specific, not guaranteed |

## Acceptance targets

- `inspect-device list` can enumerate OpenPort over serial.
- `inspect-device raw --transport serial` can complete adapter handshake and raw exchange without hanging.
- VS Code desktop can inject the serial backend without polluting the web build graph with Node-only modules.
- HID remains documented as provisional until validated for connect, probe, log, and ROM-read.

## Current findings

- macOS OpenPort access is reliable through the CDC ACM serial device, not through libusb on this host.
- `ati`, `ata`, `ato6 0 500000 0`, and `atf...` succeed over serial.
- The adapter accepts J2534-style framed writes once CAN headers and filter setup are included.
- ECU RX traffic is still unverified; current experiments only show transmit-side adapter packets and no confirmed ECU response.
- Windows EvoScan decompilation confirms OpenPort 2.0 uses the J2534 `op20pt32.dll` path, while OpenPort 1.3 uses FTDI `FTD2XX.dll`; the two backends should be documented separately.
- The official Tactrix `openport2_setup_1024820.exe` installer ships `op20pt32.dll`, sample J2534 wrapper code, a raw K/L/AUX sniffer (`samples/klogger/klogger.cpp`), and logging profiles including `samples/logging/mitsubishi k-line.txt`.
- Tactrix's shipped J2534 headers explicitly define legacy line protocols and init primitives for OpenPort 2.0, including `ISO9141`, `ISO14230`, `ISO9141_K`, `ISO9141_L`, `ISO14230_K`, `ISO14230_L`, `FIVE_BAUD_INIT`, `FAST_INIT`, and timing parameters such as `P1_MAX`, `P3_MIN`, `P4_MIN`, and `PARITY`.
- The shipped `klogger` sample demonstrates actual host-side K-line setup through `PassThruConnect(..., ISO9141_K, ISO9141_NO_CHECKSUM, 10400, ...)` followed by `SET_CONFIG` for `P1_MAX` and `PARITY`, which confirms OpenPort 2.0 K-line support in vendor sample code.
- Tactrix also ships an official OpenPort 2.0 microSD logging profile for Mitsubishi MUT-II over K-line (`type=mut2`), including real request IDs and a note that some older Mitsubishis require grounding OBD pin 1 via `setpinvoltage=1,-2`.
- EvoScan's ISO15765 setup originally differed from the project's assumptions: it connects with protocol `6`, `flags=0`, starts **`PASS_FILTER` (`filter type 1`)**, then issues `READ_VBATT`, `CLEAR_TX_BUFFER`, and `CLEAR_RX_BUFFER` style `Ioctl` calls around channel setup before normal reads/writes.
- The project transport has since been updated to mirror the `PASS_FILTER` choice and the `READ_VBATT` / local buffer-clear behavior, but ECU RX is still unverified.
- Deeper EvoScan decompilation shows that live logging treats `PassThruReadMsgs` as a low-level byte source, accumulating one J2534 message at a time into higher-level responses in application code.
- The previously noted extra `SET_CONFIG` values are now attributed to EvoScan's `MUTII` branch rather than its ISO15765 branch, so they should not currently be treated as OpenPort 2.0 logging requirements.
- The remaining ISO15765-specific hints are smaller but still relevant: EvoScan likely treats read return codes `9` and `16` as normal poll states (`TIMEOUT` / `BUFFER_EMPTY`), explicitly clears TX/RX buffers after setup, clears RX before at least some writes, and appears to set config `3 = 0` on the ISO15765 branch, which may correspond to `LOOPBACK = 0`.
- That shifts the leading remaining RX hypothesis away from the basic setup sequence and toward receive semantics: parser breadth, tolerated read statuses, and any missing ISO15765-specific monitoring behavior.
- The extracted Mitsubishi "PassThru CAN" payload is more substantial than first assumed: `data2.cab` contains `PTCAN.exe`, `MUT_VCI.dll`, `VciCRepro.dll`, `ptc32.dll`, and `ini_common/ClearDiagCANID.ini`.
- Mitsubishi's tooling confirms `REQ1=7E0` / `RES1=7E8` in `ClearDiagCANID.ini`, so the project's assumed MUT/UDS CAN IDs remain plausible.
- Mitsubishi appears to use a D-PDU / MUT-3 stack (`MUT_VCI.dll`) with queue-clearing and battery-voltage IOCTL concepts similar to the J2534 sequence seen in EvoScan, but it is not a drop-in OpenPort 2.0 J2534 reference.
- Mitsubishi's transport metadata also reinforces session-level expectations that may matter for RX validation: fixed 8-byte CAN padding with `0xFF`, tester-present payload `02 3E 02 FF FF FF FF FF`, and default diagnostic-session lifecycle values corresponding to `10 92` on start and `10 81` on exit.
- Mitsubishi's protocol metadata includes explicit CAN monitoring/filter controls (`CP_CANMONITORING`, `CP_CANMONITORINGFILTER`, `CP_CANMONITORINGIDENTIFIER`) and named response filters for positive, negative, wait, repeat, and tester-present handling. That strengthens the hypothesis that missing RX may be a filtering/monitoring configuration gap rather than a bad request payload.
- Further CAN ID / filter / flag tuning should be driven by an external CAN sniffer capture rather than blind iteration.
- The remaining OpenPort 2.0 K-line gap is now transport detail rather than feature existence: the vendor installer confirms the API surface and basic K-line usage, but this project still lacks a verified `openport2` mode for ISO9141/ISO14230 session setup, init IOCTL sequencing, and MUT-II polling on current hardware.

## Remaining research gaps

- Verify the real OpenPort 2.0 K-line `PassThruConnect` matrix: exact protocol IDs, flags, baud rates, and which `ISO9141_*` / `ISO14230_*` combinations actually succeed on hardware.
- Determine required init behavior for Mitsubishi MUT-II sessions: raw `10400` baud only, `FAST_INIT`, `FIVE_BAUD_INIT`, L-line participation, or no explicit init beyond `PassThruConnect`.
- Confirm the practical `SET_CONFIG` sequence for K-line mode, including which timing parameters matter (`P1_MAX`, `P3_MIN`, `P4_MIN`, `PARITY`, `LOOPBACK`) and which are ignored or rejected by `op20pt32.dll`.
- Validate K-line read/write framing semantics through J2534: whether MUT-II is exposed as raw byte payloads through `PassThruWriteMsgs` / `PassThruReadMsgs` exactly as the samples imply, or whether additional status handling is required.
- Confirm pin-control requirements for older Mitsubishi vehicles, especially when OBD pin 1 must be grounded or biased, and determine whether that behavior maps to `PassThruSetProgrammingVoltage`, a vendor IOCTL, or both.
- Establish which J2534 return codes are normal K-line polling states versus hard failures so the transport can tolerate expected idle/timeout behavior.
- Capture at least one real OpenPort 2.0 MUT-II session transcript, ideally at both the J2534 API level and the USB transport level, to anchor implementation against observed behavior instead of inference.

## Recommended research order

1. Trace `PassThruConnect`, `PassThruIoctl`, `PassThruWriteMsgs`, and `PassThruReadMsgs` while the real Windows stack talks to a known MUT-II ECU.
2. Capture USB traffic between `op20pt32.dll` and the adapter during the same session to determine whether the DLL is forwarding J2534 calls directly or translating them into adapter-specific packets.
3. Reverse `op20pt32.dll` around `PassThruConnect` and `PassThruIoctl` for `ISO9141` / `ISO14230` branches to fill in anything not obvious from runtime traces.
4. Validate the resulting host-side behavior against real hardware before integrating it into the project's `openport2` transport.

## Deferred follow-up

- Compare the project's `readProtocolMessage()` behavior against EvoScan's one-message-at-a-time accumulation model before continuing blind RX experiments.
- Keep EvoScan's `MUTII`-branch `SET_CONFIG` tuning documented for future MUT-II work, but do not mirror it into the ISO15765 serial backend without hardware evidence.
- Decide whether the transport should model EvoScan's likely `TIMEOUT` / `BUFFER_EMPTY` tolerance and ISO15765 `LOOPBACK = 0` behavior, or leave those for hardware-driven validation.
- Add user-facing multi-device hardware selection in the VS Code extension.
- Persist selected hardware identities in workspace state for reconnect flows.
- Track wideband and other non-OpenPort serial integrations as a separate follow-up once OpenPort protocol validation is complete.
