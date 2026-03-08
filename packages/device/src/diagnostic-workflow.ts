import type {
	DeviceConnection,
	DeviceInfo,
	DeviceTransport,
	EcuProtocol,
} from "./index.js";

import { createTraceCallback, type TraceWriter } from "./trace.js";

/**
 * Diagnostic workflow stages.
 */
export enum DiagnosticStage {
	ENUMERATE = "enumerate",
	CONNECT = "connect",
	INITIALIZE = "initialize",
	PROBE = "probe",
	OPERATION = "operation",
}

/**
 * Diagnostic workflow status.
 */
export enum DiagnosticStatus {
	START = "start",
	SUCCESS = "success",
	FAILURE = "failure",
}

/**
 * Event emitted during diagnostics.
 */
export interface DiagnosticEvent {
	stage: DiagnosticStage;
	status: DiagnosticStatus;
	timestamp: number;
	duration?: number;
	summary: string;
	details?: Record<string, unknown>;
}

/**
 * Options for running diagnostics.
 */
export interface DiagnosticOptions {
	/** Specific device ID, or first available if not provided */
	deviceId?: string;
	/** Protocols to probe */
	protocols: EcuProtocol[];
	/** Optional operation to run */
	operation?: "none" | "log" | "read-rom";
	/** Duration in ms for log probe */
	logDuration?: number;
	/** Callback for diagnostic events */
	onEvent?: (event: DiagnosticEvent) => void;
	/** Optional trace writer for capturing structured events */
	traceWriter?: TraceWriter | null;
}

/**
 * Result of diagnostics.
 */
export interface DiagnosticResult {
	device: DeviceInfo | null;
	connection: DeviceConnection | null;
	protocol: EcuProtocol | null;
	events: DiagnosticEvent[];
	error?: Error;
}

/**
 * Extended DeviceConnection interface that includes optional initialize method.
 */
interface InitializableConnection extends DeviceConnection {
	initialize?(): Promise<void>;
}

/**
 * Emits a diagnostic event and calls the callback if provided.
 */
function emitEvent(
	events: DiagnosticEvent[],
	options: DiagnosticOptions,
	stage: DiagnosticStage,
	status: DiagnosticStatus,
	summary: string,
	details?: Record<string, unknown>,
): void {
	const timestamp = Date.now();
	const event: DiagnosticEvent = {
		stage,
		status,
		timestamp,
		summary,
	};
	// Only add details if provided (handles exactOptionalPropertyTypes)
	if (details !== undefined) {
		event.details = details;
	}
	events.push(event);
	options.onEvent?.(event);
}

/**
 * Run a staged device diagnostic workflow.
 *
 * This function performs the following stages:
 * 1. Enumerate devices from the transport
 * 2. Select a device by explicit ID or first available
 * 3. Connect and initialize the transport
 * 4. Probe registered protocols through canHandle()
 * 5. Run optional operation stages (log or read-rom)
 *
 * @param transport - The device transport to use
 * @param options - Diagnostic configuration options
 * @returns DiagnosticResult with device, connection, protocol, events, and optional error
 */
export async function runDiagnostic(
	transport: DeviceTransport,
	options: DiagnosticOptions,
): Promise<DiagnosticResult> {
	const events: DiagnosticEvent[] = [];

	// Create trace callback if trace writer is provided
	const traceCallback = createTraceCallback(options.traceWriter ?? null);
	const effectiveOptions: DiagnosticOptions = {
		...options,
		onEvent: (event: DiagnosticEvent) => {
			// Call original callback if provided
			options.onEvent?.(event);
			// Also write to trace if available
			traceCallback?.(event);
		},
	};

	// ─────────────────────────────────────────────────────────────────────────────
	// Stage 1: Enumerate devices
	// ─────────────────────────────────────────────────────────────────────────────
	let stageStartTime = Date.now();
	emitEvent(
		events,
		effectiveOptions,
		DiagnosticStage.ENUMERATE,
		DiagnosticStatus.START,
		"Enumerating devices...",
	);

	let devices: DeviceInfo[];
	try {
		devices = await transport.listDevices();
		const duration = Date.now() - stageStartTime;
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.ENUMERATE,
			DiagnosticStatus.SUCCESS,
			`Found ${devices.length} device(s)`,
			{ deviceCount: devices.length, duration },
		);
	} catch (error) {
		const duration = Date.now() - stageStartTime;
		const err = error instanceof Error ? error : new Error(String(error));
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.ENUMERATE,
			DiagnosticStatus.FAILURE,
			`Failed to enumerate devices: ${err.message}`,
			{ duration },
		);
		return {
			device: null,
			connection: null,
			protocol: null,
			events,
			error: err,
		};
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Stage 2: Select device
	// ─────────────────────────────────────────────────────────────────────────────
	let selectedDevice: DeviceInfo | null = null;

	if (options.deviceId) {
		// Use explicit device ID
		selectedDevice = devices.find((d) => d.id === options.deviceId) ?? null;
		if (!selectedDevice) {
			const err = new Error(`Device not found: ${options.deviceId}`);
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.ENUMERATE,
				DiagnosticStatus.FAILURE,
				err.message,
			);
			return {
				device: null,
				connection: null,
				protocol: null,
				events,
				error: err,
			};
		}
	} else {
		// Use first available device
		selectedDevice = devices[0] ?? null;
	}

	if (!selectedDevice) {
		const err = new Error("No devices available");
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.ENUMERATE,
			DiagnosticStatus.FAILURE,
			err.message,
		);
		return {
			device: null,
			connection: null,
			protocol: null,
			events,
			error: err,
		};
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Stage 3: Connect to device
	// ─────────────────────────────────────────────────────────────────────────────
	stageStartTime = Date.now();
	emitEvent(
		events,
		effectiveOptions,
		DiagnosticStage.CONNECT,
		DiagnosticStatus.START,
		`Connecting to ${selectedDevice.name}...`,
		{ deviceId: selectedDevice.id },
	);

	let connection: InitializableConnection | null = null;
	try {
		connection = (await transport.connect(
			selectedDevice.id,
		)) as InitializableConnection;
		const duration = Date.now() - stageStartTime;
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.CONNECT,
			DiagnosticStatus.SUCCESS,
			`Connected to ${selectedDevice.name}`,
			{ deviceId: selectedDevice.id, duration },
		);
	} catch (error) {
		const duration = Date.now() - stageStartTime;
		const err = error instanceof Error ? error : new Error(String(error));
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.CONNECT,
			DiagnosticStatus.FAILURE,
			`Failed to connect: ${err.message}`,
			{ deviceId: selectedDevice.id, duration },
		);
		return {
			device: selectedDevice,
			connection: null,
			protocol: null,
			events,
			error: err,
		};
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Stage 4: Initialize connection (if available)
	// ─────────────────────────────────────────────────────────────────────────────
	stageStartTime = Date.now();

	if (typeof connection.initialize === "function") {
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.INITIALIZE,
			DiagnosticStatus.START,
			"Initializing connection...",
		);

		try {
			await connection.initialize();
			const duration = Date.now() - stageStartTime;
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.INITIALIZE,
				DiagnosticStatus.SUCCESS,
				"Connection initialized",
				{ duration },
			);
		} catch (error) {
			const duration = Date.now() - stageStartTime;
			const err = error instanceof Error ? error : new Error(String(error));
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.INITIALIZE,
				DiagnosticStatus.FAILURE,
				`Failed to initialize: ${err.message}`,
				{ duration },
			);
			// Close connection on initialization failure
			await connection.close();
			return {
				device: selectedDevice,
				connection: null,
				protocol: null,
				events,
				error: err,
			};
		}
	} else {
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.INITIALIZE,
			DiagnosticStatus.SUCCESS,
			"Initialization skipped (not supported)",
		);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Stage 5: Probe protocols
	// ─────────────────────────────────────────────────────────────────────────────
	stageStartTime = Date.now();
	emitEvent(
		events,
		effectiveOptions,
		DiagnosticStage.PROBE,
		DiagnosticStatus.START,
		"Probing protocols...",
		{ protocolCount: options.protocols.length },
	);

	let matchedProtocol: EcuProtocol | null = null;

	for (const protocol of options.protocols) {
		try {
			const canHandle = await protocol.canHandle(connection);
			if (canHandle) {
				matchedProtocol = protocol;
				const duration = Date.now() - stageStartTime;
				emitEvent(
					events,
					effectiveOptions,
					DiagnosticStage.PROBE,
					DiagnosticStatus.SUCCESS,
					`Matched protocol: ${protocol.name}`,
					{ protocol: protocol.name, duration },
				);
				break;
			}
		} catch (error) {
			// Continue probing other protocols on error
			const err = error instanceof Error ? error : new Error(String(error));
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.PROBE,
				DiagnosticStatus.FAILURE,
				`Protocol ${protocol.name} probe failed: ${err.message}`,
				{ protocol: protocol.name },
			);
		}
	}

	if (!matchedProtocol) {
		const duration = Date.now() - stageStartTime;
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.PROBE,
			DiagnosticStatus.FAILURE,
			"No matching protocol found",
			{ duration },
		);
		// Don't return here - allow operation stage to run even without protocol
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Stage 6: Run optional operation
	// ─────────────────────────────────────────────────────────────────────────────
	const operation = options.operation ?? "none";

	if (operation === "none") {
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.OPERATION,
			DiagnosticStatus.SUCCESS,
			"No operation requested",
		);
	} else if (matchedProtocol) {
		stageStartTime = Date.now();

		if (operation === "log") {
			// Run log probe: start a short-lived live data session
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.OPERATION,
				DiagnosticStatus.START,
				"Starting log probe...",
				{ operation, duration: options.logDuration ?? 1000 },
			);

			const protocol = matchedProtocol;
			if (protocol.streamLiveData) {
				try {
					const session = protocol.streamLiveData(
						connection,
						[0x0c], // Engine RPM PID
						(_frame) => {
							// Frame received - just count it
						},
					);

					// Run for specified duration
					const logDuration = options.logDuration ?? 1000;
					await new Promise((resolve) => setTimeout(resolve, logDuration));

					session.stop();
					const duration = Date.now() - stageStartTime;
					emitEvent(
						events,
						effectiveOptions,
						DiagnosticStage.OPERATION,
						DiagnosticStatus.SUCCESS,
						"Log probe completed",
						{ operation, duration },
					);
				} catch (error) {
					const duration = Date.now() - stageStartTime;
					const err = error instanceof Error ? error : new Error(String(error));
					emitEvent(
						events,
						effectiveOptions,
						DiagnosticStage.OPERATION,
						DiagnosticStatus.FAILURE,
						`Log probe failed: ${err.message}`,
						{ operation, duration },
					);
				}
			} else {
				const duration = Date.now() - stageStartTime;
				emitEvent(
					events,
					effectiveOptions,
					DiagnosticStage.OPERATION,
					DiagnosticStatus.FAILURE,
					"Protocol does not support live data streaming",
					{ operation, duration },
				);
			}
		} else if (operation === "read-rom") {
			// Run ROM read dry run
			emitEvent(
				events,
				effectiveOptions,
				DiagnosticStage.OPERATION,
				DiagnosticStatus.START,
				"Starting ROM read dry run...",
				{ operation },
			);

			const protocol = matchedProtocol;
			if (protocol.dryRunWrite) {
				try {
					// Use a minimal ROM for dry run
					const minimalRom = new Uint8Array(256);
					await protocol.dryRunWrite(connection, minimalRom, () => {
						// Progress callback - ignore for dry run
					});
					const duration = Date.now() - stageStartTime;
					emitEvent(
						events,
						effectiveOptions,
						DiagnosticStage.OPERATION,
						DiagnosticStatus.SUCCESS,
						"ROM read dry run completed",
						{ operation, duration },
					);
				} catch (error) {
					const duration = Date.now() - stageStartTime;
					const err = error instanceof Error ? error : new Error(String(error));
					emitEvent(
						events,
						effectiveOptions,
						DiagnosticStage.OPERATION,
						DiagnosticStatus.FAILURE,
						`ROM read dry run failed: ${err.message}`,
						{ operation, duration },
					);
				}
			} else if (protocol.readRom) {
				try {
					// Try actual read (not dry run) if dryRunWrite not available
					await protocol.readRom(connection, () => {
						// Progress callback
					});
					const duration = Date.now() - stageStartTime;
					emitEvent(
						events,
						effectiveOptions,
						DiagnosticStage.OPERATION,
						DiagnosticStatus.SUCCESS,
						"ROM read completed",
						{ operation, duration },
					);
				} catch (error) {
					const duration = Date.now() - stageStartTime;
					const err = error instanceof Error ? error : new Error(String(error));
					emitEvent(
						events,
						effectiveOptions,
						DiagnosticStage.OPERATION,
						DiagnosticStatus.FAILURE,
						`ROM read failed: ${err.message}`,
						{ operation, duration },
					);
				}
			} else {
				const duration = Date.now() - stageStartTime;
				emitEvent(
					events,
					effectiveOptions,
					DiagnosticStage.OPERATION,
					DiagnosticStatus.FAILURE,
					"Protocol does not support ROM operations",
					{ operation, duration },
				);
			}
		}
	} else {
		emitEvent(
			events,
			effectiveOptions,
			DiagnosticStage.OPERATION,
			DiagnosticStatus.FAILURE,
			`Operation '${operation}' requires a matched protocol`,
		);
	}

	// ─────────────────────────────────────────────────────────────────────────────
	// Return result
	// ─────────────────────────────────────────────────────────────────────────────
	return {
		device: selectedDevice,
		connection,
		protocol: matchedProtocol,
		events,
	};
}
