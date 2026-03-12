import type { TableDefinition } from "@ecu-explorer/core";
import { describe, expect, it, vi } from "vitest";
import {
	postRedoIntent,
	postUndoIntent,
	rebuildTableViewFromHostUpdate,
} from "../src/webview/table-host-sync.js";

const TABLE_DEF: TableDefinition = {
	id: "test-table",
	name: "Test Table",
	kind: "table1d",
	rows: 4,
	z: {
		id: "test-table-z",
		name: "Values",
		address: 0,
		dtype: "u8",
	},
} as TableDefinition;

describe("table-host-sync", () => {
	it("posts undo intent without using client-side committed history", () => {
		const postMessage = vi.fn();

		postUndoIntent({ postMessage });

		expect(postMessage).toHaveBeenCalledWith({ type: "undo" });
	});

	it("posts redo intent without using client-side committed history", () => {
		const postMessage = vi.fn();

		postRedoIntent({ postMessage });

		expect(postMessage).toHaveBeenCalledWith({ type: "redo" });
	});

	it("rebuilds a fresh table view from the host ROM update", () => {
		const constructorSpy = vi.fn();

		class FakeTableView {
			constructor(
				public readonly rom: Uint8Array,
				public readonly definition: TableDefinition,
			) {
				constructorSpy(rom, definition);
			}
		}

		const rom = new Uint8Array([0x10, 0x20, 0x30, 0x40]);
		const tableView = rebuildTableViewFromHostUpdate(
			FakeTableView,
			TABLE_DEF,
			rom,
		);

		expect(tableView.rom).toBe(rom);
		expect(tableView.definition).toBe(TABLE_DEF);
		expect(constructorSpy).toHaveBeenCalledWith(rom, TABLE_DEF);
	});
});
