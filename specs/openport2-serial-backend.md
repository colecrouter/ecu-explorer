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
