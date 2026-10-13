import { crc32, mitsucanChecksum } from "@ecu-explorer/core";
import { describe, expect, it } from "vitest";
import {
	EVO_X_FLASH_SECTORS,
	EvoXKernelSession,
	validateEvoXRom,
} from "../src/evox-kernel.js";
import {
	acceptSyntheticArtifacts,
	artifacts,
	cleanup,
	startup,
	transcript,
} from "./kernel-transcript.js";

const hex = (s: string) =>
	Uint8Array.from(s.match(/../g) ?? [], (b) => Number.parseInt(b, 16));
const u32 = (n: number) => {
	const b = new Uint8Array(4);
	new DataView(b.buffer).setUint32(0, n);
	return b;
};
type Step = ["exchange" | "send" | "receive", Uint8Array, Uint8Array | Error];
function image() {
	const rom = new Uint8Array(0x100000).fill(255);
	new DataView(rom.buffer).setUint32(0xbfff0, mitsucanChecksum(rom));
	return rom;
}
function negotiated(): Step[] {
	return [
		["exchange", hex("05"), hex("8500000408")],
		["exchange", hex("06"), hex("8600001000")],
		["exchange", hex("08"), hex("88427cae0b")],
		["exchange", hex("09d13ebbac"), hex("89")],
	];
}
function scan(rom: Uint8Array, changed = -1): Step[] {
	return EVO_X_FLASH_SECTORS.map(
		({ address, length }, i) =>
			[
				"exchange",
				Uint8Array.from([2, ...u32(address), ...u32(length)]),
				Uint8Array.from([
					0x82,
					...u32(
						crc32(rom.slice(address, address + length)) ^
							(i === changed ? 1 : 0),
					),
				]),
			] as Step,
	);
}
function blockWrites(
	rom: Uint8Array,
	address: number,
	command: number,
): Step[] {
	const result: Step[] = [];
	for (let offset = 0; offset < 4096; offset += 512)
		result.push([
			"exchange",
			Uint8Array.from([
				0x22,
				...u32(address + offset),
				...rom.slice(address + offset, address + offset + 512),
			]),
			hex("a2"),
		]);
	result.push([
		"exchange",
		Uint8Array.from([
			command,
			...u32(address),
			0x10,
			0,
			...u32(crc32(rom.slice(address, address + 4096))),
		]),
		hex(command === 0x24 ? "a40001" : "a3"),
	]);
	return result;
}

describe("Evo X flash workflow", () => {
	it("has the decoded nonuniform sector layout and rejects invalid ROMs before traffic", () => {
		expect(EVO_X_FLASH_SECTORS).toHaveLength(20);
		expect(EVO_X_FLASH_SECTORS.slice(0, 3)).toEqual([
			{ address: 0, length: 0x2000 },
			{ address: 0x2000, length: 0x1000 },
			{ address: 0x3000, length: 0x1000 },
		]);
		expect(() => validateEvoXRom(new Uint8Array(12))).toThrow(/1 MiB/);
		expect(() => validateEvoXRom(new Uint8Array(0x100000))).toThrow(/checksum/);
		expect(() => validateEvoXRom(image())).not.toThrow();
	});
	it("skips a matching image without enabling or erasing flash", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const rom = image();
			const fake = transcript([...startup(), ...negotiated(), ...scan(rom)]);
			const session = await EvoXKernelSession.upload(
				fake.connection,
				artifacts,
			);
			await session.writeRom(rom, () => {});
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("erases the changed sector, stages 512-byte chunks, commits CRC-checked 4KB, disables and verifies", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const rom = image();
			// Only the checksum-containing 4KB block is non-erased in sector B.
			const fake = transcript([
				...startup(),
				...negotiated(),
				...scan(rom, 15),
				["exchange", hex("20"), hex("a0")],
				["exchange", hex("25000b0000"), hex("a50001")],
				...blockWrites(rom, 0xbf000, 0x24),
				["exchange", hex("21"), hex("a1")],
				[
					"exchange",
					hex("02000b000000010000"),
					Uint8Array.from([0x82, ...u32(crc32(rom.slice(0xb0000, 0xc0000)))]),
				],
			]);
			const session = await EvoXKernelSession.upload(
				fake.connection,
				artifacts,
			);
			await session.writeRom(rom, () => {});
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("dry-run stages/checks data without enabling flash, erasing, or committing", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const rom = image();
			const fake = transcript([
				...startup(),
				...negotiated(),
				...scan(rom, 15),
				...blockWrites(rom, 0xbf000, 0x23),
			]);
			const session = await EvoXKernelSession.upload(
				fake.connection,
				artifacts,
			);
			await session.writeRom(rom, () => {}, { dryRun: true });
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("disables flash after erase failure and does not retry or reset the ECU", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const rom = image();
			const fake = transcript([
				...startup(),
				...negotiated(),
				...scan(rom, 15),
				["exchange", hex("20"), hex("a0")],
				["exchange", hex("25000b0000"), hex("f2")],
				["exchange", hex("21"), hex("a1")],
			]);
			const session = await EvoXKernelSession.upload(
				fake.connection,
				artifacts,
			);
			await expect(session.writeRom(rom, () => {})).rejects.toThrow(/f2/);
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("restores diagnostics through the captured reset and cleanup sequence", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const fake = transcript([
				...startup(),
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
			]);
			const session = await EvoXKernelSession.upload(
				fake.connection,
				artifacts,
			);
			await session.restoreDiagnostics();
			await expect(session.readMemory(0, 1)).rejects.toThrow(/closed/);
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("rejects a commit CRC failure and retains recovery state, including against reset/dry-run", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const rom = image();
			const writes = blockWrites(rom, 0xbf000, 0x24);
			const commit = writes.at(-1);
			if (!commit) throw new Error("Missing commit fixture");
			commit[2] = hex("f5");
			const fake = transcript([
				...startup(),
				...negotiated(),
				...scan(rom, 15),
				["exchange", hex("20"), hex("a0")],
				["exchange", hex("25000b0000"), hex("a50001")],
				...writes,
				["exchange", hex("21"), hex("a1")],
			]);
			const session = await EvoXKernelSession.upload(
				fake.connection,
				artifacts,
			);
			await expect(session.writeRom(rom, () => {})).rejects.toThrow(/f5/);
			await expect(session.restoreDiagnostics()).rejects.toThrow(/recovery/);
			await expect(
				session.writeRom(rom, () => {}, { dryRun: true }),
			).rejects.toThrow(/real write retry/);
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("reports post-write CRC mismatch instead of resetting or declaring success", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const rom = image();
			const fake = transcript([
				...startup(),
				...negotiated(),
				...scan(rom, 15),
				["exchange", hex("20"), hex("a0")],
				["exchange", hex("25000b0000"), hex("a50001")],
				...blockWrites(rom, 0xbf000, 0x24),
				["exchange", hex("21"), hex("a1")],
				["exchange", hex("02000b000000010000"), hex("8200000000")],
			]);
			const session = await EvoXKernelSession.upload(
				fake.connection,
				artifacts,
			);
			await expect(session.writeRom(rom, () => {})).rejects.toThrow(
				/Post-write CRC/,
			);
			await expect(session.restoreDiagnostics()).rejects.toThrow(/recovery/);
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("preserves both flash and disable failures", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const rom = image();
			const fake = transcript([
				...startup(),
				...negotiated(),
				...scan(rom, 15),
				["exchange", hex("20"), hex("a0")],
				["exchange", hex("25000b0000"), hex("f2")],
				["exchange", hex("21"), new Error("adapter disconnected")],
			]);
			const session = await EvoXKernelSession.upload(
				fake.connection,
				artifacts,
			);
			await expect(session.writeRom(rom, () => {})).rejects.toMatchObject({
				errors: [
					expect.any(Error),
					expect.objectContaining({ message: "adapter disconnected" }),
				],
			});
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("blocks unconfigured or invalid writes before uploading", async () => {
		const { Mut3Protocol } = await import("../src/index.js");
		const fake = transcript([]);
		const protocol = new Mut3Protocol();
		await expect(
			protocol.writeRom(fake.connection, new Uint8Array(5), () => {}),
		).rejects.toThrow(/1 MiB/);
		await expect(
			protocol.writeRom(fake.connection, image(), () => {}),
		).rejects.toThrow(/bootstrap and kernel/);
		fake.exhausted();
	});
	it("preserves both non-erased blocks across an 8KB sector erase", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const rom = image();
			rom[0] = 0x42;
			rom[0x1000] = 0x77;
			new DataView(rom.buffer).setUint32(0xbfff0, mitsucanChecksum(rom));
			const fake = transcript([
				...startup(),
				...negotiated(),
				...scan(rom, 0),
				["exchange", hex("20"), hex("a0")],
				["exchange", hex("2500000000"), hex("a50001")],
				...blockWrites(rom, 0, 0x24),
				...blockWrites(rom, 0x1000, 0x24),
				["exchange", hex("21"), hex("a1")],
				[
					"exchange",
					hex("020000000000002000"),
					Uint8Array.from([0x82, ...u32(crc32(rom.slice(0, 0x2000)))]),
				],
			]);
			const session = await EvoXKernelSession.upload(
				fake.connection,
				artifacts,
			);
			await session.writeRom(rom, () => {});
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("retries diagnostic readiness after a reset drops an early request", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const steps = cleanup();
			steps.splice(1, 0, [
				"exchange",
				hex("1092"),
				new Error("reset request timed out"),
			]);
			const fake = transcript([...startup(), ...steps]);
			const session = await EvoXKernelSession.upload(
				fake.connection,
				artifacts,
			);
			await session.restoreDiagnostics();
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("recovers on a replacement connection without a pre-read or re-upload", async () => {
		const { Mut3Protocol } = await import("../src/index.js");
		const spy = acceptSyntheticArtifacts();
		try {
			const rom = image();
			const first = transcript([
				...startup(),
				...negotiated(),
				...scan(rom, 15),
				["exchange", hex("20"), hex("a0")],
				["exchange", hex("25000b0000"), hex("f2")],
				["exchange", hex("21"), hex("a1")],
			]);
			const protocol = new Mut3Protocol({
				loadKernelArtifacts: async () => artifacts,
			});
			await expect(
				protocol.writeRom(first.connection, rom, () => {}),
			).rejects.toThrow(/f2/);
			first.exhausted();
			const version = Uint8Array.from([
				0x81,
				...new TextEncoder().encode(
					"OpenECU Mitsubishi M32186 CAN Kernel V1.09\0",
				),
			]);
			const retry = transcript([
				["exchange", hex("01"), version],
				["exchange", hex("21"), hex("a1")],
				["exchange", hex("05"), hex("8500000408")],
				["exchange", hex("06"), hex("8600001000")],
				["exchange", hex("08"), hex("8800000001")],
				["exchange", hex("09ca9ea49e"), hex("89")],
				...scan(rom),
				...cleanup(),
			]);
			await protocol.writeRom(retry.connection, rom, () => {});
			retry.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
});
