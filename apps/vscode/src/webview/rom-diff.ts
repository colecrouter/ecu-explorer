import { mount } from "svelte";
import type { DiffWebviewMessage } from "../rom-diff-protocol.js";
import RomDiffApp from "./RomDiffApp.svelte";

const vscode = acquireVsCodeApi();
const target = document.getElementById("app");
if (!target) throw new Error("ROM diff root element is missing.");
mount(RomDiffApp, {
	target,
	props: { send: (message: DiffWebviewMessage) => vscode.postMessage(message) },
});
