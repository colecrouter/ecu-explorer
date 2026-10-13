import { crc32, validateMitsucanChecksum } from "@ecu-explorer/core";
import type {
	DeviceConnection,
	EcuEvent,
	RomProgress,
	WriteOptions,
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
/** Nonuniform sector boundaries read from the V1.09 kernel at 0x80c1fc. */
export const EVO_X_FLASH_SECTORS: ReadonlyArray<
	Readonly<{ address: number; length: number }>
> = Object.freeze(
	[
		0, 0x2000, 0x3000, 0x4000, 0x8000, 0x10000, 0x20000, 0x30000, 0x40000,
		0x50000, 0x60000, 0x70000, 0x80000, 0x90000, 0xa0000, 0xb0000, 0xc0000,
		0xd0000, 0xe0000, 0xf0000,
	].map((address, i, boundaries) =>
		Object.freeze({
			address,
			length: (boundaries[i + 1] ?? ROM_SIZE) - address,
		}),
	),
);

/** Validate a complete image and its mitsucan ROM checksum before any upload/erase. */
export function validateEvoXRom(
	rom: Uint8Array,
	options: WriteOptions = {},
): void {
	if (rom.length !== ROM_SIZE)
		throw new RangeError("Evo X ROM must contain exactly 1 MiB");
	if (options.originalRom && options.originalRom.length !== ROM_SIZE)
		throw new RangeError("Original Evo X ROM must contain exactly 1 MiB");
	if (options.verifyChecksums !== false && !validateMitsucanChecksum(rom))
		throw new Error(
			"Evo X ROM checksum is invalid; correct it before flashing",
		);
}

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

/** Upload, flash, and readback command client for the captured M32186 V1.09 RAM kernel.
 * See specs/EVO_X_KERNEL_RESEARCH.md and GitHub issues #5/#10.
 */
export class EvoXKernelSession {
	readonly version = VERSION;
	private unlocked = false;
	private closed = false;
	private recoveryRequired = false;
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
		length: number | null = expected.length,
		timeoutMs = TIMEOUT,
	): Promise<Uint8Array> {
		if (this.closed) throw new Error("Evo X kernel session is closed");
		const deadline = Date.now() + timeoutMs;
		let response = await this.connection.sendFrame(request, timeoutMs);
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
		if (!isExpected() || (length !== null && response.length !== length))
			throw new Error(
				`Unexpected Evo X reply ${hex(response)} for ${hex(request)} (expected ${hex(expected)})`,
			);
		return response;
	}

	/** Unlock the uploaded kernel once; repeated challenges would lock an unfinished handshake. */
	async unlock(): Promise<void> {
		if (this.closed) throw new Error("Evo X kernel session is closed");
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

	/** Attach explicitly to an existing V1.09 kernel after an interrupted write.
	 * Version and flash-disable are checked; only a real verified write can clear recovery state.
	 */
	static async resumeForRecovery(
		connection: DeviceConnection,
	): Promise<EvoXKernelSession> {
		if (
			connection.deviceInfo.transportName !== "openport2" ||
			!connection.sendOnly ||
			!connection.receiveMessage
		)
			throw new Error("Kernel recovery requires OpenPort message transport");
		const session = new EvoXKernelSession(connection as UploadConnection);
		const response = await session.exchange(bytes("01"), bytes("81"), 44);
		if (
			hex(response) !==
			hex(Uint8Array.from([0x81, ...new TextEncoder().encode(`${VERSION}\0`)]))
		)
			throw new Error("Unexpected kernel version during recovery");
		await session.exchange(bytes("21"), bytes("a1"));
		session.recoveryRequired = true;
		return session;
	}

	private async waitForFactoryReady(): Promise<void> {
		const deadline = Date.now() + 10000;
		let lastError: unknown;
		while (Date.now() < deadline) {
			try {
				await this.exchange(
					bytes("1092"),
					bytes("5092"),
					2,
					Math.min(1000, deadline - Date.now()),
				);
				return;
			} catch (error) {
				lastError = error;
			}
			const wait = Math.min(200, deadline - Date.now());
			if (wait > 0)
				await new Promise<void>((resolve) => setTimeout(resolve, wait));
		}
		throw new Error("ECU did not become ready for diagnostics after reset", {
			cause: lastError,
		});
	}

	/** Query the ECU's CRC32 over a bounded ROM region (command 02). */
	async regionCrc(address: number, length: number): Promise<number> {
		if (
			!Number.isInteger(address) ||
			!Number.isInteger(length) ||
			address < 0 ||
			length <= 0 ||
			address + length > ROM_SIZE
		)
			throw new RangeError("Invalid Evo X CRC region");
		await this.unlock();
		const response = await this.exchange(
			Uint8Array.from([2, ...word(address), ...word(length)]),
			bytes("82"),
			5,
		);
		return uint32(response.slice(1));
	}

	/** Flash only sectors whose live ECU CRC differs from the supplied image.
	 * The entire target sector is preserved; erased 0xff blocks need no programming.
	 * Dry run uses 22/23 only. Transport/commit/post-write CRCs are always required.
	 */
	async writeRom(
		rom: Uint8Array,
		onProgress: (progress: RomProgress) => void,
		options: WriteOptions = {},
		onEvent?: (event: EcuEvent) => void,
	): Promise<void> {
		options = { ...options };
		if (options.dryRun && this.recoveryRequired)
			throw new Error(
				"An incomplete flash requires a real write retry, not a dry run",
			);
		const image = new Uint8Array(rom);
		validateEvoXRom(image, options);
		await this.exchange(bytes("05"), bytes("8500000408"));
		await this.exchange(bytes("06"), bytes("8600001000"));
		await this.unlock();
		const changed: Array<{ address: number; length: number; crc: number }> = [];
		for (const sector of EVO_X_FLASH_SECTORS) {
			const expected = crc32(
				image.subarray(sector.address, sector.address + sector.length),
			);
			const actual = await this.regionCrc(sector.address, sector.length);
			if (actual !== expected) changed.push({ ...sector, crc: expected });
		}
		// EcuFlash programs the checksum-containing sector first in both complete write captures.
		changed.sort((a, b) =>
			a.address === 0xb0000
				? -1
				: b.address === 0xb0000
					? 1
					: a.address - b.address,
		);
		const total = changed.reduce((sum, sector) => sum + sector.length, 0);
		let processed = 0;
		const progress = (phase: RomProgress["phase"], message: string) =>
			onProgress({
				phase,
				bytesProcessed: processed,
				totalBytes: total,
				percentComplete: total ? (processed / total) * 100 : 100,
				message,
			});
		if (!total) {
			this.recoveryRequired = false;
			progress("verifying", "ECU already matches target ROM");
			return;
		}
		let flashAttempted = false;
		let failure: unknown;
		let failed = false;
		try {
			if (!options.dryRun) {
				flashAttempted = true;
				this.recoveryRequired = true;
				await this.exchange(bytes("20"), bytes("a0"));
			}
			for (const sector of changed) {
				if (!options.dryRun) {
					progress(
						"erasing",
						`Erasing sector at 0x${sector.address.toString(16)}`,
					);
					onEvent?.({
						type: "SECTOR_ERASE_STARTED",
						timestamp: Date.now(),
						data: { sectorAddr: sector.address },
					});
					await this.exchange(
						Uint8Array.from([0x25, ...word(sector.address)]),
						bytes("a50001"),
					);
					onEvent?.({
						type: "SECTOR_ERASE_COMPLETE",
						timestamp: Date.now(),
						data: { sectorAddr: sector.address },
					});
				}
				for (
					let address = sector.address;
					address < sector.address + sector.length;
					address += 4096
				) {
					const data = image.subarray(address, address + 4096);
					if (!data.every((byte) => byte === 255)) {
						for (let offset = 0; offset < data.length; offset += 512)
							await this.exchange(
								Uint8Array.from([
									0x22,
									...word(address + offset),
									...data.subarray(offset, offset + 512),
								]),
								bytes("a2"),
							);
						const command = options.dryRun ? 0x23 : 0x24;
						await this.exchange(
							Uint8Array.from([
								command,
								...word(address),
								0x10,
								0,
								...word(crc32(data)),
							]),
							bytes(options.dryRun ? "a3" : "a40001"),
						);
					}
					processed += data.length;
					progress(
						options.dryRun ? "verifying" : "writing",
						options.dryRun
							? "Checking RAM buffer CRC (dry run)"
							: "Programming ROM",
					);
				}
			}
		} catch (error) {
			failed = true;
			failure = error;
		}
		if (flashAttempted) {
			try {
				await this.exchange(bytes("21"), bytes("a1"));
			} catch (error) {
				throw new AggregateError(
					failed ? [failure, error] : [error],
					"Flash disable failed; retain the kernel for recovery",
				);
			}
		}
		if (failed) throw failure;
		if (!options.dryRun) {
			for (const sector of changed) {
				if (
					(await this.regionCrc(sector.address, sector.length)) !== sector.crc
				)
					throw new Error(
						`Post-write CRC mismatch at 0x${sector.address.toString(16)}; retain the kernel for recovery`,
					);
			}
		}
		this.recoveryRequired = false;
		progress(
			"verifying",
			options.dryRun
				? "Dry run complete; flash unchanged"
				: "Flash CRC verification complete",
		);
	}

	/** Restore factory diagnostics after a successful read/write using the recorded cleanup.
	 * Do not call after a failed flash: the RAM kernel must remain available for recovery.
	 */
	async restoreDiagnostics(): Promise<void> {
		if (this.recoveryRequired)
			throw new Error(
				"Flash incomplete; keep the kernel running for recovery instead of resetting",
			);
		if (this.closed) throw new Error("Evo X kernel session is closed");
		// Once reset is sent, this object must never be reused even if cleanup fails.
		try {
			await this.connection.sendOnly(bytes("07"));
			await this.waitForFactoryReady();
			await this.exchange(bytes("1085"), bytes("5085"));
			const seed = await this.exchange(bytes("2705"), bytes("6705"), 6);
			await this.exchange(
				Uint8Array.from([
					0x27,
					0x06,
					...computeFlashSecurityKey(seed.slice(2)),
				]),
				bytes("670634"),
			);
			await this.exchange(bytes("3b9a01010026032700000001"), bytes("7b9a"));
			await this.exchange(bytes("3420000001000002"), bytes("740101"));
			await this.exchange(bytes("36d4d4"), bytes("76"));
			await this.exchange(bytes("37"), bytes("77"));
			await this.exchange(bytes("31e102"), bytes("71e100ffffff"));
			await this.exchange(bytes("1101"), bytes("51"));
			await this.waitForFactoryReady();
			await this.exchange(bytes("1a87"), bytes("5a8704850001ff"), null);
		} finally {
			this.closed = true;
		}
	}
}
