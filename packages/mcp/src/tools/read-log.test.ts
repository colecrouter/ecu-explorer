import { mkdtemp, writeFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as logReader from "../log-reader.js";
import { handleReadLog } from "./read-log.js";
import { handleQueryLogs } from "./query-logs.js";
import type { McpConfig } from "../config.js";

vi.mock("../log-reader.js", async () => {
	const actual = await vi.importActual<typeof import("../log-reader.js")>(
		"../log-reader.js",
	);
	return {
		...actual,
		readLogFileMeta: vi.fn(),
		parseLogFileRows: vi.fn(),
	};
});

const baseConfig = {
	definitionsPaths: [],
};

describe("handleReadLog", () => {
	let config: McpConfig;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	it("returns schema/details when only file is provided", async () => {
		const tempDir = await mkdtemp(
			path.join(os.tmpdir(), "ecu-mcp-read-log-schema-"),
		);
		const target = path.join(tempDir, "session.csv");
		await writeFile(target, "");

		config = {
			...baseConfig,
			logsDir: tempDir,
		};

		vi.mocked(logReader.readLogFileMeta).mockResolvedValue({
			filePath: target,
			fileName: "session.csv",
			fileSizeBytes: 1024,
			mtime: new Date("2026-03-10T00:00:00.000Z"),
			channels: ["Engine RPM", "Knock Sum"],
			units: ["rpm", "count"],
			rowCount: 42,
			durationMs: 4100,
			sampleRateHz: 10,
		});
		vi.mocked(logReader.parseLogFileRows).mockResolvedValue({
			headers: ["Timestamp (ms)", "Engine RPM", "Knock Sum"],
			timeColumnName: "Timestamp (ms)",
			sampleRateHz: 10,
			rows: [],
		});

		const result = await handleReadLog({ file: "session.csv" }, config);
		await rm(tempDir, { recursive: true, force: true });

		expect(result).toContain("time_column: Timestamp (ms)");
		expect(result).toContain("channels:");
		expect(result).toContain("Engine RPM");
		expect(result).toContain("Knock Sum");
		expect(result).toContain("| Channel");
		expect(result).toContain("| Engine RPM | rpm");
	});

	it("supports spaced channel names in where expressions", async () => {
		const tempDir = await mkdtemp(path.join(os.tmpdir(), "ecu-mcp-read-log-"));
		const target = path.join(tempDir, "session.csv");
		await writeFile(target, "");

		config = {
			...baseConfig,
			logsDir: tempDir,
		};

		vi.mocked(logReader.readLogFileMeta).mockResolvedValue({
			filePath: target,
			fileName: "session.csv",
			fileSizeBytes: 1,
			mtime: new Date("2026-03-10T00:00:00.000Z"),
			channels: ["Engine Temp", "Coolant Temp"],
			units: ["C", "C"],
			rowCount: 3,
			durationMs: 200,
			sampleRateHz: 10,
		});
		vi.mocked(logReader.parseLogFileRows).mockResolvedValue({
			headers: ["Timestamp (ms)", "Engine Temp", "Coolant Temp"],
			timeColumnName: "Timestamp (ms)",
			sampleRateHz: 10,
			rows: [
				{ "Timestamp (ms)": 0, "Engine Temp": 120, "Coolant Temp": 95 },
				{ "Timestamp (ms)": 100, "Engine Temp": 105, "Coolant Temp": 85 },
				{ "Timestamp (ms)": 200, "Engine Temp": 80, "Coolant Temp": 70 },
			],
		});

		const result = await handleReadLog(
			{
				file: "session.csv",
				where: "Engine Temp > 100 && Coolant Temp > 90",
			},
			config,
		);

		await rm(tempDir, { recursive: true, force: true });

		expect(result).toContain("rows_returned: 1");
		expect(result).toContain("| Time (s) |");
		expect(result).toContain("Engine Temp");
		expect(result).toContain("Coolant Temp");
		expect(result).toContain("0.00");
		expect(result).toContain("120");
		expect(result).toContain("95");
	});
});

describe("handleQueryLogs compatibility alias", () => {
	it("requires file and directs callers to read_log", async () => {
		await expect(
			handleQueryLogs(
				{
					filter: "Engine RPM > 10",
				},
				{
					definitionsPaths: [],
					logsDir: "/tmp/logs",
				},
			),
		).rejects.toThrow("`query_logs` is deprecated");
	});
});
