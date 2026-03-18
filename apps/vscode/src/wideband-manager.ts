import type {
	WidebandAdapter,
	WidebandHardwareCandidate,
	WidebandReading,
	WidebandSession,
} from "@ecu-explorer/wideband";
import * as vscode from "vscode";
import type { HardwareCandidate } from "./hardware-selection.js";

export interface ActiveWidebandSession {
	adapter: WidebandAdapter;
	candidate: HardwareCandidate;
	session: WidebandSession;
}

export type WidebandConnectionState =
	| "connected"
	| "reconnecting"
	| "failed"
	| undefined;

export class WidebandManager implements vscode.Disposable {
	private adapters: WidebandAdapter[] = [];
	private _activeSession: ActiveWidebandSession | undefined;
	private _latestReading: WidebandReading | undefined;
	private _lastCandidate: HardwareCandidate | undefined;
	private _connectionState: WidebandConnectionState;
	private readonly onDidChangeSessionEmitter = new vscode.EventEmitter<
		ActiveWidebandSession | undefined
	>();
	private readonly onDidReadEmitter =
		new vscode.EventEmitter<WidebandReading>();
	private readonly onDidChangeReadingEmitter = new vscode.EventEmitter<
		WidebandReading | undefined
	>();
	private readonly onDidChangeStateEmitter = new vscode.EventEmitter<{
		state: WidebandConnectionState;
		candidate: HardwareCandidate | undefined;
	}>();

	constructor(
		private readonly listHardwareCandidates: () => Promise<
			readonly HardwareCandidate[]
		>,
	) {}

	readonly onDidChangeSession = this.onDidChangeSessionEmitter.event;
	readonly onDidRead = this.onDidReadEmitter.event;
	readonly onDidChangeReading = this.onDidChangeReadingEmitter.event;
	readonly onDidChangeState = this.onDidChangeStateEmitter.event;

	get activeSession(): ActiveWidebandSession | undefined {
		return this._activeSession;
	}

	get latestReading(): WidebandReading | undefined {
		return this._latestReading;
	}

	get lastCandidate(): HardwareCandidate | undefined {
		return this._lastCandidate;
	}

	get connectionState(): WidebandConnectionState {
		return this._connectionState;
	}

	registerAdapter(adapter: WidebandAdapter): void {
		this.adapters.push(adapter);
	}

	setAdapters(adapters: readonly WidebandAdapter[]): void {
		this.adapters = [...adapters];
	}

	getAdapters(): readonly WidebandAdapter[] {
		return [...this.adapters];
	}

	async listCandidates(): Promise<readonly HardwareCandidate[]> {
		const hardwareCandidates = await this.listHardwareCandidates();
		const matches: HardwareCandidate[] = [];

		for (const candidate of hardwareCandidates) {
			if (await this.canAnyAdapterOpen(candidate)) {
				matches.push(candidate);
			}
		}

		return matches;
	}

	async openCandidate(
		candidate: HardwareCandidate,
	): Promise<ActiveWidebandSession> {
		const adapter = await this.findMatchingAdapter(candidate);
		if (adapter == null) {
			throw new Error(`No wideband adapter matched "${candidate.device.name}"`);
		}

		if (this._activeSession != null) {
			await this._activeSession.session.close();
		}

		const session = await adapter.open(toWidebandHardwareCandidate(candidate));
		const activeSession: ActiveWidebandSession = {
			adapter,
			candidate,
			session,
		};
		this._activeSession = activeSession;
		this._lastCandidate = candidate;
		await session.startStream(
			(reading) => {
				this._latestReading = reading;
				this.onDidReadEmitter.fire(reading);
				this.onDidChangeReadingEmitter.fire(reading);
			},
			(error) => {
				void this.handleSessionError(candidate, session, error);
			},
		);
		if (this._activeSession?.session !== session) {
			return activeSession;
		}
		this.setConnectionState("connected", candidate);
		this.onDidChangeSessionEmitter.fire(this._activeSession);
		return activeSession;
	}

	async disconnect(): Promise<void> {
		if (this._activeSession == null) {
			return;
		}

		await this._activeSession.session.close();
		this._activeSession = undefined;
		this._latestReading = undefined;
		this._lastCandidate = undefined;
		this.setConnectionState(undefined, undefined);
		this.onDidChangeSessionEmitter.fire(undefined);
		this.onDidChangeReadingEmitter.fire(undefined);
	}

	dispose(): void {
		void this.disconnect();
		this.onDidReadEmitter.dispose();
		this.onDidChangeReadingEmitter.dispose();
		this.onDidChangeSessionEmitter.dispose();
		this.onDidChangeStateEmitter.dispose();
	}

	setReconnectState(
		state: Exclude<WidebandConnectionState, "connected" | undefined>,
	): void {
		this.setConnectionState(state, this._lastCandidate);
	}

	private async canAnyAdapterOpen(
		candidate: HardwareCandidate,
	): Promise<boolean> {
		for (const adapter of this.adapters) {
			if (await adapter.canOpen(toWidebandHardwareCandidate(candidate))) {
				return true;
			}
		}
		return false;
	}

	private async findMatchingAdapter(
		candidate: HardwareCandidate,
	): Promise<WidebandAdapter | undefined> {
		for (const adapter of this.adapters) {
			if (await adapter.canOpen(toWidebandHardwareCandidate(candidate))) {
				return adapter;
			}
		}
		return undefined;
	}

	private setConnectionState(
		state: WidebandConnectionState,
		candidate: HardwareCandidate | undefined,
	): void {
		this._connectionState = state;
		this.onDidChangeStateEmitter.fire({ state, candidate });
	}

	private async handleSessionError(
		candidate: HardwareCandidate,
		session: WidebandSession,
		_error: Error,
	): Promise<void> {
		if (this._activeSession?.session !== session) {
			return;
		}
		try {
			await session.close();
		} catch {
			// Ignore close errors while transitioning into recovery.
		}
		this._activeSession = undefined;
		this._latestReading = undefined;
		this._lastCandidate = candidate;
		this.setConnectionState("failed", candidate);
		this.onDidChangeSessionEmitter.fire(undefined);
		this.onDidChangeReadingEmitter.fire(undefined);
	}
}

export function toWidebandHardwareCandidate(
	candidate: HardwareCandidate,
): WidebandHardwareCandidate {
	return {
		id: candidate.device.id,
		name: candidate.device.name,
		transportName: candidate.device.transportName,
		locality: candidate.locality,
	};
}
