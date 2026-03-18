import {
	type HardwareCandidate,
	type HardwareDeviceSelectionStrategy,
	type HardwarePromptOptions,
	type HardwareRequestAction,
	promptForHardwareCandidate,
} from "./hardware-selection.js";

export interface HardwareCandidateSource {
	listCandidates(): Promise<readonly HardwareCandidate[]>;
	getRequestActions?(): readonly HardwareRequestAction[];
	getPromptOptions?(
		onForgot?: (candidate: HardwareCandidate) => void,
	): HardwarePromptOptions;
}

export async function selectHardwareCandidateFromSource(options: {
	source: HardwareCandidateSource;
	strategy?: HardwareDeviceSelectionStrategy;
	emptyMessage: string;
	forcePrompt?: boolean;
}): Promise<HardwareCandidate> {
	const candidates = await options.source.listCandidates();
	const requestActions = options.source.getRequestActions?.() ?? [];
	if (candidates.length === 0 && requestActions.length === 0) {
		throw new Error(options.emptyMessage);
	}

	const promptOptions =
		options.source.getPromptOptions?.((candidate) => {
			options.strategy?.forgetCandidate?.(candidate);
		}) ?? {};

	if (options.strategy != null && options.forcePrompt !== true) {
		return options.strategy.selectDevice(
			candidates,
			requestActions,
			promptOptions,
		);
	}

	return promptForHardwareCandidate(candidates, requestActions, promptOptions);
}
