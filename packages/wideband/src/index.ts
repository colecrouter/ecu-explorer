import type { HardwareLocality } from "@ecu-explorer/device/hardware-runtime";

export type WidebandReading =
	| {
			kind: "lambda";
			value: number;
			timestamp: number;
	  }
	| {
			kind: "afr";
			value: number;
			timestamp: number;
	  };

export interface WidebandHardwareCandidate {
	id: string;
	name: string;
	transportName: string;
	locality: HardwareLocality;
	serialNumber?: string;
	vendorId?: string;
	productId?: string;
}

export interface WidebandSession {
	readonly id: string;
	readonly name: string;
	startStream(onReading: (reading: WidebandReading) => void): Promise<void>;
	stopStream(): Promise<void>;
	close(): Promise<void>;
}

export interface WidebandAdapter {
	readonly id: string;
	readonly name: string;
	canOpen(
		candidate: WidebandHardwareCandidate,
	): Promise<boolean> | boolean;
	open(candidate: WidebandHardwareCandidate): Promise<WidebandSession>;
}

export function isLambdaReading(
	reading: WidebandReading,
): reading is Extract<WidebandReading, { kind: "lambda" }> {
	return reading.kind === "lambda";
}

export function isAfrReading(
	reading: WidebandReading,
): reading is Extract<WidebandReading, { kind: "afr" }> {
	return reading.kind === "afr";
}

export function formatWidebandReading(reading: WidebandReading): string {
	const formattedValue = reading.value.toFixed(2);
	if (isLambdaReading(reading)) {
		return `${formattedValue} lambda`;
	}
	return `${formattedValue} AFR`;
}
