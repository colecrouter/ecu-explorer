import * as vscode from "vscode";
import { buildRomComparison, type RomSnapshot } from "./rom/comparison.js";
import type {
	DiffSourceInfo,
	DiffTableDetail,
	DiffWebviewMessage,
} from "./rom-diff-protocol.js";
import { romDiffStyles } from "./rom-diff-styles.js";

export function showRomDiff(
	context: vscode.ExtensionContext,
	base: RomSnapshot,
	target: RomSnapshot,
): void {
	const comparison = buildRomComparison(base, target);
	const panel = vscode.window.createWebviewPanel(
		"ecuExplorerRomDiff",
		`ROM Diff: ${base.label} → ${target.label}`,
		vscode.ViewColumn.Active,
		{
			enableScripts: true,
			retainContextWhenHidden: true,
			localResourceRoots: [
				vscode.Uri.joinPath(context.extensionUri, "dist", "webview"),
			],
		},
	);
	const source = (rom: RomSnapshot): DiffSourceInfo => ({
		label: rom.label,
		path: rom.uri.fsPath,
		definition: rom.definition.name,
		capturedAt: rom.capturedAt,
	});
	const summaries = comparison.tables.map((table, index) => ({
		index,
		name: table.name,
		category: table.category,
		status: table.status,
		cellsChanged: table.metrics?.cellsChanged ?? 0,
	}));
	const subscription = panel.webview.onDidReceiveMessage(
		(message: DiffWebviewMessage | undefined) => {
			if (message?.type === "ready") {
				void panel.webview.postMessage({
					type: "summary",
					base: source(base),
					target: source(target),
					definitionsDiffer: base.definition.uri !== target.definition.uri,
					tables: summaries,
				});
			} else if (
				message?.type === "selectTable" &&
				Number.isInteger(message.index)
			) {
				const table = comparison.tables[message.index];
				const summary = summaries[message.index];
				if (!table || !summary) return;
				const grid = (snapshot: typeof table.baseSnapshot) =>
					snapshot && {
						is1D: snapshot.definition.kind === "table1d",
						rows: snapshot.rows,
						cols: snapshot.cols,
						values: snapshot.values,
						xAxisValues: snapshot.xAxisValues,
						yAxisValues: snapshot.yAxisValues,
					};
				const detail: DiffTableDetail = {
					...summary,
					unit: table.unit,
					xAxisChanged: table.xAxisChanged ?? false,
					yAxisChanged: table.yAxisChanged ?? false,
				};
				const left = grid(table.baseSnapshot),
					right = grid(table.targetSnapshot);
				if (left) detail.base = left;
				if (right) detail.target = right;
				if (table.incompatibilityReason)
					detail.reason = table.incompatibilityReason;
				void panel.webview.postMessage({ type: "detail", detail });
			}
		},
	);
	panel.onDidDispose(() => subscription.dispose());
	context.subscriptions.push(panel);
	const script = panel.webview.asWebviewUri(
		vscode.Uri.joinPath(context.extensionUri, "dist", "webview", "rom-diff.js"),
	);
	const nonce = globalThis.crypto.randomUUID();
	panel.webview.html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src ${panel.webview.cspSource} 'nonce-${nonce}'; style-src 'nonce-${nonce}';"><title>ROM comparison</title><style nonce="${nonce}">${romDiffStyles}</style></head><body><div id="app"></div><script nonce="${nonce}" type="module" src="${script}"></script></body></html>`;
}
