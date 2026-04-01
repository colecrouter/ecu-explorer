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
			this.stopStreaming();
			this.panel = undefined;
		});
	}

	private async handleReady() {
		try {
			const { connection, protocol } =
				await this.deviceManager.selectDeviceAndProtocol();
			const profileAwareProtocol = protocol as ProfileAwareProtocol;
			this.connection = connection;
			this.protocol = profileAwareProtocol;

			if (profileAwareProtocol.getLiveDataProfiles) {
				const profiles =
					await profileAwareProtocol.getLiveDataProfiles(connection);
				if (profiles.length > 0) {
					const defaultProfile = this.pickDefaultProfile(profiles);
					this.supportedProfiles = profiles;
					this.supportedPids = [];
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

	private async startStreaming(pids: number[], profileId?: string) {
		if (!this.connection || !this.protocol || !this.protocol.streamLiveData) {
			return;
		}

		const selection: LiveDataStreamSelection =
			profileId === undefined ? { pids } : { pids, profileId };
		this.activeSelection = {
			pids: [...pids],
			...(profileId === undefined ? {} : { profileId }),
		};

		this.session = this.protocol.streamLiveData(
			this.connection,
			selection,
			(frame: LiveDataFrame) => {
				this.panel?.webview.postMessage({
					type: "data",
					frame,
				});

				// Fire the onFrame event so LoggingManager (and others) can subscribe
				this._onFrame.fire(frame);
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

	private async stopStreaming() {
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
