import type {
	DeviceConnection,
	EcuProtocol,
	LiveDataFrame,
	LiveDataHealth,
	LiveDataSession,
	PidDescriptor,
} from "@ecu-explorer/device";
import * as vscode from "vscode";
import type { DeviceManagerImpl } from "./device-manager.js";

type LiveDataProfileDescriptor = {
	id: string;
	name: string;
	description?: string;
	transportFamily?: string;
	requestFamily?: string;
	decodeFamily?: string;
	status: "ready" | "experimental" | "unavailable";
	statusDetail?: string;
	pids: PidDescriptor[];
};

type LiveDataStreamSelection = {
	pids: number[];
	profileId?: string;
};

type ProfileAwareProtocol = EcuProtocol & {
	getLiveDataProfiles?: (
		connection: DeviceConnection,
	) => Promise<LiveDataProfileDescriptor[]>;
	streamLiveData?: (
		connection: DeviceConnection,
		pidsOrSelection: number[] | LiveDataStreamSelection,
		onFrame: (frame: LiveDataFrame) => void,
		onHealth?: (health: LiveDataHealth) => void,
	) => LiveDataSession;
};

export class LiveDataPanelManager {
	private panel: vscode.WebviewPanel | undefined;
	private session: LiveDataSession | undefined;
	private connection: DeviceConnection | undefined;
	private protocol: ProfileAwareProtocol | undefined;
	private supportedProfiles: readonly LiveDataProfileDescriptor[] = [];
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

	constructor(
		private context: vscode.ExtensionContext,
		private deviceManager: DeviceManagerImpl,
	) {}

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

		this.panel.webview.html = this.getWebviewContent(this.panel.webview);

		this.panel.webview.onDidReceiveMessage(async (message) => {
			switch (message.type) {
				case "ready":
					await this.handleReady();
					break;
				case "startStreaming":
					// The `record` field is deprecated and ignored.
					// Logging is now controlled exclusively via status bar commands (LoggingManager).
					await this.startStreaming(message.pids, message.profileId);
					break;
				case "stopStreaming":
					this.stopStreaming();
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
				this.supportedProfiles = [];
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
		let stopped = false;
		return {
			stop: () => {
				if (stopped) return;
				stopped = true;
				subscription.dispose();
				this.recordingSubscribers--;
				if (
					(ownsStream || this.panel == null) &&
					this.streamGeneration === generation &&
					this.connection === connection
				)
					this.stopStreaming();
			},
		};
	}

	private async handleReady() {
		try {
			// Reuse the managed connection so Live Data and CSV logging share
			// device state and never compete for the adapter's serial port.
			const { connection, protocol } = await this.deviceManager.connect();
			const profileAwareProtocol = protocol as ProfileAwareProtocol;
			this.connection = connection;
			this.protocol = profileAwareProtocol;

			if (profileAwareProtocol.getLiveDataProfiles) {
				const profiles =
					await profileAwareProtocol.getLiveDataProfiles(connection);
				if (profiles.length > 0) {
					const defaultProfile = this.pickDefaultProfile(profiles);
					this.supportedProfiles = profiles;
					this.supportedPids = defaultProfile?.pids ?? [];
					this.panel?.webview.postMessage({
						type: "supportedProfiles",
						profiles,
						selectedProfileId: defaultProfile?.id,
					});
					return;
				}
			}

			if (profileAwareProtocol.getSupportedPids) {
				const pids = await profileAwareProtocol.getSupportedPids(connection);
				this.supportedProfiles = [];
				this.supportedPids = pids;
				this.panel?.webview.postMessage({
					type: "supportedPids",
					pids,
				});
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			vscode.window.showErrorMessage(`Failed to connect: ${message}`);
		}
	}

	private pickDefaultProfile(
		profiles: readonly LiveDataProfileDescriptor[],
	): LiveDataProfileDescriptor | undefined {
		return (
			profiles.find((profile) => profile.status === "ready") ??
			profiles.find((profile) => profile.status === "experimental") ??
			profiles[0]
		);
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

		const selection: LiveDataStreamSelection =
			profileId === undefined ? { pids } : { pids, profileId };
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
		const profile =
			this.activeSelection.profileId == null
				? undefined
				: this.supportedProfiles.find(
						(candidate) => candidate.id === this.activeSelection?.profileId,
					);
		const availablePids = profile?.pids ?? this.supportedPids;
		return availablePids.filter((pid: PidDescriptor) =>
			selectedPidSet.has(pid.pid),
		);
	}

	private getWebviewContent(webview: vscode.Webview): string {
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
</head>
<body>
	<div id="app"></div>
	<script type="module" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
