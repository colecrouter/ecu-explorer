import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { readEcuRomSnapshot } from "../src/rom/ecu-snapshot.js";

describe("ECU comparison snapshot", () => {
	it("waits for polling to settle, reads once, resumes and saves a binary snapshot", async () => {
		const events: string[] = [];
		const read = vi.fn(async () => {
			events.push("read");
			return Uint8Array.of(1, 2, 3);
		});
		const suspend = async () => {
			await Promise.resolve();
			events.push("settled");
			return () => {
				events.push("resume");
			};
		};
		vi.spyOn(vscode.workspace.fs, "createDirectory").mockResolvedValue();
		const write = vi
			.spyOn(vscode.workspace.fs, "writeFile")
			.mockResolvedValue();
		vi.spyOn(vscode.window, "withProgress").mockImplementation(
			async (_options, task) =>
				task({ report: vi.fn() }, {} as vscode.CancellationToken),
		);
		const result = await readEcuRomSnapshot({
			directory: vscode.Uri.file("/workspace/ECU Snapshots"),
			read,
			suspend,
		});
		expect(events).toEqual(["settled", "read", "resume"]);
		expect(read).toHaveBeenCalledTimes(1);
		expect(result.uri.fsPath).toMatch(/ECU Snapshots.*ecu-.*\.bin$/);
		expect(write).toHaveBeenCalledWith(result.uri, Uint8Array.of(1, 2, 3));
	});
	it("restores polling on read failure and saves nothing", async () => {
		const resume = vi.fn();
		const write = vi.spyOn(vscode.workspace.fs, "writeFile");
		await expect(
			readEcuRomSnapshot({
				directory: vscode.Uri.file("/snapshots"),
				suspend: async () => resume,
				read: async () => {
					throw new Error("read failed");
				},
			}),
		).rejects.toThrow("read failed");
		expect(resume).toHaveBeenCalledOnce();
		expect(write).not.toHaveBeenCalled();
	});
});
