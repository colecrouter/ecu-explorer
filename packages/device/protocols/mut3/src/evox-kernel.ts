import type {
	DeviceConnection,
	EcuEvent,
	RomProgress,
} from "@ecu-explorer/device";
import { computeFlashSecurityKey } from "./security.js";

/** Encoded wire images recovered from EcuFlash V1.09 uploads; never bundled with the app. */
export interface EvoXKernelArtifacts {
	/** 208 bytes, format-01 encoded bootstrap (without the 0x36 service byte). */
	bootstrap: Uint8Array;
	/** 5117 encoded bytes, retaining all 21 original upload payloads in order. */
	kernel: Uint8Array;
}

const VERSION = "OpenECU Mitsubishi M32186 CAN Kernel V1.09";
const TIMEOUT = 5000;
const ROM_SIZE = 0x100000;
type UploadConnection = DeviceConnection &
	Required<Pick<DeviceConnection, "sendOnly" | "receiveMessage">>;

function bytes(hex: string): Uint8Array {
	return Uint8Array.from(hex.match(/../g) ?? [], (byte) =>
		Number.parseInt(byte, 16),
	);
}
function hex(data: Uint8Array): string {
	return Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}
function uint32(data: Uint8Array): number {
	return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(
		0,
		false,
	);
}
function word(value: number): Uint8Array {
	const result = new Uint8Array(4);
	new DataView(result.buffer).setUint32(0, value, false);
	return result;
}

/** Computes the separate kernel 08/09 key, validated against 145 captured exchanges. */
export function computeKernelSecurityKey(seed: number): number {
	let key = seed >>> 0;
	for (let i = 0; i < 32; i++)
		key = ((key >>> 1) ^ (key & 1 ? 0xa723b0f1 : 0x395e1c22)) >>> 0;
	return key;
}

/** Validate the exact known encoded images before any ECU traffic. */
export async function validateEvoXKernelArtifacts(
	artifacts: EvoXKernelArtifacts,
): Promise<void> {
	for (const [name, image, length, digest] of [
		[
			"bootstrap",
			artifacts.bootstrap,
			208,
			"8d53b034b6ec0a88311e6c55dd037475933c4572b1406b88ae815e9b1db09fc9",
		],
		[
			"kernel",
			artifacts.kernel,
			5117,
			"537b4e3893757857da7bc54689d5c6db53a97f0d0a6e343541444432d81c98a9",
		],
	] as const) {
		if (image.length !== length)
			throw new Error(`Evo X ${name} must contain ${length} encoded bytes`);
		const actual = hex(
			new Uint8Array(
				await crypto.subtle.digest("SHA-256", new Uint8Array(image)),
			),
		);
		if (actual !== digest)
			throw new Error(
				`Evo X ${name} SHA-256 does not match the captured V1.09 image`,
			);
	}
}

/** Upload and read-only command client for the captured M32186 V1.09 RAM kernel.
 * See specs/EVO_X_KERNEL_RESEARCH.md and GitHub issues #5/#10.
 */
export class EvoXKernelSession {
	readonly version = VERSION;
	private unlocked = false;
	private constructor(private readonly connection: UploadConnection) {}

	/** Replay the captured read-session bootstrap/upload and verify the running version.
	 * No erase/program commands are issued. The adapter must preserve ISO-TP frame boundaries.
	 */
	static async upload(
		connection: DeviceConnection,
		artifacts: EvoXKernelArtifacts,
		onProgress?: (progress: RomProgress) => void,
		onEvent?: (event: EcuEvent) => void,
	): Promise<EvoXKernelSession> {
		// Copy caller-owned arrays so their contents cannot change after integrity checks.
		const images = {
			bootstrap: new Uint8Array(artifacts.bootstrap),
			kernel: new Uint8Array(artifacts.kernel),
		};
		await validateEvoXKernelArtifacts(images);
		if (!connection.sendOnly || !connection.receiveMessage)
			throw new Error(
				"Evo X upload requires sendOnly and receiveMessage transport support",
			);
		if (connection.deviceInfo.transportName !== "openport2")
			throw new Error("Evo X kernel requires OpenPort ISO15765 transport");
		connection.stopStream();
		const session = new EvoXKernelSession(connection as UploadConnection);
		const request = (data: string, reply: string) =>
			session.exchange(bytes(data), bytes(reply));
		await request("1092", "5092");
		await request("1085", "5085");
		onEvent?.({ type: "SECURITY_ACCESS_REQUESTED", timestamp: Date.now() });
		const seed = await session.exchange(bytes("2705"), bytes("6705"), 6);
		const key = computeFlashSecurityKey(seed.slice(2));
		try {
			await session.exchange(
				Uint8Array.from([0x27, 0x06, ...key]),
				bytes("670634"),
				3,
			);
		} catch (error) {
			onEvent?.({ type: "SECURITY_ACCESS_DENIED", timestamp: Date.now() });
			throw error;
		}
		onEvent?.({ type: "SECURITY_ACCESS_GRANTED", timestamp: Date.now() });
		// Captured metadata bytes are preserved; their semantics are not generalized.
		await request("3b9a01010026032700000001", "7b9a");
		await request("3420000001000002", "740101");
		await request("36ba02", "76");
		await request("37", "77");
		await request("34808538010000d0", "740101");
		await session.exchange(
			Uint8Array.from([0x36, ...images.bootstrap]),
			bytes("76"),
		);
		await request("37", "77");
		await request("31e101", "71e100ffffff");
		// 31e0 intentionally returns only response-pending before the bootstrap accepts data.
		await session.exchange(bytes("31e0"), bytes("7f3178"), 3);
		for (let offset = 0; offset < images.kernel.length; offset += 251) {
			await connection.sendOnly(images.kernel.slice(offset, offset + 251));
			const processed = Math.min(offset + 251, images.kernel.length);
			onProgress?.({
				phase: "negotiating",
				bytesProcessed: processed,
				totalBytes: images.kernel.length,
				percentComplete: (processed / images.kernel.length) * 100,
				message: "Uploading Evo X RAM kernel",
			});
		}
		const response = await session.exchange(bytes("01"), bytes("81"), 44);
		const expected = Uint8Array.from([
			0x81,
			...new TextEncoder().encode(`${VERSION}\0`),
		]);
		if (hex(response) !== hex(expected))
			throw new Error("Unexpected Evo X kernel version after upload");
		onEvent?.({
			type: "KERNEL_INITIALIZED",
			timestamp: Date.now(),
			data: { version: VERSION },
		});
		return session;
	}

	private async exchange(
		request: Uint8Array,
		expected: Uint8Array,
		length = expected.length,
	): Promise<Uint8Array> {
		const deadline = Date.now() + TIMEOUT;
		let response = await this.connection.sendFrame(request, TIMEOUT);
		const isExpected = () => expected.every((byte, i) => response[i] === byte);
		while (
			!isExpected() &&
			response.length === 3 &&
			response[0] === 0x7f &&
			response[1] === request[0] &&
			response[2] === 0x78
		) {
			const remaining = deadline - Date.now();
			if (remaining <= 0)
				throw new Error(
					`Evo X response-pending deadline exceeded for ${hex(request)}`,
				);
			response = await this.connection.receiveMessage(remaining);
		}
		if (!isExpected() || (length !== undefined && response.length !== length))
			throw new Error(
				`Unexpected Evo X reply ${hex(response)} for ${hex(request)} (expected ${hex(expected)})`,
			);
		return response;
	}

	/** Unlock the uploaded kernel once; repeated challenges would lock an unfinished handshake. */
	async unlock(): Promise<void> {
		if (this.unlocked) return;
		const challenge = await this.exchange(bytes("08"), bytes("88"), 5);
		const key = computeKernelSecurityKey(uint32(challenge.slice(1)));
		await this.exchange(Uint8Array.from([0x09, ...word(key)]), bytes("89"), 1);
		this.unlocked = true;
	}

	/** Read a bounded ROM region through kernel command 03 (maximum 1024 bytes/request). */
	async readMemory(address: number, length: number): Promise<Uint8Array> {
		if (
			!Number.isInteger(address) ||
			!Number.isInteger(length) ||
			address < 0 ||
			length <= 0 ||
			length > 1024 ||
			address + length > ROM_SIZE
		)
			throw new RangeError(
				"Evo X read must be a 1..1024-byte region within the 1 MiB ROM",
			);
		await this.unlock();
		const response = await this.exchange(
			Uint8Array.from([0x03, ...word(address), length >>> 8, length & 255]),
			bytes("83"),
			length + 1,
		);
		return response.slice(1);
	}

	/** Read the complete 1 MiB ROM; return only after every block has the expected length. */
	async readRom(
		onProgress: (progress: RomProgress) => void,
	): Promise<Uint8Array> {
		const rom = new Uint8Array(ROM_SIZE);
		for (let address = 0; address < ROM_SIZE; address += 1024) {
			rom.set(await this.readMemory(address, 1024), address);
			onProgress({
				phase: "reading",
				bytesProcessed: address + 1024,
				totalBytes: ROM_SIZE,
				percentComplete: ((address + 1024) / ROM_SIZE) * 100,
			});
		}
		return rom;
	}
}
