import type { PidDescriptor } from "@ecu-explorer/device";
import * as vscode from "vscode";

export type LoggingConfigurationLike = Pick<
	vscode.WorkspaceConfiguration,
	"get" | "has" | "inspect" | "update"
>;

const DEFAULT_WORKSPACE_FOLDER = {
	uri: vscode.Uri.file("/workspace"),
	name: "workspace",
	index: 0,
} satisfies vscode.WorkspaceFolder;

const SAMPLE_PIDS = [
	{
		pid: 0x0c,
		name: "Engine RPM",
		unit: "rpm",
		minValue: 0,
		maxValue: 16383,
	},
	{
		pid: 0x05,
		name: "Coolant Temp",
		unit: "\u00b0C",
		minValue: -40,
		maxValue: 215,
	},
	{
		pid: 0x11,
		name: "Throttle Position",
		unit: "%",
		minValue: 0,
		maxValue: 100,
	},
] satisfies [PidDescriptor, PidDescriptor, PidDescriptor];

export function createWorkspaceFolders() {
	return [{ ...DEFAULT_WORKSPACE_FOLDER }];
}

export function createLoggingConfiguration(
	logsFolder: string,
	columns: string[] | "all" = "all",
) {
	return {
		get: (key: string) => {
			if (key === "logsFolder") return logsFolder;
			if (key === "logging.columns") return columns;
			return undefined;
		},
		has: () => true,
		inspect: () => undefined,
		update: async () => {},
	} satisfies LoggingConfigurationLike;
}

export function createSamplePids() {
	const [engineRpm, coolantTemp, throttlePosition] = SAMPLE_PIDS;
	return [
		{ ...engineRpm },
		{ ...coolantTemp },
		{ ...throttlePosition },
	] as const;
}
