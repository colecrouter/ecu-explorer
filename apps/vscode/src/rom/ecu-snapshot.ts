import type { RomProgress } from "@ecu-explorer/device";
import * as vscode from "vscode";

interface EcuSnapshotOptions {
	directory: vscode.Uri;
	read(onProgress: (progress: RomProgress) => void): Promise<Uint8Array>;
	suspend(): Promise<() => void>;
}

/** Read exactly once, finish protocol cleanup, then persist an immutable baseline. */
export async function readEcuRomSnapshot(options: EcuSnapshotOptions) {
	const resume = await options.suspend();
	let bytes: Uint8Array;
	try {
		bytes = await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: "Reading ECU ROM for comparison",
				cancellable: false,
			},
			async (progress) => {
				let previous = 0;
				return options.read((update) => {
					const percent = Math.min(
						100,
						Math.max(previous, update.percentComplete),
					);
					progress.report({
						increment: percent - previous,
						message:
							update.message ?? `${update.phase}: ${Math.round(percent)}%`,
					});
					previous = percent;
				});
			},
		);
		if (!bytes.length) throw new Error("The ECU returned an empty ROM.");
	} finally {
		try {
			resume();
		} catch (error) {
			void vscode.window.showWarningMessage(
				`ROM read finished, but live data could not resume: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}
	const capturedAt = new Date().toISOString();
	const uri = vscode.Uri.joinPath(
		options.directory,
		`ecu-${capturedAt.replace(/[:.]/g, "-")}-${globalThis.crypto.randomUUID()}.bin`,
	);
	await vscode.workspace.fs.createDirectory(options.directory);
	await vscode.workspace.fs.writeFile(uri, bytes);
	return { uri, bytes, capturedAt };
}
