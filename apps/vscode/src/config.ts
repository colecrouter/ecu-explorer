import * as vscode from "vscode";

/** Known definition provider identifiers */
export type ProviderId = "ecuflash";

/**
 * Typed representation of all ecuExplorer.* workspace settings.
 * Mirrors the contributes.configuration schema in package.json.
 */
export interface EcuExplorerConfig {
	definitions: {
		/** Additional folders to search for ROM definition files (any provider) */
		paths: string[];
		ecuflash: {
			/** Additional folders to search specifically for ECUFlash XML definition files */
			paths: string[];
		};
	};
	providers: {
		/** Which definition providers are active. Default: ["ecuflash"] */
		enabled: ProviderId[];
	};
	/** Folder where live data CSV logs are saved. Default: "logs" */
	logsFolder: string;
	logging: {
		/** Which PID columns to include in CSV logs. "all" or array of PID names. Default: "all" */
		columns: string[] | "all";
		configurationPaths: string[];
		units: "metric" | "original";
	};
}

/**
 * Reads all ecuExplorer.* settings from the VSCode workspace configuration
 * and returns them as a typed EcuExplorerConfig object.
 */
export function readConfig(resource?: vscode.Uri): EcuExplorerConfig {
	const config = vscode.workspace.getConfiguration(
		"ecuExplorer",
		resource ?? vscode.workspace.workspaceFolders?.[0]?.uri ?? null,
	);
	return {
		definitions: {
			paths: config.get<string[]>("definitions.paths", []),
			ecuflash: {
				paths: config.get<string[]>("definitions.ecuflash.paths", []),
			},
		},
		providers: {
			enabled: config.get<ProviderId[]>("providers.enabled", ["ecuflash"]),
		},
		logsFolder: config.get<string>("logsFolder", "logs"),
		logging: {
			configurationPaths: config.get<string[]>("logging.configurationPaths", [
				"DataSettings",
			]),
			units: config.get<"metric" | "original">("logging.units", "metric"),
			columns: config.get<string[] | "all">("logging.columns", "all"),
		},
	};
}
