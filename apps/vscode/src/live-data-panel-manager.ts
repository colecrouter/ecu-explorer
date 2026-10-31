import type {
	DeviceConnection,
	EcuProtocol,
	LiveDataFrame,
	LiveDataHealth,
	LiveDataSession,
	PidDescriptor,
} from "@ecu-explorer/device";
import * as vscode from "vscode";
import type { LoggingConfiguration } from "./logging-configuration.js";

export class LiveDataPanelManager {
	private panel: vscode.WebviewPanel | undefined;
	private session: LiveDataSession | undefined;
	private connection: DeviceConnection | undefined;
	private protocol: EcuProtocol | undefined;
	private configuration: LoggingConfiguration | undefined;
	private pendingStop: Promise<void> = Promise.resolve();
	private supportedPids: readonly PidDescriptor[] = [];
	private activeSelection:
		| {
				pids: number[];
				profileId?: string;
		  }
		| undefined;
	private recordingSubscribers = 0;
	private suspendedForRomRead = false;
	private streamEpoch = 0;
	private streamGeneration = 0;

	private _onFrame = new vscode.EventEmitter<LiveDataFrame>();
	/** Fires for each live data frame received from the device. */
	readonly onFrame: vscode.Event<LiveDataFrame> = this._onFrame.event;

	constructor(private context: vscode.ExtensionContext) {}

	async showPanel() {
		if (this.panel) {
			this.panel.reveal();
			return;
		}

		this.panel = vscode.window.createWebviewPanel(
			"ecuExplorerLiveData",
			"Live Data",
			vscode.ViewColumn.One,
			{
				enableScripts: true,
				retainContextWhenHidden: true,
				localResourceRoots: [
					vscode.Uri.joinPath(this.context.extensionUri, "dist"),
				],
			},
		);

		this.panel.webview.html = await this.getWebviewContent(this.panel.webview);

		this.panel.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case "ready":
					this.postConfiguration();
					this.panel?.webview.postMessage({
						type: this.session ? "streamingStarted" : "streamingStopped",
					});
					break;

				case "startStreaming":
					await vscode.commands.executeCommand("ecuExplorer.startLiveData");
					break;
				case "changeConfiguration":
					await vscode.commands.executeCommand(
						"ecuExplorer.changeLoggingConfiguration",
					);
					break;
				case "stopStreaming":
					if (this.recordingSubscribers > 0) {
						void vscode.window.showWarningMessage(
							"Stop the active log before stopping live data.",
						);
					} else this.stopStreaming();
					break;
			}
		});

		this.panel.onDidDispose(() => {
			if (this.recordingSubscribers === 0) this.stopStreaming();
			this.panel = undefined;
		});
	}

	/** Record the existing stream, or start polling without opening a webview. */
	streamForLogging(
		connection: DeviceConnection,
		protocol: EcuProtocol,
		pids: readonly PidDescriptor[],
		onFrame: (frame: LiveDataFrame) => void,
		profileId?: string,
	): LiveDataSession {
		const subscription = this.onFrame(onFrame);
		const ownsStream = this.session == null;
		try {
			if (ownsStream) {
				if (!protocol.streamLiveData)
					throw new Error("This protocol does not support live data");
				this.connection = connection;
				this.protocol = protocol;
				this.supportedPids = [...pids];
				this.startStreaming(
					pids.map((pid) => pid.pid),
					profileId,
				);
			}
		} catch (error) {
			subscription.dispose();
			this.activeSelection = undefined;
			throw error;
		}
		const generation = this.streamGeneration;
		this.recordingSubscribers++;
		this.postConfiguration();
		let stopped = false;
		return {
			stop: () => {
				if (stopped) return;
				stopped = true;
				subscription.dispose();
				this.recordingSubscribers--;
				this.postConfiguration();
				if (
					(ownsStream || this.panel == null) &&
					this.streamGeneration === generation &&
					this.connection === connection
				)
					this.stopStreaming();
			},
		};
	}

	get isStreaming(): boolean {
		return this.session != null;
	}
	get isBusyWithRomRead(): boolean {
		return this.suspendedForRomRead;
	}

	/** Apply the shared native selection after the previous poll has settled. */
	async applyConfiguration(
		connection: DeviceConnection,
		protocol: EcuProtocol,
		configuration: LoggingConfiguration,
		start = false,
	): Promise<void> {
		if (this.suspendedForRomRead)
			throw new Error(
				"Wait for the ROM read to finish before changing logging configuration.",
			);
		const same =
			this.connection === connection &&
			this.protocol === protocol &&
			this.configuration?.revision === configuration.revision &&
			this.activeSelection?.profileId === configuration.profileId &&
			this.activeSelection?.pids.join(",") ===
				configuration.pids.map((pid) => pid.pid).join(",");
		if (!same) {
			if (this.recordingSubscribers > 0)
				throw new Error("Save the active log before changing channels.");
			this.stopStreaming();
			await this.pendingStop;
		}
		this.connection = connection;
		this.protocol = protocol;
		this.configuration = configuration;
		this.supportedPids = configuration.pids;
		this.postConfiguration();
		if (start)
			this.startStreaming(
				configuration.pids.map((pid) => pid.pid),
				configuration.profileId,
			);
	}

	private postConfiguration(): void {
		void this.panel?.webview.postMessage({
			type: "configuration",
			profileName:
				this.configuration?.profileName ??
				this.protocol?.name ??
				"Not configured",
			pids: this.configuration?.pids ?? this.getActiveLoggingPids() ?? [],
			recording: this.recordingSubscribers > 0,
		});
	}

	private startStreaming(
		pids: number[],
		profileId?: string,
		elapsedBeforeStart?: number,
	) {
		if (this.suspendedForRomRead)
			throw new Error("Live data is paused for a ROM read.");
		if (!this.connection || !this.protocol || !this.protocol.streamLiveData) {
			return;
		}
		if (this.session != null) {
			this.panel?.webview.postMessage({ type: "streamingStarted" });
			return;
		}

		const selection = profileId === undefined ? { pids } : { pids, profileId };
		this.activeSelection = {
			pids: [...pids],
			...(profileId === undefined ? {} : { profileId }),
		};

		if (elapsedBeforeStart === undefined) this.streamGeneration++;
		const timestampOffset = elapsedBeforeStart ?? 0;
		this.streamEpoch = Date.now() - timestampOffset;
		this.session = this.protocol.streamLiveData(
			this.connection,
			selection,
			(frame: LiveDataFrame) => {
				const timedFrame =
					timestampOffset === 0
						? frame
						: { ...frame, timestamp: frame.timestamp + timestampOffset };
				this.panel?.webview.postMessage({
					type: "data",
					frame: timedFrame,
				});

				// Fire the onFrame event so LoggingManager (and others) can subscribe
				this._onFrame.fire(timedFrame);
			},
			(health: LiveDataHealth) => {
				console.log(
					`[Live Data Health] status=${health.status} sps=${health.samplesPerSecond} dropped=${health.droppedFrames} latency=${health.latencyMs}ms`,
				);
				if (health.status === "stalled" || health.status === "degraded") {
					vscode.window.showWarningMessage(
						`Live data stream is ${health.status}. Samples/s: ${health.samplesPerSecond}, dropped frames: ${health.droppedFrames}, latency: ${health.latencyMs}ms.`,
					);
				}
			},
		);

		this.panel?.webview.postMessage({ type: "streamingStarted" });
	}

	/** Pause polling, drain its last request, and return a one-shot resume action. */
	async suspendForRomRead(): Promise<() => void> {
		if (this.suspendedForRomRead)
			throw new Error("A ROM read already paused live data.");
		this.suspendedForRomRead = true;
		const selection = this.activeSelection;
		const epoch = this.streamEpoch;
		const connection = this.connection;
		const session = this.session;
		try {
			session?.stop();
			await this.pendingStop;
			await session?.completion;
			if (this.session === session) this.session = undefined;
			this.panel?.webview.postMessage({ type: "streamingStopped" });
		} catch (error) {
			this.suspendedForRomRead = false;
			throw error;
		}
		let resumed = false;
		return () => {
			if (resumed) return;
			resumed = true;
			this.suspendedForRomRead = false;
			if (
				session &&
				selection &&
				this.activeSelection === selection &&
				this.connection === connection
			) {
				this.startStreaming(
					selection.pids,
					selection.profileId,
					Date.now() - epoch,
				);
			}
		};
	}

	/** Stop ECU polling when requested by the panel or device lifecycle. */
	stopStreaming() {
		if (this.session) {
			this.session.stop();
			const completion = this.session.completion;
			if (completion)
				this.pendingStop = Promise.all([this.pendingStop, completion]).then(
					() => undefined,
				);
			this.session = undefined;
		}
		this.activeSelection = undefined;

		this.panel?.webview.postMessage({ type: "streamingStopped" });
	}

	getActiveLoggingPids(): PidDescriptor[] | undefined {
		if (this.activeSelection == null) {
			return undefined;
		}

		const selectedPidSet = new Set(this.activeSelection.pids);
		const availablePids = this.supportedPids;
		return availablePids.filter((pid: PidDescriptor) =>
			selectedPidSet.has(pid.pid),
		);
	}

	private async getWebviewContent(webview: vscode.Webview): Promise<string> {
		const directory = vscode.Uri.joinPath(
			this.context.extensionUri,
			"dist",
			"webview",
		);
		const entries = (await vscode.workspace.fs.readDirectory(directory)) ?? [];
		const cssName = entries.find(
			([name]) => name.startsWith("live-data-") && name.endsWith(".css"),
		)?.[0];
		const stylesheet = cssName
			? `<link rel="stylesheet" href="${webview.asWebviewUri(vscode.Uri.joinPath(directory, cssName))}">`
			: "";
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(
				this.context.extensionUri,
				"dist",
				"webview",
				"live-data.js",
			),
		);

		return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource}; img-src ${webview.cspSource} data:;">
	<title>Live Data</title>
	${stylesheet}
</head>
<body>
	<div id="app"></div>
	<script type="module" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
