# EvoScan live logging profiles

Status: Implemented (2026-10-31)

Discover EvoScan XML from `ecuExplorer.logging.configurationPaths` (workspace
relative directories or files; default `DataSettings`) and expose each ECU
variant separately in Change Logging Configuration. Reload files when resolving
profiles, preserving stable profile/channel identities across file edits.

Execute Mode23 requests using their full three-byte address, 1/2/4-byte unsigned
or signed responses, metric or original Eval formulas, inter-channel references,
and CALC channels including EvoScan postfix BITS extraction. Resolve dependencies
before selected outputs, cache identical requests within a polling cycle, and
never substitute a stale dependency after a failed read. Honour DataLog defaults.

Use expression parsing without JavaScript evaluation. Invalid expressions,
dependency cycles, ambiguous references, unsupported response sizes, RequestID2,
opaque protocols and CAN-bank requests produce explicit per-channel diagnostics.
External WDB channels remain supplied by the existing connected wideband source.
Profiles with no executable channels are unavailable. Importing a profile does
not establish that its ROM-specific addresses match the connected car.

Settings changes and file edits must reach future streams without changing an
already running stream's decode rules. Native configuration snapshots carry a
revision to restart polling when the selected file or unit preference changes.
No flash operations are part of this feature.

## Implementation

- [`evoscan-runtime.ts`](../packages/device/protocols/mut3/src/evoscan-runtime.ts)
  compiles existing parsed XML metadata to executable channels. Each file/ECU
  variant has a stable ID; channel IDs derive from LogReference. Decode revisions
  change with XML content or unit preference. Expressions use an arithmetic
  interpreter with an explicit BITS function and no JavaScript evaluation.
- [`evoscan-profile-loader.ts`](../apps/vscode/src/evoscan-profile-loader.ts) uses
  VS Code filesystem access and workspace-scoped settings to discover XML files.
  It reads fresh content before resolving profiles and caches compiled snapshots.
  Invalid files are isolated; diagnostics go to ECU Explorer Logging output.
- MUT-III registers imported profiles alongside built-ins. The polling engine
  reads each required address/width once per cycle, evaluates dependency chains,
  emits selected outputs and retains the existing ROM-operation exclusion.
- Metric formulas fall back to Eval/Unit when absent. ResponseBytes 1, 2 and 4
  and Signed are supported. Gauge bounds are retained as descriptor metadata.
  XML Priority and visual styling do not override native polling or UI controls.
- Unsupported CAN-bank requests, opaque protocols, RequestID2, external WDB
  dependencies, ambiguous references and alternate ECU destinations are excluded
  with per-channel diagnostics. Profiles without executable channels are hidden
  from the native picker. WDB recording remains a separate connected source.

## Validation

Tests cover linked-directory discovery, file edits, stable identities, metric and
original signed decoding, DataLog defaults, dependency cycles, BITS, invalid
expressions, full on-wire addresses, request de-duplication, fresh dependencies,
and decode revision changes. Local files compiled successfully: Golden 2011
USDM v3 (39 ECU channels), LoadTrace v7 (63), RAX Rev E (42 including calculated
channels), and CodeCheck v1 (17). Their WDB entries are handled by the existing
wideband source. No vehicle operations were performed during implementation.

Final validation: `npm run build`, `npm run check`, `npm run lint`, and
`npm run test:coverage` passed (1,994 tests across 106 files). All 34 local XML
files parsed without errors, producing 67 variants, of which 40 have executable
engine channels. Imported display names and units are CSV-quoted to preserve
column boundaries, including the comma-containing fuel-trim names in the JP/EU/AU
configuration. The local ECU workspace explicitly searches its linked
`DataSettings/` directory with metric units.
