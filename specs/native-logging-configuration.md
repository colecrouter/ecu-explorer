# Native logging configuration

Status: Implemented (2026-10-31)

`ECU Explorer: Change Logging Configuration` uses native profile selection and
channel multi-selection. One workspace configuration supplies both Start Live
Data and Start Live Data Log. A saved choice is validated against the connected
protocol and available profiles/channels before use; stale choices prompt again.
Legacy profile-only preferences preselect the profile in the first picker.

Live Data is a monitoring screen with a profile summary, selected channel values,
stream controls and Change Configuration button. It has no separate profile
selector or channel toggles. Opening it starts the configured stream and prompts
only if configuration is missing or invalid.

Pickers run before changing a stream or log. Cancelling either picker leaves the
previous configuration, stream and CSV intact. Empty channel selections are
rejected. Accepting a change while recording or paused saves the old CSV, drains
polling, applies the new configuration and opens a new CSV with stable columns.
Paused recording remains paused. A configuration change during an ECU ROM read
is rejected without altering its lifecycle. Wideband-only logging remains
available without an ECU profile.

No arbitrary DataSettings XML import is added here. Built-in profiles remain the
supported source of ECU channel descriptors.

## Implementation and verification

- [`logging-configuration.ts`](../apps/vscode/src/logging-configuration.ts): native
  pickers, saved selections, available-channel validation and legacy preference.
- [`logging-commands.ts`](../apps/vscode/src/commands/logging-commands.ts): shared
  command orchestration, CSV rotation and paused-state preservation.
- [`LiveDataApp.svelte`](../apps/vscode/src/webview/LiveDataApp.svelte): monitor-only
  view. Its emitted stylesheet is loaded by the host.
- Stream replacement waits for the previous poll to settle. ROM reads exclude
  configuration changes; closing the monitor preserves an active recording.
- CSV names include a unique suffix so rapid rotations cannot overwrite a prior
  log. Failed reads and writes preserve pending samples and permit a subsequent retry.
- Tests cover native selections, reuse, cancellation, stale channels, shared
  monitor/recording selections, CSV column consistency, paused rotation, retry
  after save failure, and rendered monitor behavior.

Validation: build, type checks, lint and the full coverage suite (1,981 tests).
The compiled monitor was checked at 1100 px and 480 px; its configuration button
routes to the native command, with no embedded selectors, console errors or
horizontal document overflow. Hardware was not contacted during development.
