/** Serializable data shared by the comparison host and webview. */
export type DiffTableStatus =
	| "unchanged"
	| "changed"
	| "axis_changed"
	| "incompatible"
	| "base_only"
	| "target_only";
export interface DiffSourceInfo {
	label: string;
	path: string;
	definition: string;
	capturedAt: string;
}
export interface DiffTableSummary {
	index: number;
	name: string;
	category: string;
	status: DiffTableStatus;
	cellsChanged: number;
}
/** Infinity needs explicit tokens: VS Code's JSON transport turns it into null. */
export type DiffValue = number | "Infinity" | "-Infinity";

export function encodeDiffValue(value: number): DiffValue {
	if (Number.isNaN(value))
		throw new Error("Cannot serialize a NaN table value.");
	if (value === Infinity) return "Infinity";
	if (value === -Infinity) return "-Infinity";
	return value;
}

export function formatDiffValue(value: DiffValue | undefined): string {
	if (value === undefined) return "—";
	if (value === "Infinity") return "∞";
	if (value === "-Infinity") return "−∞";
	return String(Number(value.toFixed(4)));
}

/** Equal infinities are unchanged; other infinite differences have no finite delta. */
export function diffValueDelta(
	value: DiffValue,
	baseline: DiffValue | undefined,
): number | undefined {
	if (value === baseline) return 0;
	if (typeof value !== "number" || typeof baseline !== "number")
		return undefined;
	const delta = value - baseline;
	return Number.isFinite(delta) ? delta : undefined;
}

export interface DiffGridData {
	is1D: boolean;
	rows: number;
	cols: number;
	values: DiffValue[][];
	xAxisValues: DiffValue[];
	yAxisValues: DiffValue[];
}
export interface DiffTableDetail extends DiffTableSummary {
	unit: string;
	reason?: string;
	base?: DiffGridData;
	target?: DiffGridData;
	xAxisChanged: boolean;
	yAxisChanged: boolean;
}
export interface DiffSummaryMessage {
	type: "summary";
	base: DiffSourceInfo;
	target: DiffSourceInfo;
	definitionsDiffer: boolean;
	tables: DiffTableSummary[];
}
export type DiffHostMessage =
	| DiffSummaryMessage
	| { type: "detail"; detail: DiffTableDetail };
export type DiffWebviewMessage =
	| { type: "ready" }
	| { type: "selectTable"; index: number };
