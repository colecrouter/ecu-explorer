import type { DefinitionProvider, ROMDefinition } from "@ecu-explorer/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { registerRomComparisonCommands } from "../src/commands/rom-comparison-commands.js";
import { DeviceManagerImpl } from "../src/device-manager.js";
import { LiveDataPanelManager } from "../src/live-data-panel-manager.js";
import { LoggingManager } from "../src/logging-manager.js";
import { captureRomSnapshot } from "../src/rom/comparison.js";
import { RomDocument } from "../src/rom/document.js";
import { showRomDiff } from "../src/rom-diff-panel.js";
import { WorkspaceState } from "../src/workspace-state.js";
import { createExtensionContext } from "./mocks/vscode-harness.js";
import { createMockWebviewPanel } from "./mocks/webview-mock.js";

const definition: ROMDefinition = {
	uri: "file:///defs/test.xml",
	name: "Test ECU",
	platform: {},
	fingerprints: [],
	tables: [
		{
			id: "fuel",
			name: "Fuel",
			kind: "table1d",
			rows: 1,
			z: {
				id: "fuel",
				name: "Fuel",
				address: 0,
				dtype: "u8",
				endianness: "be",
				length: 1,
			},
		},
	],
};

describe("ROM comparison commands", () => {
	it("preserves both infinity signs through the webview's JSON transport", () => {
		const context = createExtensionContext() as vscode.ExtensionContext;
		const infinite: ROMDefinition = {
			...definition,
			tables: definition.tables.map((table) => ({
				...table,
				z: {
					...table.z,
					transform: (raw) => (raw === 0 ? Infinity : -Infinity),
				},
			})),
		};
		const panel = createMockWebviewPanel("Infinite values");
		vi.spyOn(vscode.window, "createWebviewPanel").mockReturnValue(
			panel as vscode.WebviewPanel,
		);
		const uri = vscode.Uri.file("/ROMs/AFR.bin");
		showRomDiff(
			context,
			captureRomSnapshot(uri, Uint8Array.of(0), infinite, "Base"),
			captureRomSnapshot(uri, Uint8Array.of(1), infinite, "Target"),
		);
		panel.webview._simulateMessage({ type: "selectTable", index: 0 });
		const serialized = JSON.parse(
			JSON.stringify(panel.webview._getMessages()[0]),
		);
		expect(serialized).toMatchObject({
			type: "detail",
			detail: {
				status: "changed",
				cellsChanged: 1,
				base: { values: [["Infinity"]] },
				target: { values: [["-Infinity"]] },
			},
		});
	});

	afterEach(() => vi.restoreAllMocks());
	it("uses saved disk bytes and unsaved editor bytes, and serves table details without serializing definitions", async () => {
		const context = createExtensionContext() as vscode.ExtensionContext;
		const manager = new DeviceManagerImpl();
		const uri = vscode.Uri.file("/ROMs/active.bin");
		const active = new RomDocument(uri, Uint8Array.of(20), definition);
		active.makeDirty();
		const state = new WorkspaceState({
			get: vi.fn(),
			update: vi.fn(),
			keys: () => [],
		});
		state.saveRomDefinition(uri.fsPath, definition.uri);
		const provider: DefinitionProvider = {
			id: "ecuflash",
			label: "Test",
			canParseDefinitionUri: () => true,
			discoverDefinitionUris: async () => [],
			peek: async () => definition,
			parse: async () => definition,
		};
		const commands = new Map<string, (...args: unknown[]) => unknown>();
		vi.spyOn(vscode.commands, "registerCommand").mockImplementation(
			(id, handler) => {
				commands.set(id, handler);
				return new vscode.Disposable(() => {});
			},
		);
		const panel = createMockWebviewPanel("ROM comparison");
		const createPanel = vi
			.spyOn(vscode.window, "createWebviewPanel")
			.mockReturnValue(panel as vscode.WebviewPanel);
		vi.spyOn(vscode.window, "showOpenDialog").mockResolvedValue([uri]);
		vi.spyOn(vscode.workspace.fs, "readFile").mockResolvedValue(
			Uint8Array.of(10),
		);
		registerRomComparisonCommands(context, {
			registry: { list: () => [provider] },
			workspaceState: state,
			deviceManager: manager,
			liveData: new LiveDataPanelManager(context, manager),
			logging: new LoggingManager(),
			getActiveDocument: () => active,
		});
		await commands.get("ecuExplorer.compareActiveRomWithSaved")?.();
		expect(createPanel).toHaveBeenCalledOnce();
		panel.webview._simulateMessage({ type: "ready" });
		const summary = panel.webview
			._getMessages()
			.find((message) => message.type === "summary");
		expect(summary).toMatchObject({
			base: { label: "active.bin" },
			target: { label: "active.bin (active, unsaved)" },
			tables: [{ name: "Fuel", cellsChanged: 1 }],
		});
		panel.webview._simulateMessage({ type: "selectTable", index: 0 });
		const detail = panel.webview
			._getMessages()
			.find((message) => message.type === "detail");
		expect(detail).toMatchObject({
			detail: { base: { values: [[10]] }, target: { values: [[20]] } },
		});
		expect(JSON.stringify(detail)).not.toContain("definition");
		expect(panel.webview.html).toContain("rom-diff.js");
		expect(panel.webview.html).toContain("Content-Security-Policy");
		panel.webview._simulateMessage({ type: "selectTable", index: -1 });
		expect(panel.webview._getMessages()).toHaveLength(2);
	});
});
