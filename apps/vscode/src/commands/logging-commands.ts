import * as vscode from "vscode";
import type { DeviceManagerImpl } from "../device-manager.js";
import type { LiveDataPanelManager } from "../live-data-panel-manager.js";
import type { LoggingConfigurationStore } from "../logging-configuration.js";
import type {
	LogChannelDescriptor,
	LoggingManager,
} from "../logging-manager.js";

interface LoggingCommandServices {
	deviceManager: Pick<DeviceManagerImpl, "activeConnection" | "connect">;
	liveData: LiveDataPanelManager;
	logging: LoggingManager;
	configuration: LoggingConfigurationStore;
	getAuxiliaryChannels(): LogChannelDescriptor[];
}

export class LoggingCommands {
	private busy = false;
	constructor(private readonly services: LoggingCommandServices) {}
	async run(action: "configure" | "monitor" | "record"): Promise<void> {
		if (this.busy) return;
		this.busy = true;
		try {
			if (this.services.liveData.isBusyWithRomRead)
				throw new Error(
					"Wait for the ROM read to finish before changing live data.",
				);
			if (action === "record") await this.startLog();
			else if (action === "monitor") {
				const active =
					this.services.deviceManager.activeConnection ??
					(await this.services.deviceManager.connect());
				const selected = await this.services.configuration.resolve(
					active.connection,
					active.protocol,
				);
				if (!selected) return;
				this.assertConnected(active.connection);
				await this.services.liveData.applyConfiguration(
					active.connection,
					active.protocol,
					selected,
					true,
				);
				await this.services.liveData.showPanel();
			} else await this.changeConfiguration();
		} finally {
			this.busy = false;
		}
	}
	private assertConnected(connection: object): void {
		if (this.services.deviceManager.activeConnection?.connection !== connection)
			throw new Error(
				"The device changed while selecting logging channels. Try again after connecting.",
			);
	}
	private async startLog(): Promise<void> {
		const { logging, liveData, deviceManager, configuration } = this.services;
		if (logging.loggingState !== "idle") return;
		const active = deviceManager.activeConnection;
		const channels = this.services.getAuxiliaryChannels();
		if (!active && !channels.length)
			throw new Error(
				"No live data source connected. Connect an ECU or wideband first.",
			);
		const selected = active
			? await configuration.resolve(active.connection, active.protocol)
			: undefined;
		if (active && !selected) return;
		if (active && selected) {
			this.assertConnected(active.connection);
			await liveData.applyConfiguration(
				active.connection,
				active.protocol,
				selected,
			);
		}
		const pids = selected?.pids ?? [];
		await logging.startLog({
			pids,
			channels,
			...(active && selected
				? {
						startStream: (onFrame) =>
							liveData.streamForLogging(
								active.connection,
								active.protocol,
								pids,
								onFrame,
								selected.profileId,
							),
					}
				: {}),
		});
	}
	private async changeConfiguration(): Promise<void> {
		const { deviceManager, configuration, liveData, logging } = this.services;
		const active =
			deviceManager.activeConnection ?? (await deviceManager.connect());
		const selected = await configuration.choose(
			active.connection,
			active.protocol,
		);
		if (!selected) return;
		this.assertConnected(active.connection);
		if (liveData.isBusyWithRomRead)
			throw new Error(
				"Wait for the ROM read to finish before changing logging configuration.",
			);
		const state = logging.loggingState;
		const wasStreaming = liveData.isStreaming;
		if (state !== "idle") await logging.stopLog({ notify: false });
		await liveData.applyConfiguration(
			active.connection,
			active.protocol,
			selected,
			wasStreaming || state !== "idle",
		);
		await configuration.save(selected);
		if (state !== "idle") {
			await this.startLog();
			if (state === "paused") logging.pauseLog();
		}
		void vscode.window.showInformationMessage(
			`Logging configuration: ${selected.profileName}, ${selected.pids.length} channels.${state !== "idle" ? " Previous log saved; recording continues in a new file." : ""}`,
		);
	}
}

export function registerLoggingCommands(
	context: vscode.ExtensionContext,
	services: LoggingCommandServices,
): void {
	const commands = new LoggingCommands(services);
	for (const [id, action] of [
		["ecuExplorer.startLog", "record"],
		["ecuExplorer.startLiveData", "monitor"],
		["ecuExplorer.changeLoggingConfiguration", "configure"],
	] as const) {
		context.subscriptions.push(
			vscode.commands.registerCommand(id, async () => {
				try {
					await commands.run(action);
				} catch (error) {
					if (!(error instanceof vscode.CancellationError))
						void vscode.window.showErrorMessage(
							`Live data: ${error instanceof Error ? error.message : String(error)}`,
						);
				}
			}),
		);
	}
}
