import type { DeviceInfo } from "@ecu-explorer/device";
import type { HardwareSelectionRecord } from "@ecu-explorer/device/hardware-runtime";
import { WorkspaceState } from "./workspace-state.js";

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
