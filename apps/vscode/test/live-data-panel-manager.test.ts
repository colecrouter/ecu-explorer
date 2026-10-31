/**
 * Unit tests for LiveDataPanelManager
 *
 * Tests panel creation, lifecycle, PID selection, data streaming, and CSV recording.
 */

import type { LiveDataFrame } from "@ecu-explorer/device";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import type { DeviceManagerImpl } from "../src/device-manager.js";
import { LiveDataPanelManager } from "../src/live-data-panel-manager.js";
import {
	createLiveDataConnection,
	createLiveDataFrame,
	createLiveDataPids,
	createLiveDataProfiles,
	createLiveDataProtocol,
	createLiveDataSession,
} from "./mocks/live-data-fixtures.js";
import { createExtensionContext } from "./mocks/vscode-harness.js";
import type {
	GraphCompatibleWebviewPanel,
	MockWebviewMessage,
} from "./mocks/webview-mock.js";
import { createMockWebviewPanel } from "./mocks/webview-mock.js";

// Mock interface for testing - only includes methods actually used by LiveDataPanelManager
interface MockDeviceManager {
	selectDeviceAndProtocol: typeof mockSelectDeviceAndProtocol;
}

type DeviceManagerLike = Pick<DeviceManagerImpl, "selectDeviceAndProtocol">;

function asWebviewPanel(
	panel: GraphCompatibleWebviewPanel,
): vscode.WebviewPanel {
	return panel as vscode.WebviewPanel;
}

function asDeviceManager(deviceManager: DeviceManagerLike): DeviceManagerImpl {
	return deviceManager as DeviceManagerImpl;
}

// Mock the DeviceManagerImpl
const mockSelectDeviceAndProtocol = vi.fn();
const mockDeviceManager: MockDeviceManager = {
	selectDeviceAndProtocol: mockSelectDeviceAndProtocol,
};

describe("LiveDataPanelManager", () => {
	let manager: LiveDataPanelManager;
	let mockPanel: GraphCompatibleWebviewPanel;
	let mockContext: Pick<
		vscode.ExtensionContext,
		"subscriptions" | "extensionUri"
	>;
	const waitForPanelWork = () =>
		new Promise((resolve) => setTimeout(resolve, 50));

	async function showReadyPanel({
		connection = createLiveDataConnection(),
		protocol = createLiveDataProtocol(),
	}: {
		connection?: ReturnType<typeof createLiveDataConnection>;
		protocol?: ReturnType<typeof createLiveDataProtocol>;
	} = {}) {
		mockSelectDeviceAndProtocol.mockResolvedValue({
			connection,
			protocol,
		});

		await manager.showPanel();
		mockPanel.webview._simulateMessage({ type: "ready" });
		await waitForPanelWork();

		return { connection, protocol };
	}

	beforeEach(() => {
		mockPanel = createMockWebviewPanel("Live Data");

		vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
			asWebviewPanel(mockPanel),
		);

		// Mock writeFile to prevent actual filesystem access
		vi.mocked(vscode.workspace.fs.writeFile).mockResolvedValue(undefined);

		mockContext = createExtensionContext();

		manager = new LiveDataPanelManager(
			mockContext as vscode.ExtensionContext,
			asDeviceManager(mockDeviceManager),
		);
	});

	describe("showPanel", () => {
		it("should create a new webview panel", async () => {
			await manager.showPanel();

			expect(vscode.window.createWebviewPanel).toHaveBeenCalledWith(
				"ecuExplorerLiveData",
				"Live Data",
				vscode.ViewColumn.One,
				expect.objectContaining({
					enableScripts: true,
					retainContextWhenHidden: true,
				}),
			);
		});

		it("should set HTML content on the panel", async () => {
			await manager.showPanel();

			expect(mockPanel.webview.html).toContain("<!DOCTYPE html>");
			expect(mockPanel.webview.html).toContain("live-data.js");
		});

		it("should reveal existing panel if already open", async () => {
			await manager.showPanel();
			await manager.showPanel();

			// Should only create one panel
			expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(1);
			expect(mockPanel.reveal).toHaveBeenCalledTimes(1);
		});
	});

	describe("message handling", () => {
		it("should handle ready message and call selectDeviceAndProtocol", async () => {
			const [engineRpmPid] = createLiveDataPids();
			await showReadyPanel({
				protocol: createLiveDataProtocol({
					supportedPids: [engineRpmPid],
				}),
			});

			expect(mockSelectDeviceAndProtocol).toHaveBeenCalled();
		});

		it("should send supportedPids message when protocol has getSupportedPids", async () => {
			const mockPids = createLiveDataPids();
			await showReadyPanel({
				protocol: createLiveDataProtocol({
					supportedPids: mockPids,
				}),
			});

			const messages = mockPanel.webview._getSentMessages();
			const supportedPidsMsg = messages.find(
				(m: MockWebviewMessage) => m.type === "supportedPids",
			);
			expect(supportedPidsMsg).toBeDefined();
			expect(
				(supportedPidsMsg as MockWebviewMessage & { pids: typeof mockPids })
					.pids,
			).toEqual(mockPids);
		});

		it("should show error message when selectDeviceAndProtocol fails", async () => {
			mockSelectDeviceAndProtocol.mockRejectedValue(
				new Error("No device found"),
			);

			await manager.showPanel();
			mockPanel.webview._simulateMessage({ type: "ready" });

			await waitForPanelWork();

			expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
				expect.stringContaining("No device found"),
			);
		});

		it("should start streaming when startStreaming message is received", async () => {
			const mockSession = createLiveDataSession();
			const { connection: mockConnection, protocol: mockProtocol } =
				await showReadyPanel({
					connection: createLiveDataConnection(),
					protocol: createLiveDataProtocol({
						session: mockSession,
					}),
				});

			mockPanel.webview._simulateMessage({
				type: "startStreaming",
				pids: [0x0c, 0x0d],
				record: false,
			});

			await waitForPanelWork();

			expect(mockProtocol.streamLiveData).toHaveBeenCalledWith(
				mockConnection,
				{ pids: [0x0c, 0x0d] },
				expect.any(Function),
				expect.any(Function),
			);

			const messages = mockPanel.webview._getSentMessages();
			const streamingStartedMsg = messages.find(
				(m: MockWebviewMessage) => m.type === "streamingStarted",
			);
			expect(streamingStartedMsg).toBeDefined();
		});

		it("should send supportedProfiles when protocol exposes profile metadata", async () => {
			const profiles = createLiveDataProfiles();
			await showReadyPanel({
				protocol: createLiveDataProtocol({
					profiles,
				}),
			});

			const messages = mockPanel.webview._getSentMessages();
			const supportedProfilesMsg = messages.find(
				(m: MockWebviewMessage) => m.type === "supportedProfiles",
			);
			expect(supportedProfilesMsg).toBeDefined();
			expect(
				(
					supportedProfilesMsg as MockWebviewMessage & {
						profiles: typeof profiles;
						selectedProfileId: string;
					}
				).profiles,
			).toEqual(profiles);
			expect(
				(
					supportedProfilesMsg as MockWebviewMessage & {
						profiles: typeof profiles;
						selectedProfileId: string;
					}
				).selectedProfileId,
			).toBe("test-ready");
		});

		it("passes through selected profile id when streaming starts", async () => {
			const profiles = createLiveDataProfiles();
			const { connection: mockConnection, protocol: mockProtocol } =
				await showReadyPanel({
					connection: createLiveDataConnection(),
					protocol: createLiveDataProtocol({
						profiles,
					}),
				});

			mockPanel.webview._simulateMessage({
				type: "startStreaming",
				pids: [0x0c],
				profileId: "test-ready",
			});
			await waitForPanelWork();

			expect(mockProtocol.streamLiveData).toHaveBeenCalledWith(
				mockConnection,
				{ pids: [0x0c], profileId: "test-ready" },
				expect.any(Function),
				expect.any(Function),
			);
		});

		it("should expose active logging PIDs for the selected profile stream", async () => {
			const [, vehicleSpeedPid] = createLiveDataPids();
			const profilePid = {
				pid: 0x8000,
				name: "Profile RPM",
				unit: "rpm",
				minValue: 0,
				maxValue: 9000,
			};
			await showReadyPanel({
				protocol: createLiveDataProtocol({
					profiles: createLiveDataProfiles([
						{ pids: [profilePid, vehicleSpeedPid] },
					]),
				}),
			});

			mockPanel.webview._simulateMessage({
				type: "startStreaming",
				pids: [profilePid.pid],
				profileId: "test-ready",
				record: false,
			});
			await waitForPanelWork();

			expect(manager.getActiveLoggingPids()).toEqual([profilePid]);
		});

		it("should stop streaming when stopStreaming message is received", async () => {
			const mockSession = createLiveDataSession();
			await showReadyPanel({
				protocol: createLiveDataProtocol({
					session: mockSession,
				}),
			});

			mockPanel.webview._simulateMessage({
				type: "startStreaming",
				pids: [0x0c],
				record: false,
			});
			await waitForPanelWork();

			mockPanel.webview._simulateMessage({
				type: "stopStreaming",
			});
			await waitForPanelWork();

			expect(mockSession.stop).toHaveBeenCalled();

			const messages = mockPanel.webview._getSentMessages();
			const streamingStoppedMsg = messages.find(
				(m: MockWebviewMessage) => m.type === "streamingStopped",
			);
			expect(streamingStoppedMsg).toBeDefined();
		});

		it("should clear active logging PIDs when streaming stops", async () => {
			const [engineRpmPid] = createLiveDataPids();
			await showReadyPanel({
				protocol: createLiveDataProtocol({
					supportedPids: createLiveDataPids(),
				}),
			});

			mockPanel.webview._simulateMessage({
				type: "startStreaming",
				pids: [engineRpmPid.pid],
				record: false,
			});
			await waitForPanelWork();
			expect(manager.getActiveLoggingPids()).toEqual([engineRpmPid]);

			mockPanel.webview._simulateMessage({
				type: "stopStreaming",
			});
			await waitForPanelWork();

			expect(manager.getActiveLoggingPids()).toBeUndefined();
		});
	});

	describe("CSV recording (deprecated — record field is now ignored)", () => {
		it("should NOT write CSV file when record:true is sent (record field is deprecated)", async () => {
			let capturedOnFrame: ((frame: LiveDataFrame) => void) | undefined;
			const mockSession = createLiveDataSession();
			await showReadyPanel({
				protocol: createLiveDataProtocol({
					session: mockSession,
					onStreamStart: (onFrame) => {
						capturedOnFrame = onFrame;
					},
				}),
			});

			// Mock workspace folders
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
				{ uri: vscode.Uri.file("/workspace"), name: "workspace", index: 0 },
			] as readonly vscode.WorkspaceFolder[] | undefined);

			mockPanel.webview._simulateMessage({
				type: "startStreaming",
				pids: [0x0c],
				record: true, // deprecated — should be ignored
			});
			await waitForPanelWork();

			// Simulate receiving a frame
			capturedOnFrame?.(createLiveDataFrame());

			mockPanel.webview._simulateMessage({ type: "stopStreaming" });
			await waitForPanelWork();

			// CSV should NOT be written by the panel — logging is now handled by LoggingManager
			expect(vscode.workspace.fs.writeFile).not.toHaveBeenCalled();
		});

		it("should still stream data even without a workspace folder (record field is ignored)", async () => {
			const mockProtocol = createLiveDataProtocol({
				session: createLiveDataSession(),
			});

			// No workspace folders
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue(
				undefined,
			);

			await showReadyPanel({
				protocol: mockProtocol,
			});

			mockPanel.webview._simulateMessage({
				type: "startStreaming",
				pids: [0x0c],
				record: true, // deprecated — should be ignored
			});
			await waitForPanelWork();

			// Streaming should still start (no error about workspace folder)
			expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
			expect(mockProtocol.streamLiveData).toHaveBeenCalled();
		});
	});

	describe("onFrame event", () => {
		it("should fire onFrame event for each received frame", async () => {
			let capturedOnFrame: ((frame: LiveDataFrame) => void) | undefined;
			await showReadyPanel({
				protocol: createLiveDataProtocol({
					session: createLiveDataSession(),
					onStreamStart: (onFrame) => {
						capturedOnFrame = onFrame;
					},
				}),
			});

			mockPanel.webview._simulateMessage({
				type: "startStreaming",
				pids: [0x0c],
				record: false,
			});
			await waitForPanelWork();

			const receivedFrames: LiveDataFrame[] = [];
			manager.onFrame((frame: LiveDataFrame) => receivedFrames.push(frame));

			const testFrame = createLiveDataFrame();
			capturedOnFrame?.(testFrame);

			expect(receivedFrames).toHaveLength(1);
			expect(receivedFrames[0]).toEqual(testFrame);
		});
	});

	describe("panel lifecycle", () => {
		it("should clean up when panel is disposed", async () => {
			const mockSession = createLiveDataSession();
			await showReadyPanel({
				protocol: createLiveDataProtocol({
					session: mockSession,
				}),
			});

			mockPanel.webview._simulateMessage({
				type: "startStreaming",
				pids: [0x0c],
				record: false,
			});
			await waitForPanelWork();

			// Dispose the panel
			mockPanel.dispose();
			await waitForPanelWork();

			// Session should be stopped
			expect(mockSession.stop).toHaveBeenCalled();

			// Creating a new panel should work (panel reference was cleared)
			await manager.showPanel();
			expect(vscode.window.createWebviewPanel).toHaveBeenCalledTimes(2);
		});
	});
});
