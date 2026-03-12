/**
 * Tests for table-fs-uri.ts
 *
 * Tests the Virtual File System URI utilities for table URIs
 */

import { describe, expect, it } from "vitest";

import * as vscode from "vscode";
import {
	createTableUri,
	isTableUri,
	parseTableUri,
} from "../src/table-fs-uri.js";
import {
	normalizePath,
	RESOLVED_DEFINITION_FS_TABLE_URI,
	STANDARD_FS_TABLE_URI,
	WINDOWS_FS_TABLE_URI,
} from "./mocks/uri-fixtures.js";

describe("table-fs-uri", () => {
	describe("createTableUri", () => {
		it("creates a valid table URI with absolute path", () => {
			const uri = createTableUri(
				STANDARD_FS_TABLE_URI.romPath,
				STANDARD_FS_TABLE_URI.tableId,
				STANDARD_FS_TABLE_URI.tableName,
			);
			expect(uri.scheme).toBe("ecu-table");
			expect(normalizePath(uri.path)).toContain(
				normalizePath(STANDARD_FS_TABLE_URI.romPath),
			);
			// jest-mock-vscode might not encode spaces in path property depending on version/config
			expect(uri.toString()).toContain(
				encodeURIComponent(STANDARD_FS_TABLE_URI.tableName ?? ""),
			);
		});

		it("creates a valid table URI with relative path", () => {
			const romPath = "rom.hex";
			const uri = createTableUri(romPath, "boost-target-id", "Boost Target");
			expect(uri.scheme).toBe("ecu-table");
			expect(normalizePath(uri.path)).toContain(romPath);
			expect(uri.toString()).toContain("Boost%20Target");
		});

		it("preserves Windows absolute ROM paths without rebasing", () => {
			const uri = createTableUri(
				WINDOWS_FS_TABLE_URI.romPath,
				WINDOWS_FS_TABLE_URI.tableId,
				WINDOWS_FS_TABLE_URI.tableName,
			);

			expect(uri.scheme).toBe("ecu-table");
			expect(uri.path).toContain(
				vscode.Uri.file(WINDOWS_FS_TABLE_URI.romPath).path,
			);
			expect(uri.toString()).not.toContain("/apps/vscode/");
		});

		it("throws error if ROM path is empty", () => {
			expect(() => createTableUri("", "table-id", "Table")).toThrow(
				"ROM path is required",
			);
		});

		it("throws error if table ID is empty", () => {
			expect(() => createTableUri("/test/rom.hex", "", "Table")).toThrow(
				"Table ID is required",
			);
		});
	});

	describe("parseTableUri", () => {
		it("parses a valid table URI", () => {
			const romPath = "/Users/test/rom.hex";
			const uri = vscode.Uri.parse(`ecu-table://${romPath}?table=Fuel%20Map`);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(normalizePath(parsed?.romPath || "")).toBe(normalizePath(romPath));
			expect(parsed?.tableId).toBe("Fuel Map");
		});

		it("decodes URL-encoded table names", () => {
			const uri = vscode.Uri.parse(
				"ecu-table:///test/rom.hex?table=Fuel%20Map%20(High%20Octane)",
			);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(parsed?.tableId).toBe("Fuel Map (High Octane)");
		});

		it("supports table names containing slash", () => {
			const tableName = "Fuel/Timing Blend";
			const uri = createTableUri("/test/rom.hex", "fuel-timing-id", tableName);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(parsed?.tableName).toBe(tableName);
			expect(parsed?.tableId).toBe("fuel-timing-id");
		});

		it("parses legacy path-based URI format", () => {
			const uri = vscode.Uri.parse("ecu-table:///test/rom.hex/Fuel%20Map");
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(parsed?.tableId).toBe("Fuel Map");
		});

		it("returns null for non-table URI", () => {
			const uri = vscode.Uri.parse("file:///test/rom.hex");
			const parsed = parseTableUri(uri);

			expect(parsed).toBeNull();
		});
	});

	describe("isTableUri", () => {
		it("returns true for table URI", () => {
			const uri = vscode.Uri.parse("ecu-table:///test/rom.hex/Table");

			expect(isTableUri(uri)).toBe(true);
		});

		it("returns false for file URI", () => {
			const uri = vscode.Uri.parse("file:///test/rom.hex");

			expect(isTableUri(uri)).toBe(false);
		});

		it("returns false for http URI", () => {
			const uri = vscode.Uri.parse("http://example.com");

			expect(isTableUri(uri)).toBe(false);
		});
	});

	describe("round-trip", () => {
		it("creates and parses URI correctly", () => {
			const romPath = "/Users/test/rom.hex";
			const tableId = "fuel-map-id";
			const tableName = "Fuel Map";

			const uri = createTableUri(romPath, tableId, tableName);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(normalizePath(parsed?.romPath || "")).toBe(normalizePath(romPath));
			expect(parsed?.tableId).toBe(tableId);
			expect(parsed?.tableName).toBe(tableName);
		});

		it("handles special characters in round-trip", () => {
			const romPath = "/Users/test/rom.hex";
			const tableId = "fuel-map-high-octane-id";
			const tableName = "Fuel Map (High Octane) [Test]";

			const uri = createTableUri(romPath, tableId, tableName);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(parsed?.tableId).toBe(tableId);
			expect(parsed?.tableName).toBe(tableName);
		});

		it("round-trips Windows drive paths", () => {
			const uri = createTableUri(
				WINDOWS_FS_TABLE_URI.romPath,
				WINDOWS_FS_TABLE_URI.tableId,
				WINDOWS_FS_TABLE_URI.tableName,
			);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(parsed?.romPath).toBe(
				vscode.Uri.file(WINDOWS_FS_TABLE_URI.romPath).fsPath,
			);
			expect(parsed?.tableId).toBe(WINDOWS_FS_TABLE_URI.tableId);
			expect(parsed?.tableName).toBe(WINDOWS_FS_TABLE_URI.tableName);
		});

		it("preserves resolved definition identity in the query", () => {
			const uri = createTableUri(
				RESOLVED_DEFINITION_FS_TABLE_URI.romPath,
				RESOLVED_DEFINITION_FS_TABLE_URI.tableId,
				RESOLVED_DEFINITION_FS_TABLE_URI.tableName,
				RESOLVED_DEFINITION_FS_TABLE_URI.definitionUri,
			);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(parsed?.tableId).toBe(RESOLVED_DEFINITION_FS_TABLE_URI.tableId);
			expect(parsed?.tableName).toBe(
				RESOLVED_DEFINITION_FS_TABLE_URI.tableName,
			);
			expect(parsed?.definitionUri).toBe(
				RESOLVED_DEFINITION_FS_TABLE_URI.definitionUri,
			);
			expect(uri.query).toContain("definition=");
		});

		it("round-trips duplicate display names via stable table ids", () => {
			const uri = createTableUri(
				"/Users/test/rom.hex",
				"Shared Label::Fuel::0x1000",
				"Shared Label",
			);
			const parsed = parseTableUri(uri);

			expect(parsed).not.toBeNull();
			expect(parsed?.tableId).toBe("Shared Label::Fuel::0x1000");
			expect(parsed?.tableName).toBe("Shared Label");
		});
	});
});
