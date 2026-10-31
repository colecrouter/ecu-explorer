import { describe, expect, it } from "vitest";
import { getEvoXBootstrap } from "../src/evox-bootstrap.js";
import { validateEvoXKernelArtifacts } from "../src/evox-kernel.js";

describe("bundled Evo X bootstrap", () => {
	it("matches the captured wire image digest and length", async () => {
		const image = getEvoXBootstrap();
		expect(image.length).toBe(208);
		const digest = new Uint8Array(
			await crypto.subtle.digest("SHA-256", new Uint8Array(image)),
		);
		expect(
			Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(""),
		).toBe("8d53b034b6ec0a88311e6c55dd037475933c4572b1406b88ae815e9b1db09fc9");
	});
	it("isolates callers from mutations", () => {
		const original = getEvoXBootstrap();
		getEvoXBootstrap().fill(0);
		expect(getEvoXBootstrap()).toEqual(original);
	});
	it("validates the default bootstrap before rejecting an invalid kernel", async () => {
		await expect(
			validateEvoXKernelArtifacts({ kernel: new Uint8Array() }),
		).rejects.toThrow("kernel must contain 5117 encoded bytes");
	});
	it("still rejects a supplied invalid bootstrap", async () => {
		await expect(
			validateEvoXKernelArtifacts({
				bootstrap: new Uint8Array(208),
				kernel: new Uint8Array(),
			}),
		).rejects.toThrow("bootstrap SHA-256 does not match");
	});
});
