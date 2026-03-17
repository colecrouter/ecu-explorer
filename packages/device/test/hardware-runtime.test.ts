import { describe, expect, it } from "vitest";
import {
	buildSerialPortIdentity,
	comparePreferredDevicePaths,
	groupSerialPorts,
	normalizeUsbIdentifier,
} from "../src/hardware-runtime.js";

describe("hardware-runtime", () => {
	describe("normalizeUsbIdentifier()", () => {
		it("normalizes hex strings and strips 0x prefix", () => {
			expect(normalizeUsbIdentifier("0x0403")).toBe("0403");
			expect(normalizeUsbIdentifier(" CC4D ")).toBe("cc4d");
		});

		it("returns undefined for empty or missing values", () => {
			expect(normalizeUsbIdentifier("")).toBeUndefined();
			expect(normalizeUsbIdentifier("   ")).toBeUndefined();
			expect(normalizeUsbIdentifier(undefined)).toBeUndefined();
		});
	});

	describe("comparePreferredDevicePaths()", () => {
		it("prefers /dev/cu.* over /dev/tty.*", () => {
			expect(
				comparePreferredDevicePaths(
					"/dev/cu.usbmodem123",
					"/dev/tty.usbmodem123",
				),
			).toBeLessThan(0);
		});

		it("falls back to lexical ordering within the same rank", () => {
			expect(
				comparePreferredDevicePaths("/dev/cu.usbmodemA", "/dev/cu.usbmodemB"),
			).toBeLessThan(0);
		});
	});

	describe("buildSerialPortIdentity()", () => {
		it("uses serial number when available", () => {
			expect(
				buildSerialPortIdentity({
					path: "/dev/cu.usbmodem123",
					vendorId: "0x0403",
					productId: "0xcc4d",
					serialNumber: "OP2-123",
				}),
			).toBe("0403:cc4d:OP2-123");
		});

		it("falls back to manufacturer and path suffix when serial is missing", () => {
			expect(
				buildSerialPortIdentity({
					path: "/dev/cu.usbmodem123",
					vendorId: "0403",
					productId: "cc4d",
					manufacturer: "Tactrix",
				}),
			).toBe("0403:cc4d:tactrix:usbmodem123");
		});
	});

	describe("groupSerialPorts()", () => {
		it("groups duplicate tty/cu paths into one device and prefers /dev/cu.*", () => {
			const devices = groupSerialPorts([
				{
					path: "/dev/tty.usbmodem123",
					serialNumber: "OP2-123",
					vendorId: "0403",
					productId: "cc4d",
				},
				{
					path: "/dev/cu.usbmodem123",
					serialNumber: "OP2-123",
					vendorId: "0403",
					productId: "cc4d",
				},
			]);

			expect(devices).toHaveLength(1);
			expect(devices[0]?.preferredPath).toBe("/dev/cu.usbmodem123");
			expect(devices[0]?.allPaths).toEqual([
				"/dev/cu.usbmodem123",
				"/dev/tty.usbmodem123",
			]);
		});

		it("preserves metadata from the grouped port entry", () => {
			const devices = groupSerialPorts([
				{
					path: "/dev/cu.usbmodem123",
					serialNumber: "OP2-123",
					manufacturer: "Tactrix",
					vendorId: "0403",
					productId: "cc4d",
					friendlyName: "Tactrix OpenPort 2.0",
				},
			]);

			expect(devices[0]).toEqual({
				id: "0403:cc4d:OP2-123",
				preferredPath: "/dev/cu.usbmodem123",
				allPaths: ["/dev/cu.usbmodem123"],
				serialNumber: "OP2-123",
				manufacturer: "Tactrix",
				vendorId: "0403",
				productId: "cc4d",
				friendlyName: "Tactrix OpenPort 2.0",
			});
		});
	});
});
