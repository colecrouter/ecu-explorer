import type { PidDescriptor } from "@ecu-explorer/device";
import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { LoggingConfigurationStore } from "../src/logging-configuration.js";
import {
	createLiveDataConnection,
	createLiveDataPids,
	createLiveDataProfiles,
	createLiveDataProtocol,
} from "./mocks/live-data-fixtures.js";
import { createMockWorkspaceState } from "./mocks/vscode-harness.js";

describe("native logging configuration", () => {
	it("preselects DataLog channels and carries the file revision into the stream configuration", async () => {
		const state = createMockWorkspaceState();
		const pids = createLiveDataPids();
		const first = createLiveDataProfiles()[0];
		if (!first) throw new Error("Missing profile");
		const profile = {
			...first,
			defaultPids: [pids[1].pid],
			revision: "new-file-revision",
		};
		vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
		const store = new LoggingConfigurationStore(state);
		await store.choose(
			createLiveDataConnection(),
			createLiveDataProtocol({ profiles: [profile] }),
		);
		expect(vi.mocked(vscode.window.showQuickPick).mock.calls[0]?.[0]).toEqual([
			expect.objectContaining({ picked: false }),
			expect.objectContaining({ picked: true }),
		]);
		vi.mocked(state.get).mockReturnValue({
			protocolName: "Test Protocol",
			profileId: profile.id,
			pids: [pids[1].pid],
		});
		expect(
			(
				await store.resolve(
					createLiveDataConnection(),
					createLiveDataProtocol({ profiles: [profile] }),
				)
			)?.revision,
		).toBe("new-file-revision");
	});

	it("uses the native channel multi-select and persists only accepted selections", async () => {
		const state = createMockWorkspaceState();
		const store = new LoggingConfigurationStore(state);
		const pids = createLiveDataPids();
		const protocol = createLiveDataProtocol({
			profiles: createLiveDataProfiles(),
		});
		vi.mocked(
			vscode.window.showQuickPick as (
				items: readonly vscode.QuickPickItem[],
				options: vscode.QuickPickOptions & { canPickMany: true },
			) => Thenable<
				(vscode.QuickPickItem & { pid: PidDescriptor })[] | undefined
			>,
		).mockResolvedValue([{ label: pids[1].name, pid: pids[1] }]);
		const selected = await store.choose(createLiveDataConnection(), protocol);
		expect(selected?.pids).toEqual([pids[1]]);
		expect(state.update).not.toHaveBeenCalled();
		if (!selected) throw new Error("Expected configuration");
		await store.save(selected);
		expect(state.update).toHaveBeenCalledWith(
			"loggingConfiguration",
			expect.objectContaining({ profileId: "test-ready", pids: [0x0d] }),
		);
		expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({ canPickMany: true }),
		);
	});

	it("offers available profiles, then leaves preferences untouched if channels are cancelled", async () => {
		const state = createMockWorkspaceState();
		const first = createLiveDataProfiles()[0];
		if (!first) throw new Error("Missing profile fixture");
		const unavailable = {
			...first,
			id: "disabled",
			name: "Disabled",
			status: "unavailable" as const,
		};
		const other = { ...first, id: "other", name: "Other" };
		const choice = { label: other.name, profile: other };
		vi.mocked(vscode.window.showQuickPick)
			.mockResolvedValueOnce(choice)
			.mockResolvedValueOnce(undefined);
		const result = await new LoggingConfigurationStore(state).choose(
			createLiveDataConnection(),
			createLiveDataProtocol({ profiles: [first, other, unavailable] }),
		);
		expect(result).toBeUndefined();
		expect(state.update).not.toHaveBeenCalled();
		const offered = vi.mocked(vscode.window.showQuickPick).mock.calls[0]?.[0];
		expect(offered).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ label: first.name }),
				expect.objectContaining({ label: other.name }),
			]),
		);
		expect(offered).not.toEqual(
			expect.arrayContaining([expect.objectContaining({ label: "Disabled" })]),
		);
	});

	it("reuses a valid saved configuration without prompting", async () => {
		const state = createMockWorkspaceState();
		vi.mocked(state.get).mockReturnValue({
			protocolName: "Test Protocol",
			profileId: "test-ready",
			pids: [0x0c],
		});
		const store = new LoggingConfigurationStore(state);
		const picker = vi.mocked(vscode.window.showQuickPick);
		picker.mockClear();
		const selected = await store.resolve(
			createLiveDataConnection(),
			createLiveDataProtocol({ profiles: createLiveDataProfiles() }),
		);
		expect(selected?.pids.map((pid) => pid.pid)).toEqual([0x0c]);
		expect(picker).not.toHaveBeenCalled();
	});
	it("leaves saved configuration untouched when channel selection is cancelled", async () => {
		const state = createMockWorkspaceState();
		vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
		const selected = await new LoggingConfigurationStore(state).choose(
			createLiveDataConnection(),
			createLiveDataProtocol({ supportedPids: createLiveDataPids() }),
		);
		expect(selected).toBeUndefined();
		expect(state.update).not.toHaveBeenCalled();
	});
	it("asks again when a saved channel is no longer available", async () => {
		const state = createMockWorkspaceState();
		vi.mocked(state.get).mockReturnValue({
			protocolName: "Test Protocol",
			profileId: "test-ready",
			pids: [0xffff],
		});
		vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);
		const result = await new LoggingConfigurationStore(state).resolve(
			createLiveDataConnection(),
			createLiveDataProtocol({ profiles: createLiveDataProfiles() }),
		);
		expect(result).toBeUndefined();
		expect(vscode.window.showQuickPick).toHaveBeenCalled();
	});
});
