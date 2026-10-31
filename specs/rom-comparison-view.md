# Multi-table ROM comparison

Status: Implemented (2026-10-31)

Compare saved ROMs, an active editor snapshot (including unsaved edits) and a
fresh ECU read using one read-only, multi-table viewer.

## Commands and direction

- Compare Saved ROMs: baseline file → comparison file.
- Compare Active ROM with Saved ROM: saved baseline → active editor snapshot.
- Compare Saved ROM with ECU: ECU baseline → saved comparison.
- Compare Active ROM with ECU: ECU baseline → active editor snapshot.

Select local sources before contacting hardware. Cancelled source selection does
not open a viewer or read the ECU. Active bytes are copied before any dialogs or
hardware work so edits during a read do not change the comparison.

## Viewer

A searchable table list defaults to differences and includes changed axes,
incompatible layouts, and tables missing from either definition. Selecting a
table shows baseline and comparison values and signed deltas (comparison minus
baseline). Axis changes are shown explicitly; index deltas are not presented as
matching physical operating points. Definition differences, duplicate table
names, unsupported kinds, unreadable addresses and ROM size differences must
not silently produce a misleading match. Use the existing MCP comparison logic.
The viewer follows VS Code theme variables and supports keyboard navigation.

## ECU lifecycle

Read once with notification progress. Suspend live polling and wait for the
current request to settle before entering the read protocol. Restore the stream
only after the protocol's cleanup completes. Store a unique timestamped binary
snapshot under the workspace's `ECU Snapshots` folder (extension global storage
if no folder is open), and display its location and capture time. A failed read
or snapshot save opens no comparison. Comparison commands never write flash.

## Acceptance checks

- [x] Four commands use the intended source order and preserve unsaved bytes.
- [x] Cancelling selection never contacts the ECU.
- [x] One view lists all differences and shows per-table values and deltas.
- [x] Changed axes, missing tables, layout conflicts and decode failures are explicit.
- [x] ECU reads save a snapshot and release polling safely on success or failure.
- [x] Type checks, lint, coverage suite and cross-package build pass.

## Implementation and validation

- Source orchestration: [`compare-roms.ts`](../apps/vscode/src/commands/compare-roms.ts)
  and [`rom-comparison-commands.ts`](../apps/vscode/src/commands/rom-comparison-commands.ts).
- Decoded comparisons: [`comparison.ts`](../apps/vscode/src/rom/comparison.ts),
  reusing the exported MCP table analysis module. 1D and 2D tables are supported;
  other kinds, duplicate display names, unit conflicts and decoding failures
  appear as explicit incompatible entries.
- Viewer: [`rom-diff-panel.ts`](../apps/vscode/src/rom-diff-panel.ts) and
  [`RomDiffApp.svelte`](../apps/vscode/src/webview/RomDiffApp.svelte).
  Row grids paginate after 64 rows. Detail messages contain numeric snapshots,
  never definition functions or complete ROM buffers.
- ECU snapshots: [`ecu-snapshot.ts`](../apps/vscode/src/rom/ecu-snapshot.ts).
  MUT-III/OBD-II live sessions expose completion promises; the live-data manager
  drains polling before reads and preserves elapsed timestamps when resuming.
- Regression coverage: source selection, saved versus unsaved buffers,
  snapshot persistence and cleanup, protocol exclusion, stream ownership,
  search, unchanged filters, signed deltas and changed-axis behavior.
- Read-only local smoke check: definition `56890313`, 319 summary entries,
  approximately 26 ms for comparing two copies of the workspace calibration.
  Compiled viewer checked at 1200 px and 560 px with no page errors or horizontal
  document overflow. No hardware read or flash was performed during development.

Final validation: `npm run build`, `npm run check`, `npm run lint`, and
`npm run test:coverage` (1,976 tests across 101 files).

### Infinite decoded values (2026-10-31)

AFR scalings such as `14.7 * 128 / raw` produce infinity for zero bytes.
These values are valid displayable results: the viewer renders `∞` and `−∞`,
with matching infinities treated as unchanged and a zero delta. A transition
between finite and infinite values, or between opposite infinities, remains a
changed cell with an unavailable delta (`—`). NaN results remain explicit decode
failures. Infinity uses string tokens in webview messages to survive JSON
serialization. Regression coverage includes the eleven zero-valued cells in
`Max Lean Oct Avg AFR vs Load`, JSON transport, and rendered delta behavior.

Infinity fix validation: build, type checks, lint, and coverage passed (1,983
tests). Read-only reproduction against `diagnostic-id1050x-official-transient-stockscaled-v1.bin`
and `diagnostic-id1050x-idle1600-fuelplus4-tpsgate2-v1.bin` reports the AFR table
as unchanged, with eleven infinity values and eleven zero deltas after JSON
transport.
