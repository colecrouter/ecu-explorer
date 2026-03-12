import type { TableDefinition } from "@ecu-explorer/core";
import * as vscode from "vscode";
import type { RomDocument } from "../rom/document.js";
import { UndoRedoManager } from "../undo-redo-manager.js";
import { VsCodeHistoryExecutor } from "./vscode-history-executor.js";

export type TableSessionId = string;

export function createTableSessionId(
	tableUri: vscode.Uri | string,
): TableSessionId {
	return typeof tableUri === "string" ? tableUri : tableUri.toString();
}

export interface TableEditSessionOptions {
	id: TableSessionId;
	tableUri: vscode.Uri;
	tableDef: TableDefinition;
	romDocument: RomDocument;
	panel?: vscode.WebviewPanel | null;
}

export class TableEditSession {
	readonly id: TableSessionId;
	readonly tableUri: vscode.Uri;
	readonly tableDef: TableDefinition;
	readonly romDocument: RomDocument;
	readonly undoRedoManager = new UndoRedoManager();

	private panel: vscode.WebviewPanel | null;

	constructor(options: TableEditSessionOptions) {
		this.id = options.id;
		this.tableUri = options.tableUri;
		this.tableDef = options.tableDef;
		this.romDocument = options.romDocument;
		this.panel = options.panel ?? null;
	}

	get activePanel(): vscode.WebviewPanel | null {
		return this.panel;
	}

	setPanel(panel: vscode.WebviewPanel | null): void {
		this.panel = panel;
	}

	clearPanel(panel?: vscode.WebviewPanel): void {
		if (!panel || this.panel === panel) {
			this.panel = null;
		}
	}

	markSaved(): void {
		this.undoRedoManager.markSavePoint();
	}

	createExecutor(): VsCodeHistoryExecutor {
		return new VsCodeHistoryExecutor(
			this.romDocument.romBytes,
			this.romDocument,
		);
	}

	isForRom(romDocument: RomDocument): boolean {
		return this.romDocument === romDocument;
	}
}
