import { mount } from "svelte";
import LiveDataApp from "./LiveDataApp.svelte";

const target = document.getElementById("app");
if (!target) {
	throw new Error(
		"Failed to mount LiveDataApp: root element #app not found in DOM",
	);
}

const vscode = acquireVsCodeApi();
const app = mount(LiveDataApp, {
	target,
	props: { send: (message: { type: string }) => vscode.postMessage(message) },
});

export default app;
