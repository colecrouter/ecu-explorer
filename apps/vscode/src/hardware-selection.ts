import type { DeviceInfo } from "@ecu-explorer/device";
import type { HardwareSelectionRecord } from "@ecu-explorer/device/hardware-runtime";
import * as vscode from "vscode";
import type { WorkspaceState } from "./workspace-state.js";

export const DEFAULT_HARDWARE_SELECTION_SLOT = "ecu-primary";

export function createHardwareSelectionRecord(
	device: DeviceInfo,
): HardwareSelectionRecord {
	return {
		id: device.id,
		transportName: device.transportName,
		name: device.name,
	};
}

export function findPreferredHardwareDevice(
	devices: readonly DeviceInfo[],
	selection: HardwareSelectionRecord | undefined,
): DeviceInfo | undefined {
	if (selection == null) {
		return undefined;
	}

	return devices.find(
		(device) =>
			device.id === selection.id &&
			device.transportName === selection.transportName,
	);
}

export class HardwareSelectionService {
	constructor(
		private readonly workspaceState: WorkspaceState,
		private readonly slot = DEFAULT_HARDWARE_SELECTION_SLOT,
	) {}

	getSelection(): HardwareSelectionRecord | undefined {
		return this.workspaceState.getDeviceSelection(this.slot);
	}

	saveDevice(device: DeviceInfo): void {
		this.workspaceState.saveDeviceSelection(
			this.slot,
			createHardwareSelectionRecord(device),
		);
	}

	clearSelection(): void {
		this.workspaceState.clearDeviceSelection(this.slot);
	}

	findPreferredDevice(devices: readonly DeviceInfo[]): DeviceInfo | undefined {
		return findPreferredHardwareDevice(devices, this.getSelection());
	}
}

export interface HardwareDeviceSelectionStrategy {
	selectDevice(devices: readonly DeviceInfo[]): Promise<DeviceInfo>;
	rememberDevice(device: DeviceInfo): void;
}

export async function promptForHardwareDevice(
	devices: readonly DeviceInfo[],
): Promise<DeviceInfo> {
	if (devices.length === 0) {
		throw new Error("No device selected");
	}

	if (devices.length === 1) {
		const device = devices[0];
		if (device == null) {
			throw new Error("No device selected");
		}
		return device;
	}

	const deviceQuickPicks = devices.map((device, index) => ({
		label: `${device.name} (${device.transportName})`,
		description: `ID: ${device.id}`,
		index,
	}));
	const selected = await vscode.window.showQuickPick(deviceQuickPicks, {
		placeHolder: "Select a device to connect",
	});
	if (!selected) {
		throw new Error("Device selection cancelled by user");
	}
	const device = devices[selected.index];
	if (!device) {
		throw new Error("Selected device index is out of bounds for device list");
	}
	return device;
}

export class WorkspaceHardwareSelectionStrategy
	implements HardwareDeviceSelectionStrategy
{
	constructor(private readonly selectionService: HardwareSelectionService) {}

	async selectDevice(devices: readonly DeviceInfo[]): Promise<DeviceInfo> {
		const preferred = this.selectionService.findPreferredDevice(devices);
		if (preferred != null) {
			return preferred;
		}

		return promptForHardwareDevice(devices);
	}

	rememberDevice(device: DeviceInfo): void {
		this.selectionService.saveDevice(device);
	}
}
