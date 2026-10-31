import type { ROMDefinition, TableDefinition } from "@ecu-explorer/core";
import {
	analyzeTablePair,
	sortWeight,
	type TablePairAnalysis,
} from "@ecu-explorer/mcp/table-diff";
import type * as vscode from "vscode";

export interface RomSnapshot {
	uri: vscode.Uri;
	label: string;
	capturedAt: string;
	bytes: Uint8Array;
	definition: ROMDefinition;
}

/** Freeze the editor's bytes before dialogs, ECU reads or subsequent edits. */
export function captureRomSnapshot(
	uri: vscode.Uri,
	bytes: Uint8Array,
	definition: ROMDefinition,
	label: string,
): RomSnapshot {
	return {
		uri,
		label,
		capturedAt: new Date().toISOString(),
		bytes: new Uint8Array(bytes),
		definition,
	};
}

export interface RomComparison {
	base: RomSnapshot;
	target: RomSnapshot;
	tables: TablePairAnalysis[];
}

/** Compare decoded tables using the same rules as the headless diff tool. */
export function buildRomComparison(
	base: RomSnapshot,
	target: RomSnapshot,
): RomComparison {
	if (base.bytes.length !== target.bytes.length)
		throw new Error(
			`ROM size mismatch: baseline has ${base.bytes.length} bytes; comparison has ${target.bytes.length} bytes.`,
		);
	const group = (tables: TableDefinition[]) => {
		const result = new Map<string, TableDefinition[]>();
		for (const table of tables)
			result.set(table.name, [...(result.get(table.name) ?? []), table]);
		return result;
	};
	const left = group(base.definition.tables),
		right = group(target.definition.tables);
	const tables = [...new Set([...left.keys(), ...right.keys()])]
		.map((name) => {
			const baseTable = left.get(name)?.[0],
				targetTable = right.get(name)?.[0];
			try {
				if (
					(left.get(name)?.length ?? 0) > 1 ||
					(right.get(name)?.length ?? 0) > 1
				)
					throw new Error(
						"Duplicate table name; the definitions do not identify a unique pair.",
					);
				if (
					baseTable &&
					targetTable &&
					baseTable.z.unit?.symbol !== targetTable.z.unit?.symbol
				)
					throw new Error("Table units differ between definitions.");
				const analysis = analyzeTablePair(
					name,
					base.uri.fsPath,
					target.uri.fsPath,
					baseTable,
					targetTable,
					base.bytes,
					target.bytes,
				);
				for (const snapshot of [
					analysis.baseSnapshot,
					analysis.targetSnapshot,
				]) {
					if (
						snapshot &&
						[
							...snapshot.values.flat(),
							...snapshot.xAxisValues,
							...snapshot.yAxisValues,
						].some((value) => Number.isNaN(value))
					) {
						throw new Error("Table contains NaN decoded values.");
					}
				}
				return analysis;
			} catch (error) {
				return {
					name,
					category: baseTable?.category ?? targetTable?.category ?? "",
					kind: baseTable?.kind ?? targetTable?.kind ?? "",
					unit: "",
					status: "incompatible",
					portability: "no",
					incompatibilityReason:
						error instanceof Error ? error.message : String(error),
				} satisfies TablePairAnalysis;
			}
		})
		.sort(
			(a, b) =>
				sortWeight(a.status) - sortWeight(b.status) ||
				a.name.localeCompare(b.name),
		);
	return { base, target, tables };
}
