import { describe, expect, it, vi } from "vitest";
import {
	compileEvoScanProfiles,
	streamEvoScanProfile,
} from "../src/evoscan-runtime.js";
import { Mut3Protocol } from "../src/index.js";
import { transcript } from "./kernel-transcript.js";

const xml = (items: string, name = "USDM") =>
	`<EvoScanDataLogger><vehicle name="EvoX"><ecu name="${name}"><Mode2>${items}</Mode2></ecu></vehicle></EvoScanDataLogger>`;
const item = (ref: string, request: string, formula = "x", extra = "") =>
	`<DataListItem Display="${ref}" LogReference="${ref}" RequestID="${request}" ResponseBytes="2" Eval="${formula}" DataLog="Y" ${extra}/>`;

describe("EvoScan executable profiles", () => {
	it("honours signed responses and original units without selecting DataLog=N channels", () => {
		const text = xml(
			item(
				"Temperature",
				"2380867F",
				"x*1.8-40",
				'Signed="true" MetricEval="x-40" MetricUnit="C" Unit="F"',
			).replace('DataLog="Y"', 'DataLog="N"'),
		);
		const profile = compileEvoScanProfiles(text, "signed", "original")[0];
		expect(profile?.channels[0]?.evaluate(65535, new Map())).toBeCloseTo(-41.8);
		expect(profile?.channels[0]?.unit).toBe("F");
		expect(profile?.descriptor.defaultPids).toEqual([]);
	});
	it("does not route alternate ECU profiles to the engine controller", () => {
		const profile = compileEvoScanProfiles(
			xml(item("Pump", "23801234"), "EVOX AYC-ACD-SAWC"),
			"ayc",
		)[0];
		expect(profile?.descriptor.status).toBe("unavailable");
		expect(profile?.issues[0]).toContain("Alternate ECU");
	});

	it("uses full Mode23 addresses on the wire and exposes imported profiles", async () => {
		const profiles = compileEvoScanProfiles(
			xml(item("Flash", "23026714")),
			"file:///CodeCheck.xml",
		);
		const profile = profiles[0];
		if (!profile) throw new Error("Missing profile");
		const fake = transcript([
			[
				"exchange",
				Uint8Array.of(0x23, 0x02, 0x67, 0x14, 2),
				Uint8Array.of(0x63, 0x01, 0xf4),
			],
		]);
		const protocol = new Mut3Protocol({
			loadLoggingProfiles: async () => profiles,
		});
		expect((await protocol.getLiveDataProfiles(fake.connection))[0]?.id).toBe(
			profile.descriptor.id,
		);
		const values: number[] = [];
		const session = protocol.streamLiveData(
			fake.connection,
			{
				profileId: profile.descriptor.id,
				pids: profile.channels.map((channel) => channel.pid),
			},
			(frame) => {
				values.push(frame.value);
				session.stop();
			},
		);
		await session.completion;
		expect(values).toEqual([500]);
		fake.exhausted();
	});

	it("retains immutable decode rules for an active stream while profiles reload", async () => {
		let profiles = compileEvoScanProfiles(
			xml(item("RPM", "2380878C", "x*2")),
			"file:///same.xml",
		);
		const profile = profiles[0];
		if (!profile) throw new Error("Missing profile");
		const fake = transcript([
			[
				"exchange",
				Uint8Array.of(0x23, 0x80, 0x87, 0x8c, 2),
				Uint8Array.of(0x63, 0, 10),
			],
		]);
		const protocol = new Mut3Protocol({
			loadLoggingProfiles: async () => profiles,
		});
		await protocol.getLiveDataProfiles(fake.connection);
		const values: number[] = [];
		const session = protocol.streamLiveData(
			fake.connection,
			{
				profileId: profile.descriptor.id,
				pids: profile.channels.map((channel) => channel.pid),
			},
			(frame) => {
				values.push(frame.value);
				session.stop();
			},
		);
		profiles = compileEvoScanProfiles(
			xml(item("RPM", "2380878C", "x*3")),
			"file:///same.xml",
		);
		await protocol.getLiveDataProfiles(fake.connection);
		await session.completion;
		expect(values).toEqual([20]);
		fake.exhausted();
	});

	it("does not reuse a prior cycle's dependency after its read fails", async () => {
		const profile = compileEvoScanProfiles(
			xml(item("Raw", "23800001") + item("Result", "CALC", "[Raw]*2")),
			"test",
		)[0];
		if (!profile) throw new Error("Missing profile");
		const result = profile.channels.find(
			(channel) => channel.name === "Result",
		);
		if (!result) throw new Error("Missing result");
		let count = 0;
		const frames: number[] = [];
		let stop = () => {};
		let complete!: () => void;
		const done = new Promise<void>((resolve) => {
			complete = resolve;
		});
		const errors = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			const session = streamEvoScanProfile(
				profile,
				[result.pid],
				async () => {
					await Promise.resolve();
					count++;
					if (count === 2) throw new Error("Read failed");
					if (count === 3) stop();
					return 10;
				},
				(frame) => frames.push(frame.value),
				undefined,
				complete,
			);
			stop = () => session.stop();
			await done;
			expect(frames).toEqual([20]);
		} finally {
			errors.mockRestore();
		}
	});

	it("loads variants, full addresses, metric formulas, defaults and stable identities", () => {
		const text = xml(
			item("RPM", "2380878C", "x*3.90625") +
				item(
					"Temp",
					"2380867F",
					"x*1.8-40",
					'MetricEval="x-40" MetricUnit="C"',
				),
		);
		const profile = compileEvoScanProfiles(
			text,
			"file:///DataSettings/test.xml",
		)[0];
		expect(profile?.channels[0]?.request).toEqual({
			kind: "mode23",
			address: 0x80878c,
			size: 2,
		});
		expect(profile?.channels[1]?.evaluate(80, new Map())).toBe(40);
		expect(profile?.descriptor.defaultPids).toHaveLength(2);
		const reordered = compileEvoScanProfiles(
			xml(item("Temp", "2380867F") + item("RPM", "2380878C")),
			"file:///DataSettings/test.xml",
		)[0];
		expect(reordered?.channels.find((c) => c.name === "RPM")?.pid).toBe(
			profile?.channels[0]?.pid,
		);
		expect(
			compileEvoScanProfiles(text, "file:///DataSettings/other.xml")[0]
				?.descriptor.id,
		).not.toBe(profile?.descriptor.id);
	});
	it("compiles channel references and RAX BITS without executing JavaScript", () => {
		const profile = compileEvoScanProfiles(
			xml(
				item("RAX", "238051AC", "x") +
					item("Trim", "CALC", "[RAX]BITS(32,8)*0.1953125-25"),
			),
			"test",
		)[0];
		const raw = profile?.channels.find((c) => c.name === "RAX"),
			trim = profile?.channels.find((c) => c.name === "Trim");
		if (!raw || !trim) throw new Error("Missing channels");
		expect(trim.dependencies).toEqual([raw.pid]);
		expect(trim.evaluate(0, new Map([[raw.pid, 0x80000000]]))).toBe(0);
		const invalid = compileEvoScanProfiles(
			xml(item("Bad", "23800001", "x.constructor()")),
			"bad",
		)[0];
		expect(invalid?.descriptor.status).toBe("unavailable");
		expect(invalid?.issues).not.toHaveLength(0);
		const invalidBits = compileEvoScanProfiles(
			xml(item("Raw", "23800001") + item("Bad bits", "CALC", "[Raw]BITS(2,8)")),
			"bad-bits",
		)[0];
		expect(invalidBits?.issues[0]).toContain("Invalid BITS range");
		expect(invalidBits?.channels.map((channel) => channel.name)).toEqual([
			"Raw",
		]);
	});
	it("reports cycles and unsupported channels instead of silently logging raw values", () => {
		const profile = compileEvoScanProfiles(
			xml(
				item("A", "CALC", "[B]") +
					item("B", "CALC", "[A]") +
					item("CAN", "CAN10-1") +
					item("WDB", "WDB"),
			),
			"cycles",
		)[0];
		expect(profile?.descriptor.status).toBe("unavailable");
		expect(profile?.issues.length).toBe(4);
	});
	it("reads dependencies once and emits only requested calculated channels", async () => {
		const profile = compileEvoScanProfiles(
			xml(
				item("Baro", "2380AB0D", "x/2") +
					item("Pressure", "2380875E", "x*0.3326271-[Baro]") +
					item("MAP", "2380875E", "x"),
			),
			"test",
		)[0];
		if (!profile) throw new Error("Missing profile");
		const pressure = profile.channels.find((c) => c.name === "Pressure"),
			map = profile.channels.find((c) => c.name === "MAP");
		if (!pressure || !map) throw new Error("Missing requested channels");
		const reads: number[] = [];
		const frames: { pid: number; value: number }[] = [];
		let stop = () => {};
		let complete!: () => void;
		const done = new Promise<void>((r) => {
			complete = r;
		});
		const session = streamEvoScanProfile(
			profile,
			[pressure.pid, map.pid],
			async (address) => {
				await Promise.resolve();
				reads.push(address);
				return address === 0x80ab0d ? 200 : 600;
			},
			(frame) => {
				frames.push(frame);
				if (frames.length === 2) stop();
			},
			undefined,
			complete,
		);
		stop = () => session.stop();
		await done;
		expect(reads).toEqual([0x80ab0d, 0x80875e]);
		expect(frames.map((f) => f.pid)).toEqual([pressure.pid, map.pid]);
		expect(frames[0]?.value).toBeCloseTo(99.57626);
	});
});
