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
export interface DiffGridData {
	is1D: boolean;
	rows: number;
	cols: number;
	values: number[][];
	xAxisValues: number[];
	yAxisValues: number[];
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
