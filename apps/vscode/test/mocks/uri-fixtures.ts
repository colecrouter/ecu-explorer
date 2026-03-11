import * as vscode from "vscode";
import type { TableUri as FileTableUri } from "../../src/table-fs-uri.js";
import type { TableUri as EditorTableUri } from "../../src/table-uri.js";

export const STANDARD_EDITOR_TABLE_URI = {
	romPath: "/path/to/rom.hex",
	tableId: "table1",
} satisfies EditorTableUri;

export const EDITOR_TABLE_URI_WITH_DEFINITION = {
	romPath: "/path/to/rom.hex",
	tableId: "table1",
	definitionUri: "file:///def.xml",
} satisfies EditorTableUri;

export const COMPLEX_EDITOR_TABLE_URI = {
	romPath: "/path/with spaces/and-special!@#$%/rom (v2).hex",
	tableId: "Fuel Map (Primary) [High Load]",
	definitionUri: "file:///defs/evo10 (2011).xml",
} satisfies EditorTableUri;

export const STANDARD_FS_TABLE_URI = {
	romPath: "/Users/test/rom.hex",
	tableId: "fuel-map-id",
	tableName: "Fuel Map",
} satisfies FileTableUri;

export const WINDOWS_FS_TABLE_URI = {
	romPath: "E:\\ROM\\test.hex",
	tableId: "fuel-map-id",
	tableName: "Fuel Map",
} satisfies FileTableUri;

export const RESOLVED_DEFINITION_FS_TABLE_URI = {
	romPath: "/Users/test/rom.hex",
	tableId: "fuel-map-id",
	tableName: "Fuel Map",
	definitionUri: "file:///defs/resolved.xml",
} satisfies FileTableUri;

export function normalizePath(path: string): string {
	return path.replace(/\\/g, "/");
}

export function createWorkspaceFolder(
	fsPath: string = "/workspace",
	name: string = "workspace",
): vscode.WorkspaceFolder {
	return {
		uri: vscode.Uri.file(fsPath),
		name,
		index: 0,
	} satisfies vscode.WorkspaceFolder;
}
