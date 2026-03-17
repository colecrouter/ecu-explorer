import type { DeviceInfo } from "@ecu-explorer/device";
import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
	createHardwareSelectionRecord,
	findPreferredHardwareDevice,
	HardwareSelectionService,
	WorkspaceHardwareSelectionStrategy,
} from "../src/hardware-selection.js";
import { WorkspaceState } from "../src/workspace-state.js";

function makeDevice(
	overrides: Partial<DeviceInfo> & Pick<DeviceInfo, "id" | "name">,
): DeviceInfo {
	return {
		id: overrides.id,
		name: overrides.name,
		transportName: overrides.transportName ?? "openport2",
		connected: overrides.connected ?? false,
	};
}

describe("hardware-selection", () => {
	function createWorkspaceState() {
		const storage = new Map<string, unknown>();
		return new WorkspaceState({
			get: (key: string) => storage.get(key),
			update: async (key: string, value: unknown) => {
				storage.set(key, value);
			},
			keys: () => Array.from(storage.keys()),
		});
	}

	it("creates a hardware selection record from a device", () => {
		expect(
			createHardwareSelectionRecord(
				makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0" }),
			),
		).toEqual({
			id: "openport2:ABC",
			transportName: "openport2",
			name: "OpenPort 2.0",
		});
	});

	it("finds the preferred device by transport and id", () => {
		const preferred = findPreferredHardwareDevice(
			[
				makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0 A" }),
				makeDevice({ id: "openport2:DEF", name: "OpenPort 2.0 B" }),
			],
			{
				id: "openport2:DEF",
				transportName: "openport2",
				name: "OpenPort 2.0 B",
			},
		);

		expect(preferred?.id).toBe("openport2:DEF");
	});

	it("returns undefined when the preferred device is not present", () => {
		const preferred = findPreferredHardwareDevice(
			[makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0 A" })],
			{
				id: "openport2:DEF",
				transportName: "openport2",
				name: "OpenPort 2.0 B",
			},
		);

		expect(preferred).toBeUndefined();
	});

	it("workspace strategy prefers a saved device without prompting", async () => {
		const workspaceState = createWorkspaceState();
		workspaceState.saveDeviceSelection("ecu-primary", {
			id: "openport2:DEF",
			transportName: "openport2",
			name: "OpenPort 2.0 B",
		});
		const strategy = new WorkspaceHardwareSelectionStrategy(
			new HardwareSelectionService(workspaceState),
		);
		const quickPickSpy = vi.spyOn(vscode.window, "showQuickPick");

		const selected = await strategy.selectDevice([
			makeDevice({ id: "openport2:ABC", name: "OpenPort 2.0 A" }),
			makeDevice({ id: "openport2:DEF", name: "OpenPort 2.0 B" }),
		]);

		expect(selected.id).toBe("openport2:DEF");
		expect(quickPickSpy).not.toHaveBeenCalled();
	});
});
