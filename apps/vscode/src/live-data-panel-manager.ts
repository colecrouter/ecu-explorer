import type {
	DeviceConnection,
	EcuProtocol,
	LiveDataFrame,
	LiveDataHealth,
	LiveDataProfileDescriptor,
	LiveDataSession,
} from "@ecu-explorer/device";
import * as vscode from "vscode";
import type { DeviceManagerImpl } from "./device-manager.js";

export class LiveDataPanelManager {
	private panel: vscode.WebviewPanel | undefined;
	private session: LiveDataSession | undefined;
	private connection: DeviceConnection | undefined;
	private protocol: EcuProtocol | undefined;

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
			this.connection = connection;
			this.protocol = protocol;

			if (protocol.getLiveDataProfiles) {
				const profiles = await protocol.getLiveDataProfiles(connection);
				if (profiles.length > 0) {
					const defaultProfile = this.pickDefaultProfile(profiles);
					this.panel?.webview.postMessage({
						type: "supportedProfiles",
						profiles,
						selectedProfileId: defaultProfile?.id,
					});
					return;
				}
			}

			if (protocol.getSupportedPids) {
				const pids = await protocol.getSupportedPids(connection);
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

		const selection =
			profileId === undefined ? { pids } : { pids, profileId };

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

		this.panel?.webview.postMessage({ type: "streamingStopped" });
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
