import type { LiveDataFrame, PidDescriptor } from "@ecu-explorer/device";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { LoggingCommands } from "../src/commands/logging-commands.js";
import { LiveDataPanelManager } from "../src/live-data-panel-manager.js";
import { LoggingConfigurationStore } from "../src/logging-configuration.js";
import { LoggingManager } from "../src/logging-manager.js";
import {
	createLiveDataConnection,
	createLiveDataPids,
	createLiveDataProtocol,
} from "./mocks/live-data-fixtures.js";
import {
	createLoggingConfiguration,
	createWorkspaceFolders,
} from "./mocks/logging-fixtures.js";
import { createExtensionContext } from "./mocks/vscode-harness.js";
import { createMockWebviewPanel } from "./mocks/webview-mock.js";

type ChannelPick = vscode.QuickPickItem & { pid: PidDescriptor };
type ChannelPicker = (
	items: readonly ChannelPick[],
	options: vscode.QuickPickOptions & { canPickMany: true },
) => Thenable<ChannelPick[] | undefined>;

describe("shared logging commands", () => {
	const pids = createLiveDataPids();
	let files: Map<string, string>;
	beforeEach(() => {
		files = new Map();
		vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
			...createWorkspaceFolders(),
		]);
		vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(
			createLoggingConfiguration("logs"),
		);
		vi.mocked(vscode.workspace.fs.createDirectory).mockResolvedValue();
		vi.mocked(vscode.workspace.fs.readDirectory).mockResolvedValue([]);
		vi.mocked(vscode.workspace.fs.readFile).mockImplementation(async (uri) =>
			new TextEncoder().encode(files.get(uri.toString()) ?? ""),
		);
		vi.mocked(vscode.workspace.fs.writeFile).mockImplementation(
			async (uri, data) => {
				files.set(uri.toString(), new TextDecoder().decode(data));
			},
		);
		vi.mocked(vscode.window.createWebviewPanel).mockReturnValue(
			createMockWebviewPanel("Monitor") as vscode.WebviewPanel,
		);
	});
	afterEach(() => vi.restoreAllMocks());
	function setup() {
		const values = new Map<string, unknown>([
			["loggingConfiguration", { protocolName: "Test Protocol", pids: [0x0c] }],
		]);
		const state = {
			get: <T>(key: string) => values.get(key) as T | undefined,
			update: async (key: string, value: unknown) => {
				values.set(key, value);
			},
		};
		let receive: ((frame: LiveDataFrame) => void) | undefined;
		const connection = createLiveDataConnection();
		const protocol = createLiveDataProtocol({
			supportedPids: pids,
			onStreamStart: (onFrame) => {
				receive = onFrame;
			},
		});
		const active = {
			connection,
			protocol,
			deviceName: "Test",
			state: "connected" as const,
			locality: "extension-host" as const,
		};
		const context = createExtensionContext() as vscode.ExtensionContext;
		const logging = new LoggingManager();
		const liveData = new LiveDataPanelManager(context);
		const commands = new LoggingCommands({
			deviceManager: { activeConnection: active, connect: async () => active },
			configuration: new LoggingConfigurationStore(state),
			logging,
			liveData,
			getAuxiliaryChannels: () => [],
		});
		return {
			commands,
			logging,
			liveData,
			protocol,
			values,
			frame: (pid: number) =>
				receive?.({ timestamp: 10, pid, value: 123, unit: "" }),
		};
	}
	it("uses the same selected channels for monitoring and recording without another picker", async () => {
		const { commands, protocol, logging } = setup();
		const pick = vi.mocked(vscode.window.showQuickPick);
		pick.mockClear();
		await commands.run("monitor");
		await commands.run("record");
		expect(protocol.streamLiveData).toHaveBeenCalledOnce();
		expect(protocol.streamLiveData).toHaveBeenCalledWith(
			expect.anything(),
			{ pids: [0x0c] },
			expect.any(Function),
			expect.any(Function),
		);
		expect(pick).not.toHaveBeenCalled();
		await logging.stopLog({ notify: false });
	});
	it.each([
		false,
		true,
	])("rotates the CSV safely when changing channels (paused=%s)", async (paused) => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-10-31T12:00:00Z"));
		try {
			const { commands, logging, frame } = setup();
			await commands.run("record");
			frame(0x0c);
			if (paused) logging.pauseLog();
			vi.mocked(vscode.window.showQuickPick as ChannelPicker).mockResolvedValue(
				[{ label: pids[1].name, pid: pids[1] }],
			);
			await commands.run("configure");
			expect(logging.loggingState).toBe(paused ? "paused" : "recording");
			if (paused) logging.resumeLog();
			frame(0x0d);
			await logging.stopLog({ notify: false });
			expect(files.size).toBe(2);
			const logs = [...files.values()];
			expect(logs[0]).toContain("Timestamp (ms),Engine RPM");
			expect(logs[0]).not.toContain("Vehicle Speed");
			expect(logs[1]).toContain("Timestamp (ms),Vehicle Speed");
			expect(logs[1]).not.toContain("Engine RPM");
			expect(logs.every((log) => log.includes("10,123"))).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it("retains the old selection and buffered samples if saving the previous CSV fails", async () => {
		const { commands, logging, values, frame } = setup();
		await commands.run("record");
		frame(0x0c);
		vi.mocked(vscode.window.showQuickPick as ChannelPicker).mockResolvedValue([
			{ label: pids[1].name, pid: pids[1] },
		]);
		vi.mocked(vscode.workspace.fs.writeFile).mockRejectedValueOnce(
			new Error("Disk unavailable"),
		);
		await expect(commands.run("configure")).rejects.toThrow("Disk unavailable");
		expect(values.get("loggingConfiguration")).toMatchObject({ pids: [0x0c] });
		await commands.run("configure");
		frame(0x0d);
		await logging.stopLog({ notify: false });
		expect(files.size).toBe(2);
		expect([...files.values()][0]).toContain("10,123");
	});

	it("does not overwrite an existing CSV when its contents temporarily cannot be read", async () => {
		const { commands, logging, values, frame } = setup();
		await commands.run("record");
		frame(0x0c);
		await logging.flushLog();
		frame(0x0c);
		const previous = [...files.values()][0];
		vi.mocked(vscode.window.showQuickPick as ChannelPicker).mockResolvedValue([
			{ label: pids[1].name, pid: pids[1] },
		]);
		vi.mocked(vscode.workspace.fs.readFile).mockRejectedValueOnce(
			new Error("Cloud file unavailable"),
		);
		await expect(commands.run("configure")).rejects.toThrow(
			"Cloud file unavailable",
		);
		expect([...files.values()][0]).toBe(previous);
		expect(values.get("loggingConfiguration")).toMatchObject({ pids: [0x0c] });
		await commands.run("configure");
		await logging.stopLog({ notify: false });
		expect([...files.values()][0]?.match(/10,123/g)).toHaveLength(2);
	});

	it("cancelling configuration leaves the current recording and stream untouched", async () => {
		const { commands, logging, protocol, values } = setup();
		await commands.run("record");
		vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
		await commands.run("configure");
		expect(logging.loggingState).toBe("recording");
		expect(protocol.streamLiveData).toHaveBeenCalledOnce();
		expect(values.get("loggingConfiguration")).toMatchObject({ pids: [0x0c] });
		expect(files.size).toBe(0);
		await logging.stopLog({ notify: false });
	});
});
