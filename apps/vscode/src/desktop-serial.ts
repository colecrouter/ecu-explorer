import {
	groupSerialPorts,
	normalizeUsbIdentifier,
	type SerialPortGroup,
} from "@ecu-explorer/device/hardware-runtime";
import { SerialPort } from "serialport";

export interface DesktopSerialDevice extends SerialPortGroup {}

export interface DesktopSerialMatcher {
	vendorId?: string;
	productId?: string;
	manufacturerIncludes?: string[];
	pathIncludes?: string[];
}

export async function listDesktopSerialDevices(): Promise<
	DesktopSerialDevice[]
> {
	const ports = await SerialPort.list();
	return groupSerialPorts(ports);
}

export function matchDesktopSerialDevice(
	device: DesktopSerialDevice,
	matcher: DesktopSerialMatcher,
): boolean {
	const vendorId = normalizeUsbIdentifier(matcher.vendorId);
	if (vendorId != null && device.vendorId !== vendorId) {
		return false;
	}

	const productId = normalizeUsbIdentifier(matcher.productId);
	if (productId != null && device.productId !== productId) {
		return false;
	}

	if (
		matcher.manufacturerIncludes != null &&
		matcher.manufacturerIncludes.length > 0
	) {
		const manufacturer = device.manufacturer?.toLowerCase() ?? "";
		if (
			!matcher.manufacturerIncludes.some((entry) =>
				manufacturer.includes(entry.toLowerCase()),
			)
		) {
			return false;
		}
	}

	if (matcher.pathIncludes != null && matcher.pathIncludes.length > 0) {
		const haystack = device.allPaths.join(" ").toLowerCase();
		if (
			!matcher.pathIncludes.some((entry) =>
				haystack.includes(entry.toLowerCase()),
			)
		) {
			return false;
		}
	}

	return true;
}
