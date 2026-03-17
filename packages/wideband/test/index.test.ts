import { describe, expect, it } from "vitest";
import {
	formatWidebandReading,
	isAfrReading,
	isLambdaReading,
	type WidebandReading,
} from "../src/index.js";

describe("@ecu-explorer/wideband", () => {
	it("identifies lambda readings", () => {
		const reading: WidebandReading = {
			kind: "lambda",
			value: 0.98,
			timestamp: 1,
		};

		expect(isLambdaReading(reading)).toBe(true);
		expect(isAfrReading(reading)).toBe(false);
		expect(formatWidebandReading(reading)).toBe("0.98 lambda");
	});

	it("identifies afr readings", () => {
		const reading: WidebandReading = {
			kind: "afr",
			value: 14.7,
			timestamp: 1,
		};

		expect(isAfrReading(reading)).toBe(true);
		expect(isLambdaReading(reading)).toBe(false);
		expect(formatWidebandReading(reading)).toBe("14.70 AFR");
	});
});
