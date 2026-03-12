import type { Edit, EditTransaction } from "@ecu-explorer/ui";
import { describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { VsCodeHistoryExecutor } from "../src/history/vscode-history-executor.js";
import { RomDocument } from "../src/rom/document.js";

type TestEdit = Edit<Uint8Array>;

function makeDocument(bytes: number[]): RomDocument {
	return new RomDocument(
		vscode.Uri.file("/test/rom.bin"),
		new Uint8Array(bytes),
	);
}

function makeTransaction(
	label: string,
	edits: Array<{ address: number; before: number[]; after: number[] }>,
): EditTransaction<TestEdit> {
	return {
		label,
		timestamp: Date.now(),
		edits: edits.map((edit) => ({
			address: edit.address,
			before: new Uint8Array(edit.before),
			after: new Uint8Array(edit.after),
		})),
	};
}

describe("VsCodeHistoryExecutor", () => {
	it("applies transaction bytes and marks the document dirty away from the save point", () => {
		const document = makeDocument([0x10, 0x20, 0x30, 0x40]);
		const executor = new VsCodeHistoryExecutor(document.romBytes, document);
		const transaction = makeTransaction("edit", [
			{ address: 1, before: [0x20], after: [0xee] },
		]);

		const result = executor.apply(transaction);

		expect(Array.from(document.romBytes)).toEqual([0x10, 0xee, 0x30, 0x40]);
		expect(document.isDirty).toBe(true);
		expect(result.range).toEqual({ offset: 1, length: 1 });
	});

	it("reverts transaction bytes in reverse order", () => {
		const document = makeDocument([0x10, 0xee, 0xff, 0x40]);
		const executor = new VsCodeHistoryExecutor(document.romBytes, document);
		const transaction = makeTransaction("batch", [
			{ address: 1, before: [0x20], after: [0xee] },
			{ address: 2, before: [0x30], after: [0xff] },
		]);

		const result = executor.revert(transaction);

		expect(Array.from(document.romBytes)).toEqual([0x10, 0x20, 0x30, 0x40]);
		expect(document.isDirty).toBe(true);
		expect(result.range).toEqual({ offset: 1, length: 2 });
	});

	it("keeps the document clean when applying at the save point", () => {
		const document = makeDocument([0x10, 0x20, 0x30, 0x40]);
		document.makeDirty();

		const executor = new VsCodeHistoryExecutor(document.romBytes, document);
		const transaction = makeTransaction("edit", [
			{ address: 1, before: [0x20], after: [0x20] },
		]);

		executor.apply(transaction, { atSavePoint: true });

		expect(document.isDirty).toBe(false);
	});

	it("returns null range for an empty transaction", () => {
		const document = makeDocument([0x10, 0x20, 0x30, 0x40]);
		const executor = new VsCodeHistoryExecutor(document.romBytes, document);
		const transaction = makeTransaction("empty", []);

		const result = executor.apply(transaction);

		expect(result.range).toBeNull();
	});
});
