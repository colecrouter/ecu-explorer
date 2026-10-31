import type { ROMDefinition, TableDefinition } from "@ecu-explorer/core";
import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { RomComparisonController } from "../src/commands/compare-roms.js";
import {
	buildRomComparison,
	captureRomSnapshot,
} from "../src/rom/comparison.js";

const table = (name: string, address: number): TableDefinition => ({
	id: name,
	name,
	kind: "table1d",
	rows: 2,
	z: { id: name, name, address, dtype: "u8", endianness: "be", length: 2 },
});
const definition: ROMDefinition = {
	uri: "file:///definition.xml",
	name: "Test ECU",
	platform: {},
	fingerprints: [],
	tables: [table("Fuel", 0), table("Timing", 2)],
};
const snapshot = (
	label: string,
	bytes = Uint8Array.of(1, 2, 3, 4),
	def = definition,
) => captureRomSnapshot(vscode.Uri.file(`/${label}.bin`), bytes, def, label);

describe("ROM comparison", () => {
	it("captures unsaved bytes without retaining the mutable editor buffer", () => {
		const bytes = Uint8Array.of(9, 2, 3, 4);
		const active = snapshot("Active (unsaved)", bytes);
		bytes[0] = 1;
		const comparison = buildRomComparison(snapshot("Saved"), active);
		expect(
			comparison.tables.find((t) => t.name === "Fuel")?.metrics?.cellsChanged,
		).toBe(1);
		expect(
			comparison.tables.find((t) => t.name === "Fuel")?.targetSnapshot
				?.values[0]?.[0],
		).toBe(9);
	});
	it("reports missing, incompatible and unreadable tables without hiding other changes", () => {
		const modified = {
			...definition,
			tables: [
				{ ...table("Fuel", 0), rows: 1 },
				table("New", 0),
				table("Outside ROM", 100),
			],
		};
		const comparison = buildRomComparison(
			snapshot("Base"),
			snapshot("Target", Uint8Array.of(2, 2, 3, 4), modified),
		);
		expect(comparison.tables.map((t) => [t.name, t.status])).toEqual(
			expect.arrayContaining([
				["Fuel", "incompatible"],
				["Timing", "base_only"],
				["New", "target_only"],
				["Outside ROM", "target_only"],
			]),
		);
		const unreadable = buildRomComparison(
			snapshot("Base", undefined, modified),
			snapshot("Target", undefined, modified),
		);
		expect(
			unreadable.tables.find((t) => t.name === "Outside ROM")
				?.incompatibilityReason,
		).toBeTruthy();
	});
	it("does not silently collapse duplicate display names", () => {
		const duplicates = {
			...definition,
			tables: [table("Fuel", 0), { ...table("Fuel", 2), id: "other" }],
		};
		const comparison = buildRomComparison(
			snapshot("Base", undefined, duplicates),
			snapshot("Target", undefined, duplicates),
		);
		expect(comparison.tables.find((t) => t.name === "Fuel")?.status).toBe(
			"incompatible",
		);
		expect(
			comparison.tables.find((t) => t.name === "Fuel")?.incompatibilityReason,
		).toContain("Duplicate");
	});
	it("rejects different ROM sizes", () => {
		expect(() =>
			buildRomComparison(
				snapshot("Base"),
				snapshot("Target", Uint8Array.of(1)),
			),
		).toThrow(/size/i);
	});
	it.each([
		"saved-saved",
		"active-saved",
		"saved-ecu",
		"active-ecu",
	] as const)("opens the requested sources for %s", async (mode) => {
		const selected = snapshot("Saved"),
			active = snapshot("Active"),
			ecu = snapshot("ECU");
		const show = vi.fn();
		const controller = new RomComparisonController({
			selectSaved: vi.fn(async () => selected),
			getActive: () => active,
			readEcu: vi.fn(async () => ecu),
			show,
		});
		await controller.compare(mode);
		expect(show).toHaveBeenCalledWith(
			mode.endsWith("ecu") ? ecu : selected,
			mode.startsWith("active") ? active : selected,
		);
	});
	it("does not contact the ECU after cancelling file selection", async () => {
		const readEcu = vi.fn();
		const show = vi.fn();
		const controller = new RomComparisonController({
			selectSaved: async () => undefined,
			getActive: () => undefined,
			readEcu,
			show,
		});
		await controller.compare("saved-ecu");
		expect(readEcu).not.toHaveBeenCalled();
		expect(show).not.toHaveBeenCalled();
	});
	it("does not read the ECU when there is no active ROM", async () => {
		const readEcu = vi.fn();
		const controller = new RomComparisonController({
			selectSaved: async () => undefined,
			getActive: () => undefined,
			readEcu,
			show: vi.fn(),
		});
		await expect(controller.compare("active-ecu")).rejects.toThrow(
			/active ROM/i,
		);
		expect(readEcu).not.toHaveBeenCalled();
	});
});
