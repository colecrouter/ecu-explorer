import type {
	DeviceConnection,
	EcuProtocol,
	LiveDataProfileDescriptor,
	PidDescriptor,
} from "@ecu-explorer/device";
import * as vscode from "vscode";

export interface LoggingConfiguration {
	protocolName: string;
	profileId?: string;
	profileName: string;
	revision?: string;
	pids: PidDescriptor[];
}
interface SavedConfiguration {
	protocolName: string;
	profileId?: string;
	pids: number[];
}

/** One workspace selection for monitoring and CSV recording. */
export class LoggingConfigurationStore {
	constructor(private readonly state: Pick<vscode.Memento, "get" | "update">) {}
	private async available(
		connection: DeviceConnection,
		protocol: EcuProtocol,
	): Promise<LiveDataProfileDescriptor[]> {
		if (!protocol.streamLiveData)
			throw new Error("The connected protocol does not support live data.");
		const profiles = (await protocol.getLiveDataProfiles?.(connection)) ?? [];
		if (profiles.length)
			return profiles.filter(
				(profile) =>
					profile.status !== "unavailable" && profile.pids.length > 0,
			);
		const pids = (await protocol.getSupportedPids?.(connection)) ?? [];
		return pids.length
			? [{ id: "", name: protocol.name, status: "ready", pids }]
			: [];
	}
	private saved(): SavedConfiguration | undefined {
		const saved = this.state.get<SavedConfiguration>("loggingConfiguration");
		if (
			!saved ||
			typeof saved.protocolName !== "string" ||
			!Array.isArray(saved.pids) ||
			!saved.pids.length ||
			!saved.pids.every(Number.isInteger)
		)
			return undefined;
		return saved;
	}
	async resolve(
		connection: DeviceConnection,
		protocol: EcuProtocol,
	): Promise<LoggingConfiguration | undefined> {
		const profiles = await this.available(connection, protocol);
		const saved = this.saved();
		const profile =
			saved?.protocolName === protocol.name
				? profiles.find((profile) => profile.id === (saved.profileId ?? ""))
				: undefined;
		if (
			saved &&
			profile &&
			saved.pids.every((id) => profile.pids.some((pid) => pid.pid === id))
		) {
			return this.configuration(
				protocol,
				profile,
				profile.pids.filter((pid) => saved.pids.includes(pid.pid)),
			);
		}
		const selected = await this.choose(connection, protocol, profiles);
		if (selected) await this.save(selected);
		return selected;
	}
	async choose(
		connection: DeviceConnection,
		protocol: EcuProtocol,
		profiles?: LiveDataProfileDescriptor[],
	): Promise<LoggingConfiguration | undefined> {
		const available = profiles ?? (await this.available(connection, protocol));
		if (!available.length)
			throw new Error(
				"The connected protocol has no available logging channels.",
			);
		const saved = this.saved();
		const preferred =
			saved?.protocolName === protocol.name
				? saved.profileId
				: this.state.get<string>("loggingProfileId");
		const ordered = [...available].sort(
			(a, b) => Number(b.id === preferred) - Number(a.id === preferred),
		);
		const profile =
			ordered.length === 1
				? ordered[0]
				: (
						await vscode.window.showQuickPick(
							ordered.map((profile) => ({
								label: profile.name,
								description: [
									profile.id === preferred ? "Current" : profile.status,
									profile.decodeFamily === "evoscan-expression"
										? "EvoScan XML"
										: "",
								]
									.filter(Boolean)
									.join(" · "),
								detail: [profile.description, profile.statusDetail]
									.filter(Boolean)
									.join(" · "),
								profile,
							})),
							{
								title: "Logging configuration · Profile",
								matchOnDescription: true,
								matchOnDetail: true,
								placeHolder: "Select the profile that matches your ECU ROM",
							},
						)
					)?.profile;
		if (!profile) return;
		const remembered =
			saved?.protocolName === protocol.name &&
			(saved.profileId ?? "") === profile.id
				? saved.pids
				: undefined;
		const selected = await vscode.window.showQuickPick(
			profile.pids.map((pid) => ({
				label: pid.name,
				description: pid.unit,
				detail: `PID 0x${pid.pid.toString(16)}`,
				picked: remembered
					? remembered.includes(pid.pid)
					: profile.defaultPids
						? profile.defaultPids.includes(pid.pid)
						: true,
				pid,
			})),
			{
				title: `Logging configuration · ${profile.name}`,
				placeHolder: "Select the channels to monitor and record",
				canPickMany: true,
			},
		);
		if (!selected) return;
		if (!selected.length) {
			void vscode.window.showWarningMessage(
				"Select at least one logging channel. Configuration was not changed.",
			);
			return;
		}
		return this.configuration(
			protocol,
			profile,
			selected.map((item) => item.pid),
		);
	}
	private configuration(
		protocol: EcuProtocol,
		profile: LiveDataProfileDescriptor,
		pids: PidDescriptor[],
	): LoggingConfiguration {
		return {
			protocolName: protocol.name,
			...(profile.revision ? { revision: profile.revision } : {}),
			profileName: profile.name,
			pids,
			...(profile.id ? { profileId: profile.id } : {}),
		};
	}
	async save(configuration: LoggingConfiguration): Promise<void> {
		await this.state.update("loggingConfiguration", {
			protocolName: configuration.protocolName,
			...(configuration.profileId
				? { profileId: configuration.profileId }
				: {}),
			pids: configuration.pids.map((pid) => pid.pid),
		});
	}
}
