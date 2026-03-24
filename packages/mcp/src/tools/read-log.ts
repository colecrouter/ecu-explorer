/**
 * read_log tool handler for the ECU Explorer MCP server.
 *
 * Reads one selected log file. Supports a schema/details mode when only the
 * file is provided, and a row mode when filters or range options are present.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { compileExpression } from "filtrex";
import type { McpConfig } from "../config.js";
import { buildMarkdownTable } from "../formatters/markdown.js";
import { toYamlFrontmatter } from "../formatters/yaml-formatter.js";
import { parseLogFileRows, readLogFileMeta } from "../log-reader.js";
import {
	buildAliasedObject,
	buildFieldAliasMap,
	buildUnknownFieldError,
	detectUnknownFieldFragments,
	extractReferencedFields,
	normalizeExpression,
	rewriteExpressionWithAliases,
} from "../query-utils.js";

export interface ReadLogOptions {
	file: string;
	where?: string;
	channels?: string[];
	startS?: number;
	endS?: number;
	stepMs?: number;
}

function resolveLogFilePath(
	logsDir: string,
	requestedFile: string,
): {
	logPath: string;
	outsideLogsDir: boolean;
} {
	const candidatePath = path.isAbsolute(requestedFile)
		? requestedFile
		: requestedFile.includes(path.sep) ||
				requestedFile.startsWith(`.${path.sep}`) ||
				requestedFile === "." ||
				requestedFile === ".."
			? path.resolve(process.cwd(), requestedFile)
			: path.resolve(logsDir, requestedFile);

	const normalizedBase = path.resolve(logsDir);
	const normalizedCandidate = path.resolve(candidatePath);
	const rel = path.relative(normalizedBase, normalizedCandidate);
	const outsideLogsDir = !(
		rel === "" ||
		(!rel.startsWith("..") &&
			!path.isAbsolute(rel) &&
			!rel.startsWith(`..${path.sep}`))
	);

	return {
		logPath: normalizedCandidate,
		outsideLogsDir,
	};
}

function formatLogValue(v: number | undefined): string {
	if (v === undefined || !Number.isFinite(v)) return "";
	const s = v.toFixed(4);
	return s.replace(/\.?0+$/, "");
}

function normalizeTimeToMs(
	timestamp: number,
	timeUnit: "ms" | "s" | null,
): number {
	return timeUnit === "s" ? timestamp * 1000 : timestamp;
}

function toSeconds(timestampMs: number): number {
	return timestampMs / 1000;
}

function isSchemaOnlyRequest(options: ReadLogOptions): boolean {
	return (
		options.where === undefined &&
		options.channels === undefined &&
		options.startS === undefined &&
		options.endS === undefined &&
		options.stepMs === undefined
	);
}

function validateRequestedChannels(
	requestedChannels: string[] | undefined,
	availableChannels: string[],
): string[] {
	if (requestedChannels === undefined) return availableChannels;

	const missing = requestedChannels.filter(
		(channel) => !availableChannels.includes(channel),
	);
	if (missing.length > 0) {
		throw new Error(
			`Unknown channel(s): ${missing.join(", ")}. Available channels: ${availableChannels.join(", ")}`,
		);
	}

	return requestedChannels;
}

/**
 * Handle the read_log tool call.
 */
export async function handleReadLog(
	options: ReadLogOptions,
	config: McpConfig,
): Promise<string> {
	const { file, where, channels, startS, endS, stepMs } = options;
	const { logPath, outsideLogsDir } = resolveLogFilePath(config.logsDir, file);
	const warningNote = outsideLogsDir
		? `Warning: ${logPath} is outside the configured logs directory ${config.logsDir}. Parsing may fail if the log file is not in the expected format.`
		: null;

	try {
		await fs.stat(logPath);
	} catch {
		throw new Error(`Log file not found: ${logPath}`);
	}

	const meta = await readLogFileMeta(logPath);
	const parsed = await parseLogFileRows(logPath);
	const timeColumnName = parsed.timeColumnName;
	const timeUnit = parsed.timeUnit;
	const dataChannels = parsed.headers.filter(
		(header) => header !== timeColumnName,
	);
	const selectedChannels = validateRequestedChannels(channels, dataChannels);

	if (isSchemaOnlyRequest(options)) {
		const frontmatter = toYamlFrontmatter({
			file,
			resolved_path: logPath,
			outside_logs_dir: outsideLogsDir,
			rows: meta.rowCount,
			duration_s:
				meta.durationMs !== null
					? Number((meta.durationMs / 1000).toFixed(3))
					: null,
			sample_rate_hz: meta.sampleRateHz,
			time_column: timeColumnName,
			time_unit: timeUnit,
			channels: selectedChannels,
		});

		if (selectedChannels.length === 0) {
			return `${frontmatter}\n${warningNote ? `${warningNote}\n\n` : ""}(No channels available in ${file})`;
		}

		const headers = ["Channel", "Unit"];
		const rows = selectedChannels.map((channel) => {
			const index = meta.channels.indexOf(channel);
			return [channel, index >= 0 ? (meta.units[index] ?? "") : ""];
		});

		return `${frontmatter}\n${warningNote ? `${warningNote}\n\n` : ""}${buildMarkdownTable(headers, rows)}`;
	}

	const startMs = startS !== undefined ? startS * 1000 : undefined;
	const endMs = endS !== undefined ? endS * 1000 : undefined;

	if (
		(startMs !== undefined || endMs !== undefined || stepMs !== undefined) &&
		!timeColumnName
	) {
		throw new Error(
			`Log ${file} does not expose a time column required for range options.`,
		);
	}

	const normalizedWhere =
		where !== undefined ? normalizeExpression(where) : undefined;
	let filterFn: ((obj: Record<string, number>) => unknown) | undefined;
	let referencedFields: string[] = [];
	const { fieldToAlias } = buildFieldAliasMap(parsed.headers, "__log_");

	if (normalizedWhere !== undefined) {
		referencedFields = extractReferencedFields(
			where ?? normalizedWhere,
			parsed.headers,
		);
		const unknownFragments = detectUnknownFieldFragments(
			where ?? normalizedWhere,
			parsed.headers,
		);
		if (unknownFragments.length > 0) {
			throw buildUnknownFieldError("field", unknownFragments, parsed.headers);
		}

		const rewritten = rewriteExpressionWithAliases(
			normalizedWhere,
			fieldToAlias,
		);

		try {
			filterFn = compileExpression(rewritten);
		} catch (err) {
			throw new Error(
				`Invalid where expression: ${err instanceof Error ? err.message : String(err)}. Available fields: ${parsed.headers.join(", ")}`,
			);
		}
	}

	const baseRows = parsed.rows.map((row, index) => ({
		index,
		row,
		timeMs:
			timeColumnName !== null && row[timeColumnName] !== undefined
				? normalizeTimeToMs(row[timeColumnName], timeUnit)
				: undefined,
	}));

	const matchedRows = baseRows.filter(({ row, timeMs }) => {
		if (startMs !== undefined && timeMs !== undefined && timeMs < startMs)
			return false;
		if (endMs !== undefined && timeMs !== undefined && timeMs > endMs)
			return false;
		if (!filterFn) return true;

		const aliasRow = buildAliasedObject(row, fieldToAlias);
		try {
			return Boolean(filterFn({ ...row, ...aliasRow }));
		} catch {
			return false;
		}
	});

	let selectedRows = matchedRows;

	if (stepMs !== undefined) {
		let lastIncludedTime: number | undefined;
		selectedRows = selectedRows.filter((entry) => {
			if (entry.timeMs === undefined) return false;
			if (
				lastIncludedTime === undefined ||
				entry.timeMs - lastIncludedTime >= stepMs
			) {
				lastIncludedTime = entry.timeMs;
				return true;
			}
			return false;
		});
	}

	const frontmatter = toYamlFrontmatter({
		file,
		resolved_path: logPath,
		outside_logs_dir: outsideLogsDir,
		rows_returned: selectedRows.length,
		time_range_s:
			selectedRows.length > 0 && timeColumnName
				? [
						Number(toSeconds(selectedRows[0]?.timeMs ?? 0).toFixed(3)),
						Number(
							toSeconds(
								selectedRows[selectedRows.length - 1]?.timeMs ?? 0,
							).toFixed(3),
						),
					]
				: null,
		time_column: timeColumnName,
		time_unit: timeUnit,
		channels: selectedChannels,
		where: where ?? null,
		referenced_fields: referencedFields,
	});

	if (selectedRows.length === 0) {
		return `${frontmatter}\n${warningNote ? `${warningNote}\n\n` : ""}(No rows matched the requested log slice)`;
	}

	const headers = timeColumnName
		? ["Time (s)", ...selectedChannels]
		: [...selectedChannels];
	const markdownRows = selectedRows.map(({ row, timeMs }) => {
		const cells: string[] = [];
		if (timeColumnName) {
			cells.push(timeMs !== undefined ? toSeconds(timeMs).toFixed(2) : "");
		}
		for (const channel of selectedChannels) {
			cells.push(formatLogValue(row[channel]));
		}
		return cells;
	});

	return `${frontmatter}\n${warningNote ? `${warningNote}\n\n` : ""}${buildMarkdownTable(headers, markdownRows)}`;
}
