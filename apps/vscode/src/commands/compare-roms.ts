import type { RomSnapshot } from "../rom/comparison.js";

export type RomComparisonMode =
	| "saved-saved"
	| "active-saved"
	| "saved-ecu"
	| "active-ecu";

interface ComparisonSources {
	selectSaved(title: string): Promise<RomSnapshot | undefined>;
	getActive(): RomSnapshot | undefined;
	readEcu(): Promise<RomSnapshot | undefined>;
	show(base: RomSnapshot, target: RomSnapshot): void;
}

/** Source selection is completed before a hardware operation can begin. */
export class RomComparisonController {
	private busy = false;
	constructor(private readonly sources: ComparisonSources) {}
	async compare(mode: RomComparisonMode): Promise<void> {
		if (this.busy)
			throw new Error("A ROM comparison is already being prepared.");
		this.busy = true;
		try {
			let target: RomSnapshot | undefined;
			if (mode.startsWith("active")) {
				target = this.sources.getActive();
				if (!target)
					throw new Error(
						"Open an active ROM or table editor before comparing.",
					);
			} else if (mode === "saved-ecu") {
				target = await this.sources.selectSaved(
					"Select ROM to compare with ECU",
				);
				if (!target) return;
			}
			const base = mode.endsWith("ecu")
				? await this.sources.readEcu()
				: await this.sources.selectSaved("Select baseline ROM");
			if (!base) return;
			target ??= await this.sources.selectSaved("Select comparison ROM");
			if (target) this.sources.show(base, target);
		} finally {
			this.busy = false;
		}
	}
}
