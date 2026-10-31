import type { DefinitionProvider } from "@ecu-explorer/core";
import * as vscode from "vscode";
import type { DeviceManagerImpl } from "../device-manager.js";
import type { LiveDataPanelManager } from "../live-data-panel-manager.js";
import type { LoggingManager } from "../logging-manager.js";
import { captureRomSnapshot } from "../rom/comparison.js";
import { resolveRomDefinition } from "../rom/definition-resolver.js";
import type { RomDocument } from "../rom/document.js";
import { readEcuRomSnapshot } from "../rom/ecu-snapshot.js";
import { showRomDiff } from "../rom-diff-panel.js";
import type { WorkspaceState } from "../workspace-state.js";
import {
	RomComparisonController,
	type RomComparisonMode,
} from "./compare-roms.js";

interface RomComparisonServices {
	registry: { list(): DefinitionProvider[] };
	workspaceState: WorkspaceState;
	deviceManager: DeviceManagerImpl;
	liveData: LiveDataPanelManager;
	logging: LoggingManager;
	getActiveDocument(): RomDocument | undefined;
}

export function registerRomComparisonCommands(
	context: vscode.ExtensionContext,
	services: RomComparisonServices,
): void {
	const label = (uri: vscode.Uri) => uri.path.split("/").pop() ?? uri.fsPath;
	const controller = new RomComparisonController({
		selectSaved: async (title) => {
			const selected = await vscode.window.showOpenDialog({
				title,
				openLabel: "Use ROM",
				canSelectMany: false,
				filters: { "ROM files": ["bin", "rom", "hex"] },
			});
			const uri = selected?.[0];
			if (!uri) return;
			// Always read disk for a saved source, even if this file has an unsaved editor.
			const bytes = await vscode.workspace.fs.readFile(uri);
			const definition = await resolveRomDefinition(
				uri,
				bytes,
				services.registry,
				services.workspaceState,
			);
			return definition
				? captureRomSnapshot(uri, bytes, definition, label(uri))
				: undefined;
		},
		getActive: () => {
			const document = services.getActiveDocument();
			if (!document?.definition) return;
			return captureRomSnapshot(
				document.uri,
				document.romBytes,
				document.definition,
				`${label(document.uri)} (active${document.isDirty ? ", unsaved" : ""})`,
			);
		},
		readEcu: async () => {
			const active =
				services.deviceManager.activeConnection ??
				(await services.deviceManager.connect());
			const { protocol, connection } = active;
			if (!protocol.readRom)
				throw new Error(
					`Protocol "${protocol.name}" does not support ROM reading.`,
				);
			const root =
				vscode.workspace.workspaceFolders?.[0]?.uri ?? context.globalStorageUri;
			const captured = await readEcuRomSnapshot({
				directory: vscode.Uri.joinPath(root, "ECU Snapshots"),
				read: (progress) => {
					if (!protocol.readRom) throw new Error("ROM reading is unavailable.");
					return protocol.readRom(connection, progress);
				},
				suspend: async () => {
					const wasRecording = services.logging.loggingState === "recording";
					if (wasRecording) services.logging.pauseLog();
					let resume: () => void;
					try {
						resume = await services.liveData.suspendForRomRead();
					} catch (error) {
						if (wasRecording && services.logging.loggingState === "paused")
							services.logging.resumeLog();
						throw error;
					}
					return () => {
						resume();
						if (wasRecording && services.logging.loggingState === "paused")
							services.logging.resumeLog();
					};
				},
			});
			const definition = await resolveRomDefinition(
				captured.uri,
				captured.bytes,
				services.registry,
				services.workspaceState,
			);
			if (!definition) return;
			const snapshot = captureRomSnapshot(
				captured.uri,
				captured.bytes,
				definition,
				`ECU · ${active.deviceName}`,
			);
			snapshot.capturedAt = captured.capturedAt;
			return snapshot;
		},
		show: (base, target) => showRomDiff(context, base, target),
	});
	const commands: [string, RomComparisonMode][] = [
		["ecuExplorer.compareSavedRoms", "saved-saved"],
		["ecuExplorer.compareActiveRomWithSaved", "active-saved"],
		["ecuExplorer.compareSavedRomWithEcu", "saved-ecu"],
		["ecuExplorer.compareActiveRomWithEcu", "active-ecu"],
	];
	for (const [id, mode] of commands)
		context.subscriptions.push(
			vscode.commands.registerCommand(id, async () => {
				try {
					await controller.compare(mode);
				} catch (error) {
					if (error instanceof vscode.CancellationError) return;
					void vscode.window.showErrorMessage(
						`ROM comparison failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}),
		);
}
