import type { DeviceInfo } from "@ecu-explorer/device";
import { describe, expect, it } from "vitest";
import {
	createHardwareSelectionRecord,
	findPreferredHardwareDevice,
} from "../src/hardware-selection.js";

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
});
