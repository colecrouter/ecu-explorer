import { describe, expect, it } from "vitest";
import {
	detectLogFormat,
	getDefaultOutputPath,
	normalizeEvoScanCsv,
	renderNormalizedCsv,
} from "./normalize-log.js";

describe("normalize-log", () => {
	const sampleCsv = [
		"LogID,LogEntryDate,LogEntryTime,LogEntrySeconds,LogNotes,2ByteRPM,AFR,WGDC_Active,Battery,Baro,PSIG,Load,Speed",
		"1,2026-03-15,22:34:39.62814,0.22742,,1054.6875,14.7,35.2,14.5,96.5,-39.95,1.5,42",
		"2,2026-03-15,22:34:39.72191,0.32444,,1200,14.4,40.1,14.4,98.2,-33.30,1.7,44",
		"",
	].join("\n");

	it("detects EvoScan headers", () => {
		expect(
			detectLogFormat([
				"LogID",
				"LogEntryDate",
				"LogEntryTime",
				"LogEntrySeconds",
			]),
		).toBe("evoscan");
	});

	it("normalizes EvoScan logs into native CSV parts", () => {
		const normalized = normalizeEvoScanCsv(sampleCsv);

		expect(normalized.headers).toEqual([
			"Timestamp (ms)",
			"2ByteRPM",
			"AFR",
			"WGDC_Active",
			"Battery",
			"Baro",
			"Load",
			"Speed",
		]);
		expect(normalized.units).toEqual([
			"Unit",
			"rpm",
			"afr",
			"%",
			"V",
			"kPa",
			"g/rev",
			"km/h",
		]);
		expect(normalized.rows[0]).toEqual([
			"227",
			"1054.6875",
			"14.7",
			"35.2",
			"14.5",
			"96.5",
			"1.5",
			"42",
		]);
		expect(normalized.rows[1]).toEqual([
			"324",
			"1200",
			"14.4",
			"40.1",
			"14.4",
			"98.2",
			"1.7",
			"44",
		]);
	});

	it("renders normalized CSV text", () => {
		const rendered = renderNormalizedCsv(normalizeEvoScanCsv(sampleCsv));

		expect(rendered).toContain(
			"Timestamp (ms),2ByteRPM,AFR,WGDC_Active,Battery,Baro,Load,Speed",
		);
		expect(rendered).toContain("Unit,rpm,afr,%,V,kPa,g/rev,km/h");
		expect(rendered).toContain("227,1054.6875,14.7,35.2,14.5,96.5,1.5,42");
	});

	it("derives a default output path beside the input file", () => {
		expect(getDefaultOutputPath("/tmp/evoscan.csv")).toBe(
			"/tmp/evoscan.ecu-explorer.csv",
		);
	});
});
