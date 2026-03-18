import { describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import {
	createHardwareCandidate,
	FORGET_HARDWARE_BUTTON,
	type HardwareCandidate,
} from "../src/hardware-selection.js";
import { selectHardwareCandidateFromSource } from "../src/hardware-source.js";

function makeCandidate(
	id: string,
	name: string,
	transportName = "openport2",
	locality: "extension-host" | "client-browser" = "extension-host",
): HardwareCandidate {
	return createHardwareCandidate(
		{
			id,
			name,
			transportName,
			connected: false,
		},
		locality,
	);
}

function createQuickPickHarness() {
	let acceptHandler: (() => void) | undefined;
	let hideHandler: (() => void) | undefined;
	let itemButtonHandler:
		| ((event: {
				item: vscode.QuickPickItem;
				button: vscode.QuickInputButton;
		  }) => void)
		| undefined;
	const quickPick: vscode.QuickPick<vscode.QuickPickItem> = {
		value: "",
		items: [] as vscode.QuickPickItem[],
		selectedItems: [] as vscode.QuickPickItem[],
		activeItems: [] as vscode.QuickPickItem[],
		title: "",
		step: undefined,
		totalSteps: undefined,
		placeholder: "",
		enabled: true,
		busy: false,
		ignoreFocusOut: false,
		buttons: [],
		canSelectMany: false,
		matchOnDescription: false,
		matchOnDetail: false,
		keepScrollPosition: false,
		show: vi.fn(),
		hide: vi.fn(() => {
			hideHandler?.();
		}),
		dispose: vi.fn(),
		onDidChangeValue: () => ({ dispose: vi.fn() }),
		onDidAccept: (handler: () => void) => {
			acceptHandler = handler;
			return { dispose: vi.fn() };
		},
		onDidTriggerButton: () => ({ dispose: vi.fn() }),
		onDidHide: (handler: () => void) => {
			hideHandler = handler;
			return { dispose: vi.fn() };
		},
		onDidChangeActive: () => ({ dispose: vi.fn() }),
		onDidChangeSelection: () => ({ dispose: vi.fn() }),
		onDidTriggerItemButton: (
			handler: (event: {
				item: vscode.QuickPickItem;
				button: vscode.QuickInputButton;
			}) => void,
		) => {
			itemButtonHandler = handler;
			return { dispose: vi.fn() };
		},
	};

	return {
		quickPick,
		accept(item: vscode.QuickPickItem) {
			quickPick.selectedItems = [item];
			acceptHandler?.();
		},
		triggerButton(
			item: vscode.QuickPickItem,
			button: vscode.QuickInputButton = FORGET_HARDWARE_BUTTON,
		) {
			itemButtonHandler?.({ item, button });
		},
		hide() {
			hideHandler?.();
		},
	};
}

describe("selectHardwareCandidateFromSource", () => {
	it("forces a prompt even when a selection strategy would auto-pick", async () => {
		const preferred = makeCandidate("openport2:two", "OpenPort 2.0 B");
		const alternate = makeCandidate("openport2:one", "OpenPort 2.0 A");
		const harness = createQuickPickHarness();
		vi.spyOn(vscode.window, "createQuickPick").mockReturnValueOnce(
			harness.quickPick,
		);

		const selectedPromise = selectHardwareCandidateFromSource({
			source: {
				listCandidates: vi.fn(async () => [alternate, preferred]),
			},
			strategy: {
				selectDevice: vi.fn(async () => preferred),
				rememberCandidate: vi.fn(),
			},
			emptyMessage: "No hardware found",
			forcePrompt: true,
		});
		await new Promise((resolve) => setTimeout(resolve, 0));
		const candidateEntry = harness.quickPick.items.find(
			(entry) => "candidate" in entry && entry.label === "OpenPort 2.0 A",
		);
		if (candidateEntry == null) {
			throw new Error("Missing quick pick entry for forced prompt");
		}
		harness.accept(candidateEntry);

		await expect(selectedPromise).resolves.toEqual(alternate);
	});
});
