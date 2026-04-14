/**
 * patch_table tool handler for the ECU Explorer MCP server.
 *
 * Applies a math operation to a calibration table and saves to ROM.
 * Returns the updated table in the same format as read_table.
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Table1DDefinition, Table2DDefinition } from "@ecu-explorer/core";
import {
	addConstant,
	clampValues,
	decodeScalar,
	findClosestTableMatches,
	multiplyConstant,
	recomputeChecksum,
	smoothValues,
	writeChecksum,
} from "@ecu-explorer/core";
import type { McpConfig } from "../config.js";
import {
	formatTable,
	formatTableSlice,
	writeTable1DValues,
	writeTable2DValues,
} from "../formatters/table-formatter.js";
import { toYamlFrontmatter } from "../formatters/yaml-formatter.js";
import { invalidateRomCache, loadRom } from "../rom-loader.js";
import { analyzeTablePair, findTableByName } from "../table-diff.js";
import { selectTableCells } from "../table-selectors.js";

function toLoadRomOptions(definitionPath?: string) {
	return definitionPath === undefined ? {} : { definitionPath };
}

export type PatchOp = "set" | "add" | "multiply" | "clamp" | "smooth";
export type PatchValue = number | number[] | number[][];

export interface PatchTableOptions {
	rom: string;
	table: string;
	op: PatchOp;
	definitionPath?: string;
	value?: PatchValue;
	min?: number;
	max?: number;
	where?: string;
	row?: number;
	col?: number;
}

/**
 * Handle the patch_table tool call.
 *
 * @param options - Patch options
 * @param config - MCP server configuration
 * @returns Formatted output string (updated table)
 */
export async function handlePatchTable(
	options: PatchTableOptions,
	config: McpConfig,
): Promise<string> {
	const {
		rom: romPath,
		table: tableName,
		op,
		definitionPath,
		value,
		min,
		max,
		where,
		row,
		col,
	} = options;
	const patchValue = value;

	if (where !== undefined && (row !== undefined || col !== undefined)) {
		throw new Error(
			`Use either "where" or legacy row/col targeting, not both.`,
		);
	}

	// Validate operation parameters
	if (op === "set" || op === "add" || op === "multiply") {
		if (patchValue === undefined) {
			throw new Error(`Operation "${op}" requires a "value" parameter.`);
		}
	}

	if (op === "clamp") {
		if (min === undefined || max === undefined) {
			throw new Error(
				`Operation "clamp" requires both "min" and "max" parameters.`,
			);
		}
		if (min > max) {
			throw new Error(
				`"min" (${min}) must be less than or equal to "max" (${max}).`,
			);
		}
	}

	// Load ROM + definition
	const loaded = await loadRom(
		romPath,
		config.definitionsPaths,
		toLoadRomOptions(definitionPath),
	);
	const { definition, romBytes } = loaded;

	// Find the table definition by name
	const tableDef = findTableByName(definition.tables, tableName);

	if (!tableDef) {
		const suggestions = findClosestTableMatches(
			tableName,
			definition.tables,
			3,
		);
		const suggestionText =
			suggestions.length > 0
				? `\nDid you mean: ${suggestions.map((table) => table.name).join(", ")}?`
				: "";

		throw new Error(
			`Table "${tableName}" not found in ROM definition "${definition.name}". ` +
				suggestionText +
				"\nUse list_tables to see all available tables.",
		);
	}

	// smooth is only valid for 2D tables
	if (op === "smooth" && tableDef.kind !== "table2d") {
		throw new Error(
			`Operation "smooth" is only valid for 2D tables. Table "${tableName}" is a ${tableDef.kind}.`,
		);
	}

	// Make a mutable copy of ROM bytes
	const mutableRomBytes = new Uint8Array(romBytes);
	const fullTable = formatTable(romPath, tableDef, mutableRomBytes);
	const selector =
		where !== undefined
			? selectTableCells(
					tableDef,
					fullTable.xAxisValues,
					fullTable.yAxisValues,
					where,
				)
			: undefined;

	if (tableDef.kind === "table1d") {
		// Read current values
		const currentValues = readTable1DPhysical(mutableRomBytes, tableDef);
		const numRows = currentValues.length;

		// Validate legacy row/col bounds
		if (row !== undefined && row >= numRows) {
			throw new Error(
				`Row index ${row} is out of bounds for table "${tableName}" (${numRows} rows).`,
			);
		}
		if (col !== undefined && col >= 1) {
			throw new Error(
				`Column index ${col} is out of bounds for 1D table "${tableName}" (1 column).`,
			);
		}

		// Determine target indices
		const targetIndices: number[] =
			selector !== undefined
				? selector.matchedCells.map((cell) => cell.row)
				: row !== undefined
					? [row]
					: Array.from({ length: numRows }, (_, i) => i);

		// Extract target values
		const targetValues = targetIndices.map((i) => currentValues[i] as number);

		// Apply operation
		const newTargetValues = applyOp1D(op, targetValues, patchValue, min, max);

		// Write back
		const newValues = [...currentValues];
		for (let i = 0; i < targetIndices.length; i++) {
			const idx = targetIndices[i] as number;
			newValues[idx] = newTargetValues[i] as number;
		}

		writeTable1DValues(mutableRomBytes, tableDef, newValues);
	} else if (tableDef.kind === "table2d") {
		// Read current values
		const currentValues = readTable2DPhysical(mutableRomBytes, tableDef);
		const numRows = currentValues.length;
		const numCols = currentValues[0]?.length ?? 0;

		// Validate row/col bounds
		if (row !== undefined && row >= numRows) {
			throw new Error(
				`Row index ${row} is out of bounds for table "${tableName}" (${numRows} rows).`,
			);
		}
		if (col !== undefined && col >= numCols) {
			throw new Error(
				`Column index ${col} is out of bounds for table "${tableName}" (${numCols} columns).`,
			);
		}

		let newValues: number[][];

		if (op === "smooth") {
			if (where !== undefined) {
				throw new Error(
					`Operation "smooth" currently requires the whole table.`,
				);
			}
			// smooth applies to entire table
			const result = smoothValues(currentValues);
			// Reshape flat result back to 2D
			newValues = [];
			for (let r = 0; r < numRows; r++) {
				const rowVals: number[] = [];
				for (let c = 0; c < numCols; c++) {
					rowVals.push(result.values[r * numCols + c] as number);
				}
				newValues.push(rowVals);
			}
		} else {
			// Determine target cells
			newValues = currentValues.map((r) => [...r]);

			if (selector !== undefined) {
				if (!isScalarValue(patchValue) && !isElementwiseOp(op)) {
					throw new Error(
						`Shaped payloads are only supported for set, add, and multiply.`,
					);
				}
				if (!isScalarValue(patchValue)) {
					if (patchValue === undefined) {
						throw new Error(`Operation "${op}" requires a "value" parameter.`);
					}
					const shaped = normalizeShapedSelectionPayload(
						tableDef.name,
						selector,
						patchValue,
					);
					if (!isElementwiseOp(op)) {
						throw new Error(
							`Shaped payloads are only supported for set, add, and multiply.`,
						);
					}
					let valueIndex = 0;
					for (const rowIndex of selector.rowIndices) {
						for (const colIndex of selector.colIndices) {
							if (
								!selector.matchedCells.some(
									(cell) => cell.row === rowIndex && cell.col === colIndex,
								)
							) {
								throw new Error(
									`Shaped payloads require a contiguous rectangular selection.`,
								);
							}
							const current = currentValues[rowIndex]?.[colIndex];
							if (current === undefined) continue;
							const operand = shaped[valueIndex];
							if (operand === undefined) {
								throw new Error(
									`Missing shaped payload value at index ${valueIndex}.`,
								);
							}
							const [newVal] = applyElementwiseOp(op, current, operand);
							(newValues[rowIndex] as number[])[colIndex] = newVal;
							valueIndex++;
						}
					}
				} else {
					for (const cell of selector.matchedCells) {
						const current = currentValues[cell.row]?.[cell.col];
						if (current === undefined) continue;
						const [newVal] = applyOp1D(op, [current], patchValue, min, max);
						(newValues[cell.row] as number[])[cell.col] = newVal as number;
					}
				}
			} else if (row !== undefined && col !== undefined) {
				// Single cell
				const cell = currentValues[row]?.[col];
				if (cell === undefined) {
					throw new Error(
						`Cell [${row}, ${col}] is out of bounds for table "${tableName}".`,
					);
				}
				const [newVal] = applyOp1D(op, [cell], patchValue, min, max);
				(newValues[row] as number[])[col] = newVal as number;
			} else if (row !== undefined) {
				// Entire row
				const rowVals = currentValues[row] as number[];
				if (patchValue === undefined && isElementwiseOp(op)) {
					throw new Error(`Operation "${op}" requires a "value" parameter.`);
				}
				const definedPatchValue = patchValue;
				let rowValue = definedPatchValue;
				if (isNumberMatrix(definedPatchValue)) {
					rowValue = normalizeRowMatrixPayload(
						tableDef.name,
						rowVals.length,
						definedPatchValue,
					);
				}
				const newRowVals = applyOp1D(op, rowVals, rowValue, min, max);
				newValues[row] = newRowVals;
			} else if (col !== undefined) {
				// Entire column
				const colVals = currentValues.map((r) => r[col] as number);
				if (patchValue === undefined && isElementwiseOp(op)) {
					throw new Error(`Operation "${op}" requires a "value" parameter.`);
				}
				const definedPatchValue = patchValue;
				let colValue = definedPatchValue;
				if (isNumberMatrix(definedPatchValue)) {
					colValue = normalizeColumnMatrixPayload(
						tableDef.name,
						colVals.length,
						definedPatchValue,
					);
				}
				const newColVals = applyOp1D(op, colVals, colValue, min, max);
				for (let r = 0; r < numRows; r++) {
					(newValues[r] as number[])[col] = newColVals[r] as number;
				}
			} else {
				// Entire table
				const flat = currentValues.flat();
				if (patchValue === undefined && isElementwiseOp(op)) {
					throw new Error(`Operation "${op}" requires a "value" parameter.`);
				}
				const definedPatchValue = patchValue;
				let fullTableValue = definedPatchValue;
				if (isNumberMatrix(definedPatchValue)) {
					fullTableValue = normalizeFullTableMatrixPayload(
						tableDef.name,
						numRows,
						numCols,
						definedPatchValue,
					);
				}
				const newFlat = applyOp1D(op, flat, fullTableValue, min, max);
				newValues = [];
				for (let r = 0; r < numRows; r++) {
					const rowVals: number[] = [];
					for (let c = 0; c < numCols; c++) {
						rowVals.push(newFlat[r * numCols + c] as number);
					}
					newValues.push(rowVals);
				}
			}
		}

		writeTable2DValues(mutableRomBytes, tableDef, newValues);
	} else {
		throw new Error(`Patching 3D tables is not supported.`);
	}

	// Recompute and write checksum
	if (definition.checksum) {
		try {
			const newChecksum = recomputeChecksum(
				mutableRomBytes,
				definition.checksum,
			);
			writeChecksum(mutableRomBytes, newChecksum, definition.checksum);
		} catch (err) {
			throw new Error(
				`Failed to update checksum after patch: ${err instanceof Error ? err.message : String(err)}.`,
			);
		}
	}

	// Atomically save to disk (temp file + rename)
	const absoluteRomPath = path.isAbsolute(romPath)
		? romPath
		: path.resolve(process.cwd(), romPath);

	const tmpPath = path.join(
		os.tmpdir(),
		`ecu-mcp-${Date.now()}-${path.basename(absoluteRomPath)}`,
	);

	try {
		await fs.writeFile(tmpPath, mutableRomBytes);
		await fs.rename(tmpPath, absoluteRomPath);
	} catch (err) {
		try {
			await fs.unlink(tmpPath);
		} catch {
			// Ignore cleanup errors
		}
		throw new Error(
			`Failed to write ROM file: ${err instanceof Error ? err.message : String(err)}`,
		);
	}

	// Invalidate ROM cache
	invalidateRomCache(absoluteRomPath);

	// Reload ROM with new bytes and return updated table diff
	const reloaded = await loadRom(
		romPath,
		config.definitionsPaths,
		toLoadRomOptions(definitionPath),
	);
	const postPatchTableDef = findTableByName(
		reloaded.definition.tables,
		tableDef.name,
	);
	const diff = analyzeTablePair(
		tableDef.name,
		romPath,
		romPath,
		tableDef,
		postPatchTableDef,
		romBytes,
		reloaded.romBytes,
	);
	const changedCells = diff.metrics?.cellsChanged ?? 0;
	const renderedResult =
		selector === undefined
			? formatTable(romPath, tableDef, reloaded.romBytes)
			: formatTableSlice(romPath, tableDef, reloaded.romBytes, {
					rowIndices: selector.rowIndices,
					colIndices: selector.colIndices,
				});
	const frontmatterData: Record<string, unknown> = {
		table: tableDef.name,
		op,
		cells_changed: changedCells,
	};
	if (where !== undefined) {
		frontmatterData.where = where;
	}
	const frontmatter = toYamlFrontmatter(frontmatterData);
	return `${frontmatter}\n${stripFrontmatter(renderedResult.content)}`;
}

function stripFrontmatter(content: string): string {
	if (!content.startsWith("---\n")) {
		return content;
	}

	const endIndex = content.indexOf("\n---\n", 4);
	if (endIndex === -1) {
		return content;
	}

	return content.slice(endIndex + 5);
}

/**
 * Apply a 1D operation to an array of values.
 */
function applyOp1D(
	op: PatchOp,
	values: number[],
	value?: PatchValue,
	min?: number,
	max?: number,
): number[] {
	if (
		!isScalarValue(value) &&
		op !== "set" &&
		op !== "add" &&
		op !== "multiply"
	) {
		throw new Error(
			`Shaped payloads are only supported for set, add, and multiply.`,
		);
	}
	switch (op) {
		case "set": {
			if (value === undefined) {
				throw new Error(`set requires a value`);
			}
			if (isScalarValue(value)) {
				return values.map(() => value);
			}
			const shaped = normalizeShapedLinearPayload(values.length, value);
			return values.map(
				(current, index) =>
					applyElementwiseOp("set", current, shaped[index] as number)[0],
			);
		}
		case "add": {
			if (value === undefined) {
				throw new Error(`add requires a value`);
			}
			if (isScalarValue(value)) {
				const result = addConstant(values, value);
				return result.values;
			}
			const shaped = normalizeShapedLinearPayload(values.length, value);
			return values.map(
				(current, index) =>
					applyElementwiseOp("add", current, shaped[index] as number)[0],
			);
		}
		case "multiply": {
			if (value === undefined) {
				throw new Error(`multiply requires a value`);
			}
			if (isScalarValue(value)) {
				const result = multiplyConstant(values, value);
				return result.values;
			}
			const shaped = normalizeShapedLinearPayload(values.length, value);
			return values.map(
				(current, index) =>
					applyElementwiseOp("multiply", current, shaped[index] as number)[0],
			);
		}
		case "clamp": {
			const result = clampValues(values, min as number, max as number);
			return result.values;
		}
		case "smooth":
			// smooth is handled separately for 2D tables
			throw new Error(`smooth operation is not valid for 1D arrays`);
	}
}

function isElementwiseOp(
	op: PatchOp,
): op is Extract<PatchOp, "set" | "add" | "multiply"> {
	return op === "set" || op === "add" || op === "multiply";
}

function isScalarValue(value: PatchValue | undefined): value is number {
	return typeof value === "number" && Number.isFinite(value);
}

function isNumberArray(value: PatchValue | undefined): value is number[] {
	return (
		Array.isArray(value) &&
		value.every((item) => typeof item === "number" && Number.isFinite(item))
	);
}

function isNumberMatrix(value: PatchValue | undefined): value is number[][] {
	return (
		Array.isArray(value) &&
		value.every(
			(row) =>
				Array.isArray(row) &&
				row.every((item) => typeof item === "number" && Number.isFinite(item)),
		)
	);
}

function payloadShape(value: PatchValue): string {
	if (isScalarValue(value)) return "scalar";
	if (isNumberArray(value)) return `[${value.length}]`;
	if (isNumberMatrix(value)) {
		const rows = value.length;
		const cols = value[0]?.length ?? 0;
		return `[${rows}x${cols}]`;
	}
	return "invalid";
}

function normalizeShapedLinearPayload(
	expectedLength: number,
	value: PatchValue,
): number[] {
	if (isNumberArray(value)) {
		if (value.length !== expectedLength) {
			throw new Error(
				`Payload shape mismatch: selected slice is [${expectedLength}], payload is ${payloadShape(value)}.`,
			);
		}
		return value;
	}
	throw new Error(
		`Payload shape mismatch: selected slice is [${expectedLength}], payload is ${payloadShape(value)}.`,
	);
}

function normalizeShapedSelectionPayload(
	tableName: string,
	selector: NonNullable<ReturnType<typeof selectTableCells>>,
	value: PatchValue,
): number[] {
	const rowCount = selector.rowIndices.length;
	const colCount = selector.colIndices.length;
	const selectedShape = `[${rowCount}x${colCount}]`;
	const isRectangular = selector.matchedCells.length === rowCount * colCount;
	if (!isRectangular) {
		throw new Error(
			`Shaped payloads require a contiguous rectangular selection for table "${tableName}". Selected slice is ${selectedShape}.`,
		);
	}

	if (isNumberArray(value)) {
		if (rowCount === 1 || colCount === 1) {
			const expectedLength = Math.max(rowCount, colCount);
			if (value.length !== expectedLength) {
				throw new Error(
					`Payload shape mismatch: selected slice is ${selectedShape}, payload is ${payloadShape(value)}.`,
				);
			}
			return value;
		}
		throw new Error(
			`Payload shape mismatch: selected slice is ${selectedShape}, payload is ${payloadShape(value)}.`,
		);
	}

	if (isNumberMatrix(value)) {
		if (rowCount === 1 && colCount === 1) {
			throw new Error(
				`Payload shape mismatch: selected slice is ${selectedShape}, payload is ${payloadShape(value)}.`,
			);
		}
		if (value.length !== rowCount) {
			throw new Error(
				`Payload shape mismatch: selected slice is ${selectedShape}, payload is ${payloadShape(value)}.`,
			);
		}
		for (const row of value) {
			if (row.length !== colCount) {
				throw new Error(
					`Payload shape mismatch: selected slice is ${selectedShape}, payload is ${payloadShape(value)}.`,
				);
			}
		}
		return value.flat();
	}

	throw new Error(
		`Payload shape mismatch: selected slice is ${selectedShape}, payload is ${payloadShape(value)}.`,
	);
}

function normalizeFullTableMatrixPayload(
	tableName: string,
	rows: number,
	cols: number,
	value: number[][],
): number[] {
	const selectedShape = `[${rows}x${cols}]`;
	if (value.length !== rows) {
		throw new Error(
			`Payload shape mismatch: selected slice is ${selectedShape}, payload is ${payloadShape(value)}.`,
		);
	}
	for (const row of value) {
		if (row.length !== cols) {
			throw new Error(
				`Payload shape mismatch: selected slice is ${selectedShape}, payload is ${payloadShape(value)}.`,
			);
		}
	}
	void tableName;
	return value.flat();
}

function normalizeRowMatrixPayload(
	tableName: string,
	expectedLength: number,
	value: number[][],
): number[] {
	const selectedShape = `[1x${expectedLength}]`;
	if (value.length !== 1 || (value[0]?.length ?? 0) !== expectedLength) {
		throw new Error(
			`Payload shape mismatch: selected slice is ${selectedShape}, payload is ${payloadShape(value)}.`,
		);
	}
	void tableName;
	return value[0] as number[];
}

function normalizeColumnMatrixPayload(
	tableName: string,
	expectedLength: number,
	value: number[][],
): number[] {
	const selectedShape = `[${expectedLength}x1]`;
	if (value.length !== expectedLength) {
		throw new Error(
			`Payload shape mismatch: selected slice is ${selectedShape}, payload is ${payloadShape(value)}.`,
		);
	}
	for (const row of value) {
		if (row.length !== 1) {
			throw new Error(
				`Payload shape mismatch: selected slice is ${selectedShape}, payload is ${payloadShape(value)}.`,
			);
		}
	}
	void tableName;
	return value.map((row) => row[0] as number);
}

function applyElementwiseOp(
	op: Extract<PatchOp, "set" | "add" | "multiply">,
	current: number,
	operand: number,
): [number] {
	switch (op) {
		case "set":
			return [operand];
		case "add":
			return [current + operand];
		case "multiply":
			return [current * operand];
	}
}

/**
 * Get the byte size of a scalar type.
 */
function byteSize(
	dtype: "u8" | "i8" | "u16" | "i16" | "u32" | "i32" | "f32",
): number {
	switch (dtype) {
		case "u8":
		case "i8":
			return 1;
		case "u16":
		case "i16":
			return 2;
		case "u32":
		case "i32":
		case "f32":
			return 4;
	}
}

/**
 * Read physical values from a 1D table.
 */
function readTable1DPhysical(
	romBytes: Uint8Array,
	def: Table1DDefinition,
): number[] {
	const z = def.z;
	const endian = z.endianness ?? "le";
	const elemSize = byteSize(z.dtype);
	const length = z.length ?? def.rows;
	const values: number[] = [];

	for (let i = 0; i < length; i++) {
		const byteOffset = z.address + i * elemSize;
		const raw = decodeScalar(romBytes, byteOffset, z.dtype, { endian });
		values.push(
			z.transform ? z.transform(raw) : raw * (z.scale ?? 1) + (z.offset ?? 0),
		);
	}

	return values;
}

/**
 * Read physical values from a 2D table.
 */
function readTable2DPhysical(
	romBytes: Uint8Array,
	def: Table2DDefinition,
): number[][] {
	const z = def.z;
	const endian = z.endianness ?? "le";
	const elemSize = byteSize(z.dtype);
	const rowStride = z.rowStrideBytes ?? def.cols * elemSize;
	const colStride = z.colStrideBytes ?? elemSize;

	const result: number[][] = [];

	for (let r = 0; r < def.rows; r++) {
		const row: number[] = [];
		for (let c = 0; c < def.cols; c++) {
			let byteOffset: number;
			if (z.indexer) {
				byteOffset = z.address + z.indexer(r, c);
			} else {
				byteOffset = z.address + r * rowStride + c * colStride;
			}
			const raw = decodeScalar(romBytes, byteOffset, z.dtype, { endian });
			row.push(
				z.transform ? z.transform(raw) : raw * (z.scale ?? 1) + (z.offset ?? 0),
			);
		}
		result.push(row);
	}

	return result;
}
