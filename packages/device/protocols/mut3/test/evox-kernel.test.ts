import { describe, expect, it, vi } from "vitest";
import { EvoXKernelSession } from "../src/evox-kernel.js";
import { Mut3Protocol } from "../src/index.js";
import { computeFlashSecurityKey } from "../src/security.js";
import { FLASH_SECURITY_PAIRS } from "./flash-security-fixtures.js";
import {
	acceptSyntheticArtifacts,
	artifacts,
	cleanup,
	startup,
	transcript,
} from "./kernel-transcript.js";

const hex = (value: string) =>
	Uint8Array.from(value.match(/../g) ?? [], (byte) =>
		Number.parseInt(byte, 16),
	);

describe("captured Evo X factory unlock", () => {
	it("matches all 157 distinct captured factory seed/key pairs", () => {
		for (const [seed, key] of FLASH_SECURITY_PAIRS)
			expect(computeFlashSecurityKey(hex(seed)), seed).toEqual(hex(key));
	});
	it.each([
		["8fb2cef1", "481420cb"],
		["367110ac", "844b4dde"],
		["7b37688a", "524153ac"],
		["9872fab1", "f6d48a8b"],
	])("maps %s to the recorded accepted key %s", (seed, key) => {
		expect(computeFlashSecurityKey(hex(seed))).toEqual(hex(key));
	});
	it("rejects the older two-byte seed", () =>
		expect(() => computeFlashSecurityKey(hex("1234"))).toThrow(RangeError));
});

describe("Evo X kernel upload", () => {
	it("uploads without waiting for per-chunk replies, verifies version and unlocks kernel", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const fake = transcript([
				...startup(),
				["exchange", hex("08"), hex("88427cae0b")],
				["exchange", hex("09d13ebbac"), hex("89")],
			]);
			const session = await EvoXKernelSession.upload(
				fake.connection,
				artifacts,
			);
			expect(session.version).toBe(
				"OpenECU Mitsubishi M32186 CAN Kernel V1.09",
			);
			await session.unlock();
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("rejects incompatible artifacts before touching the ECU", async () => {
		const fake = transcript([]);
		await expect(
			EvoXKernelSession.upload(fake.connection, {
				...artifacts,
				bootstrap: new Uint8Array(207),
			}),
		).rejects.toThrow(/208/);
		await expect(
			EvoXKernelSession.upload(fake.connection, artifacts),
		).rejects.toThrow(/SHA-256/);
		fake.exhausted();
	});
	it("does not proceed after a factory unlock rejection", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const steps = startup().slice(0, 5);
			steps[4] = ["exchange", hex("2706481420cb"), hex("7f2735")];
			const fake = transcript(steps);
			await expect(
				EvoXKernelSession.upload(fake.connection, artifacts),
			).rejects.toThrow(/7f2735/);
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("rejects a different version after upload", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const steps = startup();
			steps[steps.length - 1] = [
				"exchange",
				hex("01"),
				Uint8Array.from([0x81, ...new Uint8Array(43)]),
			];
			const fake = transcript(steps);
			await expect(
				EvoXKernelSession.upload(fake.connection, artifacts),
			).rejects.toThrow(/version/);
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
});

describe("Evo X kernel readback", () => {
	it("rejects invalid regions before any read/unlock traffic and requires complete replies", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const fake = transcript([
				...startup(),
				["exchange", hex("08"), hex("88427cae0b")],
				["exchange", hex("09d13ebbac"), hex("89")],
				["exchange", hex("03000000000004"), hex("831234")],
			]);
			const session = await EvoXKernelSession.upload(
				fake.connection,
				artifacts,
			);
			for (const [address, length] of [
				[-1, 1],
				[0, 0],
				[0, 1025],
				[0x100000, 1],
				[0.5, 1],
				[0, 1.5],
			])
				await expect(
					session.readMemory(address as number, length as number),
				).rejects.toThrow(RangeError);
			await expect(session.readMemory(0, 4)).rejects.toThrow(
				/Unexpected Evo X reply/,
			);
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("uses the configured MUT-III path to return a complete 1 MiB ROM", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const steps = [
				...startup(),
				["exchange", hex("08"), hex("88427cae0b")],
				["exchange", hex("09d13ebbac"), hex("89")],
			] as Array<
				["exchange" | "send" | "receive", Uint8Array, Uint8Array | Error]
			>;
			for (let block = 0; block < 1024; block++) {
				const addr = block * 1024;
				const request = Uint8Array.from([
					3,
					0,
					addr >>> 16,
					(addr >>> 8) & 255,
					addr & 255,
					4,
					0,
				]);
				steps.push([
					"exchange",
					request,
					Uint8Array.from([0x83, ...new Uint8Array(1024).fill(block & 255)]),
				]);
			}
			steps.push(...cleanup());
			const fake = transcript(steps);
			const progress = vi.fn();
			const protocol = new Mut3Protocol({
				loadKernelArtifacts: async () => artifacts,
			});
			const rom = await protocol.readRom(fake.connection, progress);
			expect(rom).toHaveLength(0x100000);
			expect(rom.slice(1024, 2048)).toEqual(new Uint8Array(1024).fill(1));
			expect(rom.slice(-1024)).toEqual(new Uint8Array(1024).fill(255));
			expect(progress.mock.lastCall?.[0]).toMatchObject({
				phase: "reading",
				bytesProcessed: 0x100000,
				percentComplete: 100,
			});
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
	it("propagates a transmit failure and never queries a partially uploaded kernel", async () => {
		const spy = acceptSyntheticArtifacts();
		try {
			const steps = startup().slice(0, 17);
			steps[16] = [
				"send",
				artifacts.kernel.slice(0, 251),
				new Error("ISO-TP transmission timed out"),
			];
			const fake = transcript(steps);
			await expect(
				EvoXKernelSession.upload(fake.connection, artifacts),
			).rejects.toThrow(/transmission timed out/);
			fake.exhausted();
		} finally {
			spy.mockRestore();
		}
	});
});

describe("MUT-III operation exclusion", () => {
	it("rejects ROM upload while a live-data request is still in flight, even after stop", async () => {
		const fake = transcript([]);
		fake.connection.sendFrame = () => new Promise<Uint8Array>(() => {});
		const protocol = new Mut3Protocol({
			loadKernelArtifacts: async () => artifacts,
		});
		const logging = protocol.streamLiveData(
			fake.connection,
			[0x8000],
			() => {},
		);
		await expect(protocol.readRom(fake.connection, () => {})).rejects.toThrow(
			/live logging/,
		);
		logging.stop();
		await expect(protocol.readRom(fake.connection, () => {})).rejects.toThrow(
			/live logging/,
		);
	});
	it("rejects a second read or live-data session while a ROM read owns the connection", async () => {
		const fake = transcript([]);
		const protocol = new Mut3Protocol({
			loadKernelArtifacts: () => new Promise(() => {}),
		});
		void protocol.readRom(fake.connection, () => {});
		await expect(protocol.readRom(fake.connection, () => {})).rejects.toThrow(
			/ROM read/,
		);
		expect(() =>
			protocol.streamLiveData(fake.connection, [0x8000], () => {}),
		).toThrow(/ROM read/);
		fake.exhausted();
	});
});
