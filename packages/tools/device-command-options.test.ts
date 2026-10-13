import { spawnSync } from "node:child_process";
import sade from "sade";
import { describe, expect, it } from "vitest";
import { deviceCommandOptions } from "./device-command-options.js";

/** Parse real command-line arguments with the installed CLI parser. */
function parse(args: string[]) {
	let options: ReturnType<typeof deviceCommandOptions> | undefined;
	sade("inspect-device")
		.command("write-rom")
		.option("--dry-run", "Validate without flashing", false)
		.option("--resume-kernel", "Recover existing kernel", false)
		.action((raw) => {
			options = deviceCommandOptions(raw);
		})
		.parse(["node", "inspect-device", "write-rom", ...args]);
	return options;
}
describe("device CLI flags", () => {
	it("preserves dry-run and recovery intent from actual Sade parsing", () => {
		expect(parse(["--dry-run"])).toMatchObject({
			dryRun: true,
			resumeKernel: false,
		});
		expect(parse(["--resume-kernel"])).toMatchObject({
			dryRun: false,
			resumeKernel: true,
		});
		expect(parse(["--dry-run", "--resume-kernel"])).toMatchObject({
			dryRun: true,
			resumeKernel: true,
		});
	});
	it("rejects ambiguous flag values instead of performing a real flash", () => {
		expect(() => deviceCommandOptions({ "dry-run": "true" })).toThrow(
			/boolean flag/,
		);
	});
	it("maps flags in the real CLI entry point before opening hardware", () => {
		const result = spawnSync(
			process.execPath,
			[
				"packages/tools/inspect-device.js",
				"write-rom",
				"--rom",
				"unused.bin",
				"--resume-kernel",
				"--dry-run",
			],
			{ encoding: "utf8" },
		);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain(
			"Recovery requires a real write retry, not --dry-run",
		);
	});
});
