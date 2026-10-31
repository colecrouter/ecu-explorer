/**
 * Unit tests for LiveDataPanelManager
 *
 * Tests panel creation, lifecycle, PID selection, data streaming, and CSV recording.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { LiveDataPanelManager } from "../src/live-data-panel-manager.js";
import {
	createLiveDataConnection,
	createLiveDataPids,
	createLiveDataProtocol,
	createLiveDataSession,
} from "./mocks/live-data-fixtures.js";
import { createExtensionContext } from "./mocks/vscode-harness.js";
import type { GraphCompatibleWebviewPanel } from "./mocks/webview-mock.js";
import { createMockWebviewPanel } from "./mocks/webview-mock.js";

describe("LiveDataPanelManager", () => {
	let manager: LiveDataPanelManager;
	let mockPanel: GraphCompatibleWebviewPanel;
	let mockContext: Pick<
		vscode.ExtensionContext,
		"subscriptions" | "extensionUri"
	>;

	it("drains the current request before resuming the selected stream after a ROM read", async () => {
		let settle!: () => void;
		const completion = new Promise<void>((resolve) => {
			settle = resolve;
		});
		const stop = vi.fn();
		const protocol = createLiveDataProtocol();
		if (!protocol.streamLiveData) throw new Error("Missing test stream");
		vi.mocked(protocol.streamLiveData).mockReturnValue({ stop, completion });
		const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
		const frames = vi.fn();
		const connection = createLiveDataConnection();
		const recording = manager.streamForLogging(
			connection,
			protocol,
			createLiveDataPids(),
			frames,
		);
		let drained = false;
		const pending = manager.suspendForRomRead().then((resume) => {
			drained = true;
			return resume;
		});
		await Promise.resolve();
		expect(stop).toHaveBeenCalledOnce();
		expect(drained).toBe(false);
		settle();
		const resume = await pending;
		clock.mockReturnValue(5000);
		resume();
		resume();
		vi.mocked(protocol.streamLiveData).mock.calls[1]?.[2]({
			timestamp: 0,
			pid: 0x0c,
			value: 0,
			unit: "rpm",
		});
		expect(frames).toHaveBeenCalledWith(
			expect.objectContaining({ timestamp: 4000 }),
		);
		clock.mockRestore();
		expect(protocol.streamLiveData).toHaveBeenCalledTimes(2);
		recording.stop();
		expect(stop).toHaveBeenCalledTimes(2);
	});

	it("stopping an older recording does not stop a replacement stream", () => {
		const protocol = createLiveDataProtocol();
		const connection = createLiveDataConnection();
		const oldRecording = manager.streamForLogging(
			connection,
			protocol,
			createLiveDataPids(),
			vi.fn(),
		);
		manager.stopStreaming();
		const replacement = manager.streamForLogging(
			connection,
			protocol,
			createLiveDataPids(),
			vi.fn(),
		);
		if (!protocol.streamLiveData) throw new Error("Missing test stream");
		const replacementSession = vi.mocked(protocol.streamLiveData).mock
			.results[1]?.value;
		if (!replacementSession) throw new Error("Missing replacement session");
		vi.mocked(replacementSession.stop).mockClear();
		oldRecording.stop();
		expect(replacementSession.stop).not.toHaveBeenCalled();
		replacement.stop();
		expect(replacementSession.stop).toHaveBeenCalledOnce();
	});

	it("does not restart streaming after a disconnect while a ROM read was paused", async () => {
		const protocol = createLiveDataProtocol();
		manager.streamForLogging(
			createLiveDataConnection(),
			protocol,
			createLiveDataPids(),
			vi.fn(),
		);
		const resume = await manager.suspendForRomRead();
		manager.stopStreaming();
		resume();
		expect(protocol.streamLiveData).toHaveBeenCalledOnce();
	});

	beforeEach(() => {
		mockPanel = createMockWebviewPanel("Live Data");
		vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
			mockPanel as vscode.WebviewPanel,
		);
		vi.mocked(vscode.workspace.fs.readDirectory).mockResolvedValue([
			["live-data-example.css", vscode.FileType.File],
		]);
		mockContext = createExtensionContext();
		manager = new LiveDataPanelManager(mockContext as vscode.ExtensionContext);
	});

	it("opens a themed monitor and sends the configured channels on ready", async () => {
		const pids = createLiveDataPids();
		await manager.applyConfiguration(
			createLiveDataConnection(),
			createLiveDataProtocol(),
			{
				protocolName: "Test Protocol",
				profileName: "Golden",
				profileId: "golden",
				pids: [pids[1]],
			},
			true,
		);
		await manager.showPanel();
		mockPanel.webview._simulateMessage({ type: "ready" });
		expect(mockPanel.webview.html).toContain("live-data-example.css");
		expect(mockPanel.webview._getMessages()).toContainEqual({
			type: "configuration",
			profileName: "Golden",
			pids: [pids[1]],
			recording: false,
		});
		expect(mockPanel.webview._getMessages()).toContainEqual({
			type: "streamingStarted",
		});
		await manager.showPanel();
		expect(mockPanel.reveal).toHaveBeenCalledOnce();
	});

	it("routes configuration and start buttons to the shared native commands", async () => {
		const execute = vi.spyOn(vscode.commands, "executeCommand");
		await manager.showPanel();
		mockPanel.webview._simulateMessage({ type: "changeConfiguration" });
		mockPanel.webview._simulateMessage({
			type: "startStreaming",
			pids: [0xffff],
		});
		expect(execute).toHaveBeenCalledWith(
			"ecuExplorer.changeLoggingConfiguration",
		);
		expect(execute).toHaveBeenCalledWith("ecuExplorer.startLiveData");
	});

	it("waits for the old request before applying a new profile", async () => {
		let settle!: () => void;
		const completion = new Promise<void>((resolve) => {
			settle = resolve;
		});
		const protocol = createLiveDataProtocol({
			session: { stop: vi.fn(), completion },
		});
		const connection = createLiveDataConnection();
		const pids = createLiveDataPids();
		await manager.applyConfiguration(
			connection,
			protocol,
			{ protocolName: protocol.name, profileName: "Old", pids: [pids[0]] },
			true,
		);
		const applying = manager.applyConfiguration(
			connection,
			protocol,
			{ protocolName: protocol.name, profileName: "New", pids: [pids[1]] },
			true,
		);
		await Promise.resolve();
		expect(protocol.streamLiveData).toHaveBeenCalledOnce();
		settle();
		await applying;
		expect(manager.getActiveLoggingPids()).toEqual([pids[1]]);
		expect(protocol.streamLiveData).toHaveBeenCalledTimes(2);
	});

	it("keeps a log's stream running when the monitor closes", async () => {
		const session = createLiveDataSession();
		const protocol = createLiveDataProtocol({ session });
		const connection = createLiveDataConnection();
		const pids = createLiveDataPids();
		await manager.applyConfiguration(
			connection,
			protocol,
			{ protocolName: protocol.name, profileName: "Test", pids },
			true,
		);
		await manager.showPanel();
		const recording = manager.streamForLogging(
			connection,
			protocol,
			pids,
			vi.fn(),
		);
		mockPanel.dispose();
		expect(session.stop).not.toHaveBeenCalled();
		recording.stop();
		expect(session.stop).toHaveBeenCalledOnce();
	});

	it("does not let monitor controls stop polling underneath an active log", async () => {
		const session = createLiveDataSession();
		manager.streamForLogging(
			createLiveDataConnection(),
			createLiveDataProtocol({ session }),
			createLiveDataPids(),
			vi.fn(),
		);
		await manager.showPanel();
		mockPanel.webview._simulateMessage({ type: "stopStreaming" });
		expect(session.stop).not.toHaveBeenCalled();
	});

	it("restarts a stream when an imported file's revision changes without changing channel IDs", async () => {
		const session = createLiveDataSession();
		const protocol = createLiveDataProtocol({ session });
		const connection = createLiveDataConnection();
		const configuration = {
			protocolName: protocol.name,
			profileName: "External XML",
			profileId: "evoscan:file.xml",
			pids: createLiveDataPids(),
			revision: "before",
		};
		await manager.applyConfiguration(connection, protocol, configuration, true);
		await manager.applyConfiguration(
			connection,
			protocol,
			{ ...configuration, revision: "after" },
			true,
		);
		expect(session.stop).toHaveBeenCalledOnce();
		expect(protocol.streamLiveData).toHaveBeenCalledTimes(2);
	});

	it("rejects configuration changes during an ECU ROM read", async () => {
		const resume = await manager.suspendForRomRead();
		await expect(
			manager.applyConfiguration(
				createLiveDataConnection(),
				createLiveDataProtocol(),
				{
					protocolName: "Test",
					profileName: "Test",
					pids: createLiveDataPids(),
				},
			),
		).rejects.toThrow(/ROM read/);
		resume();
	});
});
