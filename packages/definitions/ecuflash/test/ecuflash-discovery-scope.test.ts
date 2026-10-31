import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { planRomDefinitionResolution } from "@ecu-explorer/core";
import { describe, expect, it, vi } from "vitest";
import { EcuFlashProvider } from "../src/index.js";

const scope = vi.hoisted(() => ({
	allowedDirectory: "",
	unrelatedDirectories: [] as string[],
}));

// Model unrelated directories that are unavailable, as with offline cloud folders.
vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return {
		...actual,
		readdir: (...args: Parameters<typeof actual.readdir>) => {
			const directory = String(args[0]);
			if (scope.allowedDirectory && directory !== scope.allowedDirectory) {
				scope.unrelatedDirectories.push(directory);
				return Promise.reject(
					new Error("Unrelated cloud directory unavailable"),
				);
			}
			return actual.readdir(...args);
		},
	};
});

const baseDefinition = `<rom>
<romid><xmlid>56890313</xmlid><internalidaddress>0</internalidaddress><internalidhex>56890313</internalidhex></romid>
<scaling name="byte" units="raw" toexpr="x" storagetype="uint8" endian="big" />
<table name="Example" type="1D" address="0" scaling="byte" />
</rom>`;

describe("definition discovery scope", () => {
	it("resolves case-insensitive include filenames with an XML extension", async () => {
		const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-case-"));
		try {
			await fs.writeFile(
				path.join(sandbox, "renamed-base.xml"),
				baseDefinition,
			);
			const child = path.join(sandbox, "child.xml");
			await fs.writeFile(
				child,
				"<rom><romid><xmlid>child</xmlid></romid><include>RENAMED-BASE.XML</include></rom>",
			);
			const definition = await new EcuFlashProvider([sandbox]).parse(
				pathToFileURL(child).toString(),
			);
			expect(definition.tables.map((table) => table.name)).toEqual(["Example"]);
		} finally {
			await fs.rm(sandbox, { recursive: true, force: true });
		}
	});
	it("resolves a sibling's xmlid without traversing unrelated ancestor trees", async () => {
		const sandbox = await fs.mkdtemp(path.join(os.tmpdir(), "ecuflash-scope-"));
		try {
			const definitions = path.join(sandbox, "Definitions");
			await fs.mkdir(definitions);
			await fs.writeFile(
				path.join(definitions, "renamed-parent.xml"),
				baseDefinition,
			);
			const child = path.join(definitions, "modified.xml");
			await fs.writeFile(
				child,
				"<rom><romid><xmlid>modified</xmlid></romid><include>56890313</include></rom>",
			);
			scope.allowedDirectory = definitions;
			scope.unrelatedDirectories = [];

			const definition = await new EcuFlashProvider([definitions]).parse(
				pathToFileURL(child).toString(),
			);
			expect(definition.tables.map((table) => table.name)).toEqual(["Example"]);
			expect(scope.unrelatedDirectories).toEqual([]);
		} finally {
			scope.allowedDirectory = "";
			await fs.rm(sandbox, { recursive: true, force: true });
		}
	});

	it("auto-matches configured linked definitions on the first ROM open", async () => {
		const sandbox = await fs.mkdtemp(
			path.join(os.tmpdir(), "ecuflash-linked-"),
		);
		try {
			const workspace = path.join(sandbox, "workspace");
			const definitions = path.join(sandbox, "shared-definitions");
			await fs.mkdir(path.join(workspace, "ROMs"), { recursive: true });
			await fs.mkdir(definitions);
			const linkedDefinitions = path.join(workspace, "Definitions");
			await fs.symlink(
				definitions,
				linkedDefinitions,
				process.platform === "win32" ? "junction" : "dir",
			);
			await fs.writeFile(
				path.join(definitions, "modified.xml"),
				baseDefinition,
			);
			const romPath = path.join(workspace, "ROMs", "test.bin");
			const bytes = Uint8Array.of(0x56, 0x89, 0x03, 0x13);
			await fs.writeFile(romPath, bytes);

			const plan = await planRomDefinitionResolution(
				pathToFileURL(romPath).toString(),
				bytes,
				[new EcuFlashProvider([linkedDefinitions])],
			);
			expect(plan.kind).toBe("auto");
			if (plan.kind !== "auto")
				throw new Error("Expected a matching configured definition");
			expect(plan.definition.tables.map((table) => table.name)).toEqual([
				"Example",
			]);
		} finally {
			await fs.rm(sandbox, { recursive: true, force: true });
		}
	});
});
