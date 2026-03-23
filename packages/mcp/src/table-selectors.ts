/**
 * Shared table selector helpers for read_table / patch_table.
 */

import type {
	Table1DDefinition,
	Table2DDefinition,
	TableDefinition,
} from "@ecu-explorer/core";
import { compileExpression } from "filtrex";
import {
	buildAliasedObject,
	buildFieldAliasMap,
	buildUnknownFieldError,
	detectUnknownFieldFragments,
	escapeRegex,
	normalizeExpression,
	rewriteExpressionWithAliases,
} from "./query-utils.js";

export interface TableSelection {
	rowIndices: number[];
	colIndices: number[];
	cellsMatched: number;
	matchedCells: Array<{ row: number; col: number }>;
	selectorAxes: string[];
}

function uniqueSorted(values: number[]): number[] {
	return [...new Set(values)].sort((a, b) => a - b);
}

function formatSelectorNumber(value: number): string {
	if (!Number.isFinite(value)) return String(value);
	const s = value.toFixed(4);
	return s.replace(/\.?0+$/, "");
}

function resolveDisplayEqualityValue(
	axisName: string,
	axisValues: number[],
	requested: number,
): { exactOrResolved?: number; ambiguousValues?: number[] } {
	if (axisValues.some((value) => value === requested)) {
		return { exactOrResolved: requested };
	}

	const requestedDisplay = formatSelectorNumber(requested);
	const displayMatches = axisValues.filter(
		(value) => formatSelectorNumber(value) === requestedDisplay,
	);
	const uniqueMatches = uniqueSorted(displayMatches);

	if (uniqueMatches.length === 1) {
		const exactOrResolved = uniqueMatches[0];
		return exactOrResolved === undefined ? {} : { exactOrResolved };
	}

	if (uniqueMatches.length > 1) {
		return { ambiguousValues: uniqueMatches };
	}

	void axisName;
	return {};
}

function rewriteEqualityComparisons(
	where: string,
	axisName: string,
	axisValues: number[],
): string {
	const escaped = escapeRegex(axisName);
	const re = new RegExp(
		`(^|[^A-Za-z0-9_])(${escaped})\\s*(==|!=)\\s*(-?\\d+(?:\\.\\d+)?)`,
		"g",
	);

	return where.replace(re, (full, prefix, field, operator, literal) => {
		const requested = Number(literal);
		if (!Number.isFinite(requested)) return full;

		const { exactOrResolved, ambiguousValues } = resolveDisplayEqualityValue(
			axisName,
			axisValues,
			requested,
		);

		if (ambiguousValues !== undefined) {
			throw new Error(
				`Ambiguous ${operator} selector for ${axisName}: ${literal} matches multiple displayed breakpoints (${ambiguousValues.join(", ")}). Use one of the exact breakpoint values instead.`,
			);
		}

		if (exactOrResolved === undefined) {
			return full;
		}

		return `${prefix}${field} ${operator} ${String(exactOrResolved)}`;
	});
}

function getSelectorAxes(table: TableDefinition): string[] {
	const axes: string[] = [];
	if (table.x?.name) axes.push(table.x.name);
	if ((table.kind === "table2d" || table.kind === "table3d") && table.y?.name) {
		axes.push(table.y.name);
	}
	return axes;
}

function buildEqualitySuggestion(
	where: string,
	axisName: string,
	axisValues: number[],
): string[] {
	const escaped = escapeRegex(axisName);
	const re = new RegExp(
		`(^|[^A-Za-z0-9_])${escaped}\\s*==\\s*(-?\\d+(?:\\.\\d+)?)`,
		"g",
	);
	const suggestions: string[] = [];

	for (const match of where.matchAll(re)) {
		const requested = Number(match[2]);
		if (!Number.isFinite(requested)) continue;
		const nearest = [...axisValues]
			.sort((a, b) => Math.abs(a - requested) - Math.abs(b - requested))
			.slice(0, 3);
		if (nearest.length > 0) {
			suggestions.push(`${axisName}: nearest values are ${nearest.join(", ")}`);
		}
	}

	return suggestions;
}

export function selectTableCells(
	table: TableDefinition,
	xAxisValues: number[],
	yAxisValues: number[],
	where?: string,
): TableSelection {
	if (where === undefined) {
		const rowCount = table.rows;
		const colCount = table.kind === "table1d" ? 1 : table.cols;
		return {
			rowIndices: Array.from({ length: rowCount }, (_, index) => index),
			colIndices: Array.from({ length: colCount }, (_, index) => index),
			cellsMatched: rowCount * colCount,
			matchedCells: Array.from({ length: rowCount }, (_, row) =>
				Array.from({ length: colCount }, (_, col) => ({ row, col })),
			).flat(),
			selectorAxes: getSelectorAxes(table),
		};
	}

	const selectorAxes = getSelectorAxes(table);
	let normalizedWhere = where;

	if (table.x?.name) {
		normalizedWhere = rewriteEqualityComparisons(
			normalizedWhere,
			table.x.name,
			xAxisValues,
		);
	}
	if ((table.kind === "table2d" || table.kind === "table3d") && table.y?.name) {
		normalizedWhere = rewriteEqualityComparisons(
			normalizedWhere,
			table.y.name,
			yAxisValues,
		);
	}

	const { fieldToAlias } = buildFieldAliasMap(selectorAxes, "__axis_");
	const unknownFragments = detectUnknownFieldFragments(
		normalizedWhere,
		selectorAxes,
	);
	if (unknownFragments.length > 0) {
		throw buildUnknownFieldError("axis name", unknownFragments, selectorAxes);
	}

	const rewritten = rewriteExpressionWithAliases(
		normalizeExpression(normalizedWhere),
		fieldToAlias,
	);

	let selector: (values: Record<string, number>) => unknown;
	try {
		selector = compileExpression(rewritten);
	} catch (err) {
		throw new Error(
			`Invalid where expression for table selector: ${err instanceof Error ? err.message : String(err)}. Available axes: ${selectorAxes.join(", ")}`,
		);
	}

	const matchedRows: number[] = [];
	const matchedCols: number[] = [];
	const matchedCells: Array<{ row: number; col: number }> = [];

	if (table.kind === "table1d") {
		const table1d = table as Table1DDefinition;
		for (let rowIndex = 0; rowIndex < table1d.rows; rowIndex++) {
			const row = {
				[table1d.x?.name ?? "Index"]: xAxisValues[rowIndex] ?? rowIndex,
			};
			const aliasRow = buildAliasedObject(row, fieldToAlias);
			if (selector({ ...row, ...aliasRow })) {
				matchedRows.push(rowIndex);
				matchedCells.push({ row: rowIndex, col: 0 });
			}
		}
	} else if (table.kind === "table2d") {
		const table2d = table as Table2DDefinition;
		for (let rowIndex = 0; rowIndex < table2d.rows; rowIndex++) {
			for (let colIndex = 0; colIndex < table2d.cols; colIndex++) {
				const row = {
					[table2d.x?.name ?? "X"]: xAxisValues[colIndex] ?? colIndex,
					[table2d.y?.name ?? "Y"]: yAxisValues[rowIndex] ?? rowIndex,
				};
				const aliasRow = buildAliasedObject(row, fieldToAlias);
				if (selector({ ...row, ...aliasRow })) {
					matchedRows.push(rowIndex);
					matchedCols.push(colIndex);
					matchedCells.push({ row: rowIndex, col: colIndex });
				}
			}
		}
	} else {
		throw new Error("Table selectors are only supported for 1D and 2D tables.");
	}

	const rowIndices = uniqueSorted(matchedRows);
	const colIndices = table.kind === "table1d" ? [0] : uniqueSorted(matchedCols);

	if (rowIndices.length === 0 || colIndices.length === 0) {
		const axisSuggestions = [
			...(table.x?.name
				? buildEqualitySuggestion(where, table.x.name, xAxisValues)
				: []),
			...(table.kind === "table2d" && table.y?.name
				? buildEqualitySuggestion(where, table.y.name, yAxisValues)
				: []),
		];

		throw new Error(
			`Table selector matched no cells. Available axes: ${selectorAxes.join(", ")}.` +
				(axisSuggestions.length > 0 ? ` ${axisSuggestions.join(" ")}` : ""),
		);
	}

	return {
		rowIndices,
		colIndices,
		cellsMatched: matchedCells.length,
		matchedCells,
		selectorAxes,
	};
}
