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

	// Seeds the ECU can issue (second word = first word * 5 + 0x77) for which
	// the low byte's carry into the high byte decides the key. None of them is
	// in the captures, so the fixtures alone cannot tell the carry constant.
	it.each([
		["003e01ad", "83004767"],
		["005b023e", "92859500"],
		["00f7054a", "e601366c"],
		["013e06ad", "0c00f467"],
	])("carries the low byte correctly for seed %s", (seed, key) => {
		const bytes = (hex: string) =>
			Array.from(hex.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
		expect(
			Array.from(computeFlashSecurityKey(new Uint8Array(bytes(seed)))),
		).toEqual(bytes(key));
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
