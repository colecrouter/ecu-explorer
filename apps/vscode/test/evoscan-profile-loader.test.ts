import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { EvoScanProfileLoader } from "../src/evoscan-profile-loader.js";

const xml = (formula: string) =>
	`<EvoScanDataLogger><vehicle name="EvoX"><ecu name="LoadTrace"><Mode2><DataListItem Display="RPM" LogReference="RPM" RequestID="2380878C" ResponseBytes="2" Eval="${formula}" DataLog="Y" /></Mode2></ecu></vehicle></EvoScanDataLogger>`;
describe("EvoScan workspace discovery", () => {
	afterEach(() => vi.restoreAllMocks());
	it("loads linked DataSettings, reloads edits and isolates invalid files", async () => {
		const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "ecu-evoscan-"));
		try {
			const root = path.join(sandbox, "workspace"),
				shared = path.join(sandbox, "shared");
			await fs.mkdir(root);
			await fs.mkdir(shared);
			await fs.symlink(
				shared,
				path.join(root, "DataSettings"),
				process.platform === "win32" ? "junction" : "dir",
			);
			const file = path.join(shared, "load.xml");
			await fs.writeFile(file, xml("x*2"));
			await fs.writeFile(path.join(shared, "bad.xml"), "<broken>");
			vi.spyOn(vscode.workspace, "workspaceFolders", "get").mockReturnValue([
				{ uri: vscode.Uri.file(root), name: "ECU", index: 0 },
			]);
			vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
				get: <T>(_key: string, defaultValue?: T) => defaultValue as T,
				has: () => false,
				inspect: () => undefined,
				update: async () => {},
			});
			vi.mocked(vscode.workspace.fs.stat).mockImplementation(async (uri) => {
				const stat = await fs.stat(uri.fsPath);
				return {
					type: stat.isDirectory()
						? vscode.FileType.Directory
						: vscode.FileType.File,
					ctime: 0,
					mtime: stat.mtimeMs,
					size: stat.size,
				};
			});
			vi.mocked(vscode.workspace.fs.readDirectory).mockImplementation(
				async (uri) =>
					(await fs.readdir(uri.fsPath, { withFileTypes: true })).map(
						(entry) => [
							entry.name,
							entry.isDirectory()
								? vscode.FileType.Directory
								: vscode.FileType.File,
						],
					),
			);
			vi.mocked(vscode.workspace.fs.readFile).mockImplementation(
				async (uri) => new Uint8Array(await fs.readFile(uri.fsPath)),
			);
			const diagnostics: string[] = [];
			const loader = new EvoScanProfileLoader((message) =>
				diagnostics.push(message),
			);
			const first = await loader.load();
			expect(first).toHaveLength(1);
			expect(first[0]?.channels[0]?.evaluate(5, new Map())).toBe(10);
			await fs.writeFile(file, xml("x*3"));
			const second = await loader.load();
			expect(second[0]?.descriptor.id).toBe(first[0]?.descriptor.id);
			expect(second[0]?.descriptor.revision).not.toBe(
				first[0]?.descriptor.revision,
			);
			expect(second[0]?.channels[0]?.evaluate(5, new Map())).toBe(15);
			expect(first[0]?.channels[0]?.evaluate(5, new Map())).toBe(10);
			expect(
				diagnostics.some(
					(message) =>
						message.includes("bad.xml") &&
						message.includes("Invalid EvoScan XML"),
				),
			).toBe(true);
		} finally {
			await fs.rm(sandbox, { recursive: true, force: true });
		}
	});
});
