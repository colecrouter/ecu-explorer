/**
 * Shared MCP resource helpers.
 */

export interface OpenDocumentsContextResource {
	version: number;
	timestamp: string;
	roms?: Array<{
		uri: string;
		path: string;
		name: string;
		sizeBytes: number;
		definition?: { name: string; uri?: string };
		isDirty: boolean;
		activeEditors: number;
		isFocused?: boolean;
		lastFocusedAt?: string;
	}>;
	tables?: Array<{
		uri: string;
		tableId: string;
		romPath: string;
		romUri: string;
		kind: string;
		dimensions: { rows: number; cols: number };
		unit?: string;
		definitionUri?: string;
		activeEditors: number;
		isFocused?: boolean;
		lastFocusedAt?: string;
	}>;
}

export function buildOpenDocumentsContextPayload(
	context: OpenDocumentsContextResource & {
		roms?: OpenDocumentsContextResource["roms"] | [];
		tables?: OpenDocumentsContextResource["tables"] | [];
	},
): string {
	return JSON.stringify(
		{
			version: context.version,
			timestamp: context.timestamp,
			...(context.roms !== undefined && context.roms.length > 0
				? { roms: context.roms }
				: {}),
			...(context.tables !== undefined && context.tables.length > 0
				? { tables: context.tables }
				: {}),
		},
		null,
		2,
	);
}

export function buildQuerySyntaxResourceText(): string {
	return [
		"# ECU Explorer Query Syntax",
		"",
		"Supported operators:",
		"- `==`, `!=`, `>`, `>=`, `<`, `<=`",
		"- `&&`, `||`",
		"- parentheses",
		"",
		"Field names can be used exactly as exposed by the tool, including spaces and punctuation.",
		"",
		"Examples:",
		"- `Engine RPM > 3000 && Knock Sum > 0`",
		"- `RPM (rpm) >= 3000 && Load (g/rev) <= 2.0`",
		"- `Coolant Temp (C) >= 60 && Coolant Temp (C) <= 90`",
		"",
		"For table selectors, equality first tries exact breakpoint values, then falls back to a unique match on the displayed breakpoint value when possible.",
	].join("\n");
}

export function buildLogFormatResourceText(): string {
	return [
		"# ECU Explorer Log Format",
		"",
		"Native ECU Explorer log CSVs are intentionally simple:",
		"- row 0: headers",
		"- row 1: units",
		"- row 2+: numeric samples",
		"",
		"Typical shape:",
		"```csv",
		"Timestamp (ms),Engine RPM,Knock Sum,Boost",
		"Unit,rpm,count,psi",
		"0,900,0,0.1",
		"100,1100,0,0.3",
		"```",
		"",
		"Assumptions:",
		"- data rows should be numeric-only",
		"- headers and units may include spaces and punctuation",
		"- time may be exposed in milliseconds or seconds",
		"",
		"Use `read_log(file)` to inspect the authoritative schema for a specific file.",
	].join("\n");
}

export function buildLogAnalysisResourceText(): string {
	return [
		"# Log Analysis Workflows",
		"",
		"Use MCP tools for:",
		"- discovering logs",
		"- checking schema and units",
		"- simple structured slices with `read_log`",
		"",
		"Use shell-native tooling for:",
		"- multi-row temporal patterns",
		"- ad hoc calculations",
		"- platform-specific analysis workflows",
		"",
		"Recommended defaults:",
		"- Windows: PowerShell with `Import-Csv`",
		"- macOS/Linux: Python with `csv.DictReader`",
		"- `awk`: good for lightweight scans and summaries",
		"",
		"Rule of thumb:",
		"- if the question is about one row at a time, `read_log` is usually enough",
		"- if the question compares neighboring rows or looks for sequences, prefer PowerShell or Python",
	].join("\n");
}
