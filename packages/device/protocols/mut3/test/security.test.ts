import { describe, expect, it } from "vitest";
import {
	computeFlashSecurityKey,
	computeSecurityKey,
} from "../src/security.js";
import { OBSERVED_FLASH_SESSION_PAIRS } from "./flash-session-trace-fixtures.js";

describe("computeSecurityKey", () => {
	it("computes the traced 0x01/0x02 diagnostic-session key", () => {
		expect(
			Array.from(computeSecurityKey(new Uint8Array([0x12, 0x34]))),
		).toEqual([0x3e, 0x68]);
	});

	it("returns a fresh 2-byte Uint8Array", () => {
		const seed = new Uint8Array([0x00, 0x00]);
		const key = computeSecurityKey(seed);
		expect(key).toBeInstanceOf(Uint8Array);
		expect(key.length).toBe(2);
		expect(key).not.toBe(seed);
	});

	it("rejects non-2-byte diagnostic seeds", () => {
		expect(() => computeSecurityKey(new Uint8Array([]))).toThrow(RangeError);
		expect(() => computeSecurityKey(new Uint8Array([0x01]))).toThrow(
			RangeError,
		);
		expect(() =>
			computeSecurityKey(new Uint8Array([0x01, 0x02, 0x03])),
		).toThrow(RangeError);
	});
});

describe("computeFlashSecurityKey", () => {
	it("matches all traced 0x05/0x06 flash-session seed-key fixtures", () => {
		for (const pair of OBSERVED_FLASH_SESSION_PAIRS) {
			expect(
				Array.from(computeFlashSecurityKey(new Uint8Array(pair.seed))),
				pair.capture,
			).toEqual(pair.key);
		}
	});

	it("returns a fresh 4-byte Uint8Array", () => {
		const seed = new Uint8Array([0x8f, 0xb2, 0xce, 0xf1]);
		const key = computeFlashSecurityKey(seed);
		expect(key).toBeInstanceOf(Uint8Array);
		expect(key.length).toBe(4);
		expect(key).not.toBe(seed);
	});

	it("rejects non-4-byte flash seeds", () => {
		expect(() => computeFlashSecurityKey(new Uint8Array([]))).toThrow(
			RangeError,
		);
		expect(() =>
			computeFlashSecurityKey(new Uint8Array([0x01, 0x02, 0x03])),
		).toThrow(RangeError);
		expect(() =>
			computeFlashSecurityKey(new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05])),
		).toThrow(RangeError);
	});
});
