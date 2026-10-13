import type { DeviceConnection } from "@ecu-explorer/device";
import { expect, vi } from "vitest";
import type { EvoXKernelArtifacts } from "../src/evox-kernel.js";

const hex = (value: string) =>
	Uint8Array.from(value.match(/../g) ?? [], (byte) =>
		Number.parseInt(byte, 16),
	);
export const artifacts: EvoXKernelArtifacts = {
	bootstrap: new Uint8Array(208),
	kernel: new Uint8Array(5117),
};
const version = Uint8Array.from([
	0x81,
	...new TextEncoder().encode("OpenECU Mitsubishi M32186 CAN Kernel V1.09\0"),
]);

/** Protocol transcript: application messages, not individual CAN frames. */
export function transcript(
	steps: Array<
		["exchange" | "send" | "receive", Uint8Array, Uint8Array | Error]
	>,
) {
	let cursor = 0;
	const consume = async (kind: string, data: Uint8Array) => {
		const step = steps[cursor++];
		expect(step, `unexpected ${kind}`).toBeDefined();
		expect([kind, data]).toEqual(step?.slice(0, 2));
		if (step?.[2] instanceof Error) throw step[2];
		return step?.[2] as Uint8Array;
	};
	const connection: DeviceConnection = {
		deviceInfo: {
			id: "transcript",
			name: "Recorded Evo X",
			transportName: "openport2",
			connected: true,
		},
		sendFrame: (data) => consume("exchange", data),
		sendOnly: async (data) => {
			await consume("send", data);
		},
		receiveMessage: () => consume("receive", new Uint8Array()),
		startStream: () => {},
		stopStream: () => {},
		close: async () => {},
	};
	return { connection, exhausted: () => expect(cursor).toBe(steps.length) };
}

// Synthetic image contents exercise the state machine without distributing the kernel.
// Only the file-integrity boundary is stubbed here; local capture replay verifies real bytes.
export function acceptSyntheticArtifacts() {
	const hashes = [
		"8d53b034b6ec0a88311e6c55dd037475933c4572b1406b88ae815e9b1db09fc9",
		"537b4e3893757857da7bc54689d5c6db53a97f0d0a6e343541444432d81c98a9",
	];
	return vi
		.spyOn(crypto.subtle, "digest")
		.mockImplementation(
			async () => hex(hashes.shift() ?? "").buffer as ArrayBuffer,
		);
}
export function startup(): Array<
	["exchange" | "send" | "receive", Uint8Array, Uint8Array | Error]
> {
	return [
		["exchange", hex("1092"), hex("5092")],
		["exchange", hex("1085"), hex("7f1078")],
		["receive", hex(""), hex("5085")],
		["exchange", hex("2705"), hex("67058fb2cef1")],
		["exchange", hex("2706481420cb"), hex("670634")],
		["exchange", hex("3b9a01010026032700000001"), hex("7f3b78")],
		["receive", hex(""), hex("7b9a")],
		["exchange", hex("3420000001000002"), hex("740101")],
		["exchange", hex("36ba02"), hex("76")],
		["exchange", hex("37"), hex("77")],
		["exchange", hex("34808538010000d0"), hex("740101")],
		["exchange", Uint8Array.from([0x36, ...artifacts.bootstrap]), hex("76")],
		["exchange", hex("37"), hex("77")],
		["exchange", hex("31e101"), hex("71e100ffffff")],
		["exchange", hex("31e0"), hex("7f3178")],
		...Array.from({ length: 21 }, (_, i): ["send", Uint8Array, Uint8Array] => [
			"send",
			artifacts.kernel.slice(i * 251, (i + 1) * 251),
			hex(""),
		]),
		["exchange", hex("01"), version],
	];
}

/** Captured cleanup core; physical 1092 substitutes for the final broadcast before identity. */
export function cleanup(): Array<
	["exchange" | "send" | "receive", Uint8Array, Uint8Array | Error]
> {
	return [
		["send", hex("07"), hex("")],
		["exchange", hex("1092"), hex("5092")],
		["exchange", hex("1085"), hex("5085")],
		["exchange", hex("2705"), hex("67058fb2cef1")],
		["exchange", hex("2706481420cb"), hex("670634")],
		["exchange", hex("3b9a01010026032700000001"), hex("7b9a")],
		["exchange", hex("3420000001000002"), hex("740101")],
		["exchange", hex("36d4d4"), hex("76")],
		["exchange", hex("37"), hex("77")],
		["exchange", hex("31e102"), hex("7f3178")],
		["receive", hex(""), hex("71e100ffffff")],
		["exchange", hex("1101"), hex("7f1178")],
		["receive", hex(""), hex("51")],
		["exchange", hex("1092"), hex("5092")],
		["exchange", hex("1a87"), hex("5a8704850001ff0000568913")],
	];
}
