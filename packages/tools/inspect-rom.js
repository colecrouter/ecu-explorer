/**
 * inspect-rom - CLI tool for inspecting ROM files and their matched definitions.
 *
 * Outputs deterministic line-based key=value pairs for each ROM/match/table.
 *
 * @module
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	planRomDefinitionResolution,
	ROM_DEFINITION_CONFIDENCE_THRESHOLD,
	snapshotTable,
} from "@ecu-explorer/core";
import { EcuFlashProvider } from "@ecu-explorer/definitions-ecuflash";
import sade from "sade";

/**
 * Converts a filesystem path to a file:// URI.
 * @param {string} fsPath - Filesystem path
 * @returns {string} file:// URI
 */
function toFileUri(fsPath) {
	return `file://${fsPath.replace(/\\/g, "/")}`;
}

/**
 * Formats a value for output, escaping newlines.
 * @param {string|number|boolean|undefined} value - Value to format
 * @returns {string} Formatted value
 */
function formatValue(value) {
	if (value === undefined) return "";
	return String(value).replaceAll("\n", "\\n");
}

/**
 * Prints a line with key=value pairs.
 * @param {string} kind - The kind of line (e.g., "rom", "table", "match")
 * @param {Record<string, string|number|boolean|undefined>} fields - Fields to output
 */
function printLine(kind, fields) {
	const serialized = Object.entries({ kind, ...fields })
		.map(([key, value]) => `${key}=${JSON.stringify(formatValue(value))}`)
		.join(" ");
	console.log(serialized);
}

/**
 * Prints debug log to stderr.
 * @param {string} step - The step name
 * @param {Record<string, string|number|boolean>=} fields - Optional fields
 */
function debugLog(step, fields) {
	const serialized = fields
		? ` ${Object.entries(fields)
				.map(([key, value]) => `${key}=${JSON.stringify(formatValue(value))}`)
				.join(" ")}`
		: "";
	console.error(`[inspect:rom] step=${step}${serialized}`);
}

/**
 * Resolves a ROM definition for the given ROM file.
 * @param {string} romPath - Path to the ROM file
 * @param {Uint8Array} romBytes - ROM file contents
 * @param {EcuFlashProvider} provider - Definition provider
 * @param {string|undefined} explicitDefinitionPath - Explicit definition path
 * @returns {Promise<any>} Resolved inspection result
 */
async function resolveDefinition(
	romPath,
	romBytes,
	provider,
	explicitDefinitionPath,
) {
	if (explicitDefinitionPath) {
		const definitionUri = toFileUri(explicitDefinitionPath);
		debugLog("definition.parse.start", { definitionUri, mode: "explicit" });
		const definition = await provider.parse(definitionUri);
		debugLog("definition.parse.done", {
			definitionUri,
			tables: definition.tables.length,
			mode: "explicit",
		});
		return { mode: "explicit", definition, definitionUri };
	}

	debugLog("definition.plan.start", { romPath });
	const plan = await planRomDefinitionResolution(toFileUri(romPath), romBytes, [
		provider,
	]);
	debugLog("definition.plan.done", { kind: plan.kind });

	if (plan.kind === "auto") {
		return {
			mode: "auto",
			definition: plan.definition,
			definitionUri: plan.definitionUri,
			candidates: plan.candidates,
		};
	}

	if (plan.kind === "prompt-candidate") {
		console.error(
			`No usable definition met confidence threshold ${ROM_DEFINITION_CONFIDENCE_THRESHOLD}. Non-interactive inspection stopped before UI selection.`,
		);
		for (const candidate of plan.candidates.slice(0, 20)) {
			printLine("candidate", {
				provider: candidate.provider.id,
				name: candidate.peek.name,
				uri: candidate.peek.uri,
				score: candidate.score,
			});
		}
		throw new Error(
			"Definition resolution requires interactive candidate selection",
		);
	}

	if (plan.kind === "prompt-all") {
		console.error(
			"No matching definition candidates were found. Non-interactive inspection stopped before manual definition selection.",
		);
		for (const definition of plan.allDefinitions.slice(0, 20)) {
			printLine("candidate", {
				provider: definition.provider.id,
				name: definition.peek.name,
				uri: definition.peek.uri,
				score: 0,
			});
		}
		throw new Error(
			"Definition resolution requires manual definition selection",
		);
	}

	console.error(
		"No definition files were discovered. Non-interactive inspection stopped before file picker selection.",
	);
	throw new Error("Definition resolution requires manual file selection");
}

/**
 * Emits table information as a line.
 * @param {any} table - Table definition
 * @param {Uint8Array} romBytes - ROM file contents
 */
function emitTable(table, romBytes) {
	const snapshot = snapshotTable(table, romBytes);
	if (snapshot.kind === "table1d") {
		printLine("table", {
			name: table.name,
			tableKind: table.kind,
			category: table.category,
			rows: snapshot.rows,
			cols: snapshot.z.length,
			address: table.z.address,
			dtype: table.z.dtype,
			unit: table.z.unit?.symbol,
			xCount: snapshot.x?.length ?? 0,
			valuesCount: snapshot.z.length,
			firstValue: snapshot.z[0],
			lastValue: snapshot.z[snapshot.z.length - 1],
		});
		return;
	}

	printLine("table", {
		name: table.name,
		tableKind: table.kind,
		category: table.category,
		rows: snapshot.rows,
		cols: snapshot.cols,
		address: table.z.address,
		dtype: table.z.dtype,
		unit: table.z.unit?.symbol,
		xCount: snapshot.x?.length ?? 0,
		yCount: snapshot.y?.length ?? 0,
		firstValue: snapshot.z[0]?.[0],
		lastValue: snapshot.z[snapshot.rows - 1]?.[snapshot.cols - 1],
	});
}

/**
 * Inspects a ROM file and outputs its metadata and tables.
 * @param {string} romPath - Path to the ROM file
 * @param {any} opts - CLI options
 * @returns {Promise<void>}
 */
async function inspectRom(romPath, opts) {
	const definitionsRoots = opts.definitionsRoot
		? [path.resolve(opts.definitionsRoot)]
		: [];
	const definitionPath = opts.definition;

	debugLog("rom.read.start", { romPath });
	const romBytes = new Uint8Array(await fs.readFile(romPath));
	debugLog("rom.read.done", {
		romPath,
		size: romBytes.length,
	});

	const provider = new EcuFlashProvider(definitionsRoots);
	debugLog("provider.ready", {
		provider: provider.id,
		definitionsRoots: definitionsRoots.length,
	});

	const resolved = await resolveDefinition(
		romPath,
		romBytes,
		provider,
		definitionPath,
	);
	debugLog("definition.resolved", {
		mode: resolved.mode,
		definitionUri: resolved.definitionUri,
		tables: resolved.definition.tables.length,
	});

	printLine("rom", {
		path: romPath,
		size: romBytes.length,
		definitionMode: resolved.mode,
		definitionUri: resolved.definitionUri,
		tables: resolved.definition.tables.length,
		platformMake: resolved.definition.platform.make,
		platformModel: resolved.definition.platform.model,
		platformYear: resolved.definition.platform.year,
	});

	if (resolved.mode === "auto") {
		for (const [index, candidate] of resolved.candidates
			.slice(0, 5)
			.entries()) {
			printLine("match", {
				rank: index + 1,
				name: candidate.peek.name,
				uri: candidate.peek.uri,
				score: candidate.score,
				selected: candidate.peek.uri === resolved.definitionUri,
			});
		}
	}

	debugLog("table.emit.start", { count: resolved.definition.tables.length });
	for (const table of resolved.definition.tables) {
		emitTable(table, romBytes);
	}
	debugLog("table.emit.done", { count: resolved.definition.tables.length });
}

// Create CLI with Sade
const prog = sade("inspect-rom <rom>", true);

prog
	.version("1.0.0")
	.describe("Inspect ROM metadata and tables, outputting key=value lines")
	.example("inspect-rom ./rom.hex")
	.example("inspect-rom ./rom.hex --definition ./definition.xml")
	.example("inspect-rom ./rom.hex --definitions-root ./definitions")
	.option("-d, --definition", "Explicit definition XML override")
	.option("--definitions-root", "Extra search root for auto-discovery")
	.action((rom, opts) => {
		inspectRom(rom, opts).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

prog.parse(process.argv);
