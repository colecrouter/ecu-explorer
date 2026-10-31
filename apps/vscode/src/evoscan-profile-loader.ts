import {
	compileEvoScanProfiles,
	type EvoScanRuntimeProfile,
} from "@ecu-explorer/device-protocol-mut3";
import * as vscode from "vscode";
import { readConfig } from "./config.js";

/** Discover only explicitly configured roots; follow workspace links through VS Code fs. */
export class EvoScanProfileLoader {
	private cache = new Map<
		string,
		{
			text: string;
			units: "metric" | "original";
			profiles: EvoScanRuntimeProfile[];
		}
	>();
	constructor(
		private readonly report: (message: string) => void = console.warn,
	) {}
	async load(): Promise<EvoScanRuntimeProfile[]> {
		const files = new Map<
			string,
			{ uri: vscode.Uri; units: "metric" | "original" }
		>();
		const folders =
			vscode.workspace.workspaceFolders?.map((folder) => folder.uri) ?? [];
		const roots: (vscode.Uri | undefined)[] = folders.length
			? folders
			: [undefined];
		for (const root of roots) {
			const config = readConfig(root).logging;
			const visit = async (uri: vscode.Uri, depth: number): Promise<void> => {
				if (files.size >= 4096 || depth > 8)
					throw new Error("EvoScan configuration discovery limit exceeded");
				const stat = await vscode.workspace.fs.stat(uri);
				if (stat.type & vscode.FileType.Directory) {
					for (const [name, type] of await vscode.workspace.fs.readDirectory(
						uri,
					))
						if (
							type & vscode.FileType.Directory ||
							name.toLowerCase().endsWith(".xml")
						)
							await visit(vscode.Uri.joinPath(uri, name), depth + 1);
				} else if (uri.path.toLowerCase().endsWith(".xml"))
					files.set(uri.toString(), { uri, units: config.units });
			};
			for (const configured of config.configurationPaths) {
				const absolute = /^(?:\/|[a-zA-Z]:[\\/]|\\\\)/.test(configured);
				const uri = absolute
					? vscode.Uri.file(configured)
					: root
						? vscode.Uri.joinPath(root, configured)
						: undefined;
				if (!uri) continue;
				try {
					await visit(uri, 0);
				} catch (error) {
					if (
						!(
							error instanceof vscode.FileSystemError &&
							error.code === "FileNotFound"
						)
					)
						this.report(
							`${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`,
						);
				}
			}
		}
		const result: EvoScanRuntimeProfile[] = [];
		for (const { uri, units } of [...files.values()].sort((a, b) =>
			a.uri.toString().localeCompare(b.uri.toString()),
		)) {
			try {
				const text = new TextDecoder().decode(
					await vscode.workspace.fs.readFile(uri),
				);
				const cached = this.cache.get(uri.toString());
				const profiles =
					cached?.text === text && cached.units === units
						? cached.profiles
						: compileEvoScanProfiles(text, uri.toString(), units);
				this.cache.set(uri.toString(), { text, units, profiles });
				result.push(...profiles);
				for (const profile of profiles)
					this.report(
						`${uri.fsPath} · ${profile.descriptor.name}: ${profile.channels.length} executable channels${profile.issues.length ? `\n  ${profile.issues.join("\n  ")}` : ""}`,
					);
			} catch (error) {
				this.report(
					`${uri.fsPath}: ${error instanceof Error ? error.message : String(error)}`,
				);
				this.cache.delete(uri.toString());
			}
		}
		for (const key of this.cache.keys())
			if (!files.has(key)) this.cache.delete(key);
		return result;
	}
}
