import type { ROMDefinition } from "@ecu-explorer/core";
import type { McpConfig } from "../config.js";

export function createMcpConfig(
	overrides: Partial<McpConfig> = {},
): McpConfig {
	return {
		definitionsPaths: [],
		logsDir: "/tmp",
		...overrides,
	};
}

export function createRomLoaderResult(
	definition: ROMDefinition,
	romBytes: Uint8Array = new Uint8Array(16),
	overrides: Partial<{
		romPath: string;
		fileSizeBytes: number;
		mtime: number;
	}> = {},
) {
	return {
		romPath: overrides.romPath ?? "/tmp/sample.hex",
		romBytes,
		definition,
		fileSizeBytes: overrides.fileSizeBytes ?? romBytes.length,
		mtime: overrides.mtime ?? Date.now(),
	};
}

export function createLogFileMeta(
	overrides: Partial<{
		filePath: string;
		fileName: string;
		fileSizeBytes: number;
		mtime: Date;
		channels: string[];
		units: string[];
		rowCount: number;
		durationMs: number;
		sampleRateHz: number;
		timeUnit: "ms" | "s";
	}> = {},
) {
	return {
		filePath: overrides.filePath ?? "/tmp/logs/session.csv",
		fileName: overrides.fileName ?? "session.csv",
		fileSizeBytes: overrides.fileSizeBytes ?? 1,
		mtime: overrides.mtime ?? new Date("2026-03-10T00:00:00.000Z"),
		channels: overrides.channels ?? ["Engine RPM"],
		units: overrides.units ?? ["rpm"],
		rowCount: overrides.rowCount ?? 1,
		durationMs: overrides.durationMs ?? 0,
		sampleRateHz: overrides.sampleRateHz ?? 10,
		timeUnit: overrides.timeUnit ?? "ms",
	};
}

export function createParsedLogRows(
	overrides: Partial<{
		headers: string[];
		timeColumnName: string | null;
		timeUnit: "ms" | "s" | null;
		sampleRateHz: number | null;
		rows: Array<Record<string, number>>;
	}> = {},
) {
	return {
		headers: overrides.headers ?? ["Timestamp (ms)", "Engine RPM"],
		timeColumnName: overrides.timeColumnName ?? "Timestamp (ms)",
		timeUnit: overrides.timeUnit ?? "ms",
		sampleRateHz: overrides.sampleRateHz ?? 10,
		rows: overrides.rows ?? [],
	};
}
