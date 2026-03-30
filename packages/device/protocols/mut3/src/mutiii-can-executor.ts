import type { BuiltinMutiiiCanChannel } from "./mutiii-can-profile.js";
import { decodeMutiiiCanPid } from "./mutiii-can-profile.js";

interface MutiiiCanPlannedChannel {
	pid: number;
	channelKey: string;
	displayName: string;
	logReference: string | null;
	bank: number;
	slot: number;
	rawRequest: string;
	responseBytes: number | null;
	unit: string | null;
	metricUnit: string | null;
	eval: string | null;
	metricEval: string | null;
}

interface MutiiiCanExecutionGroup {
	bank: number;
	channels: MutiiiCanPlannedChannel[];
	slots: number[];
}

interface MutiiiCanExecutionPlan {
	groups: MutiiiCanExecutionGroup[];
	channels: MutiiiCanPlannedChannel[];
	missingPids: number[];
}

function plannedChannelFromBuiltin(
	channel: BuiltinMutiiiCanChannel & { pid: number },
): MutiiiCanPlannedChannel {
	return {
		pid: channel.pid,
		channelKey: channel.channelKey,
		displayName: channel.displayName,
		logReference: channel.logReference,
		bank: channel.request.bank,
		slot: channel.request.slot,
		rawRequest: channel.request.raw,
		responseBytes: channel.decode.responseBytes,
		unit: channel.decode.unit,
		metricUnit: channel.decode.metricUnit,
		eval: channel.decode.eval,
		metricEval: channel.decode.metricEval,
	};
}

function buildMutiiiCanExecutionPlan(pids: number[]): MutiiiCanExecutionPlan {
	const channels: MutiiiCanPlannedChannel[] = [];
	const missingPids: number[] = [];

	for (const pid of pids) {
		const channel = decodeMutiiiCanPid(pid);
		if (channel == null) {
			missingPids.push(pid);
			continue;
		}
		channels.push(plannedChannelFromBuiltin(channel));
	}

	const groupsByBank = new Map<number, MutiiiCanExecutionGroup>();
	for (const channel of channels) {
		const existing = groupsByBank.get(channel.bank) ?? {
			bank: channel.bank,
			channels: [],
			slots: [],
		};
		existing.channels.push(channel);
		if (!existing.slots.includes(channel.slot)) {
			existing.slots.push(channel.slot);
		}
		groupsByBank.set(channel.bank, existing);
	}

	const groups = Array.from(groupsByBank.values())
		.map((group) => ({
			bank: group.bank,
			channels: [...group.channels].sort(
				(left, right) => left.slot - right.slot,
			),
			slots: [...group.slots].sort((left, right) => left - right),
		}))
		.sort((left, right) => left.bank - right.bank);

	return {
		groups,
		channels,
		missingPids,
	};
}

function formatMutiiiCanExecutionPlan(plan: MutiiiCanExecutionPlan): string {
	const parts = plan.groups.map((group) => {
		const slotSummary = group.slots.join(", ");
		const nameSummary = group.channels
			.map((channel) => channel.logReference ?? channel.displayName)
			.join(", ");
		return `bank ${group.bank} [slots ${slotSummary}] => ${nameSummary}`;
	});
	return parts.join("; ");
}

function describeMutiiiCanExecutionGap(plan: MutiiiCanExecutionPlan): string {
	const summary =
		plan.groups.length > 0
			? formatMutiiiCanExecutionPlan(plan)
			: "no valid CAN banks were selected";
	const missing =
		plan.missingPids.length > 0
			? ` Missing PIDs: ${plan.missingPids
					.map((pid) => `0x${pid.toString(16)}`)
					.join(", ")}.`
			: "";
	return `MUT-III CAN runtime scaffold is active, but live execution is still blocked on the unresolved EvoScan bank lookup table. Planned groups: ${summary}.${missing}`;
}

export type {
	MutiiiCanExecutionGroup,
	MutiiiCanExecutionPlan,
	MutiiiCanPlannedChannel,
};
export {
	buildMutiiiCanExecutionPlan,
	describeMutiiiCanExecutionGap,
	formatMutiiiCanExecutionPlan,
};
