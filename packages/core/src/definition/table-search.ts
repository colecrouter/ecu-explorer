import type { TableDefinition } from "./table.js";
import type { RankedMatch, SearchText } from "./fuzzy-match.js";
import { rankCandidates } from "./fuzzy-match.js";

export interface RankedTableMatch extends RankedMatch<TableDefinition> {}

function getTableSearchTexts(table: TableDefinition): SearchText[] {
	const texts: SearchText[] = [
		{ text: table.name, weight: 1 },
		{
			text: [
				table.name,
				table.category ?? "",
				table.kind,
				table.z.unit?.symbol ?? "",
				table.x?.name ?? "",
				table.kind === "table2d" || table.kind === "table3d"
					? (table.y?.name ?? "")
					: "",
			]
				.filter((value) => value.length > 0)
				.join(" "),
			weight: 0.95,
		},
		{ text: table.category ?? "", weight: 0.75 },
		{ text: table.x?.name ?? "", weight: 0.8 },
		{
			text:
				table.kind === "table2d" || table.kind === "table3d"
					? (table.y?.name ?? "")
					: "",
			weight: 0.8,
		},
		{ text: table.z.unit?.symbol ?? "", weight: 0.6 },
		{ text: table.kind, weight: 0.45 },
	];

	return texts.filter((entry) => entry.text.trim().length > 0);
}

export function rankTablesByQuery(
	query: string,
	tables: TableDefinition[],
	options: {
		maxResults?: number;
		minScore?: number;
	} = {},
): RankedTableMatch[] {
	return rankCandidates(query, tables, getTableSearchTexts, options);
}

export function findClosestTableMatches(
	query: string,
	tables: TableDefinition[],
	maxResults: number = 3,
	minScore: number = 0.35,
): TableDefinition[] {
	return rankTablesByQuery(query, tables, {
		maxResults,
		minScore,
	}).map((match) => match.value);
}
