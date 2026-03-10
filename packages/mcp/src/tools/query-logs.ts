/**
 * Compatibility wrapper for the legacy query_logs MCP tool.
 *
 * New code should use read_log instead.
 */

import type { McpConfig } from "../config.js";
import { handleReadLog } from "./read-log.js";

/**
 * Legacy query_logs compatibility handler.
 */
export async function handleQueryLogs(
	options: {
		filter: string;
		channels?: string[];
		file?: string;
		sampleRate?: number;
	},
	config: McpConfig,
): Promise<string> {
	if (options.file === undefined) {
		throw new Error(
			"`query_logs` is deprecated and now requires `file`. Use `list_logs` to discover files, then `read_log(file)` to inspect one log.",
		);
	}

	const readLogOptions: Parameters<typeof handleReadLog>[0] = {
		file: options.file,
		where: options.filter,
	};
	if (options.channels !== undefined) {
		readLogOptions.channels = options.channels;
	}
	if (options.sampleRate !== undefined && options.sampleRate > 0) {
		readLogOptions.stepMs = Math.round(1000 / options.sampleRate);
	}

	return handleReadLog(
		readLogOptions,
		config,
	);
}
