/**
 * inspect-device - CLI tool for device diagnostics and protocol probing.
 *
 * Outputs YAML/markdown inspection output compatible with MCP formatting.
 *
 * @module
 */

import sade from "sade";
// Import from device package
import {
	DiagnosticStage,
	DiagnosticStatus,
	runDiagnostic,
	TraceWriter,
} from "../device/dist/index.js";
// Protocol imports
import { Obd2Protocol } from "../device/protocols/obd2/dist/index.js";
import { OpenPort2Transport } from "../device/transports/openport2/dist/index.js";
// Import formatters from MCP package
import { formatDiagnosticOutput } from "../mcp/dist/formatters/diagnostics-formatter.js";

// Suppress console.warn since we handle errors explicitly
console.warn = () => {};

/**
 * @typedef {import("../device/dist/index.js").DiagnosticEvent} DiagnosticEvent
 * @typedef {import("../device/dist/index.js").DiagnosticResult} DiagnosticResult
 * @typedef {import("../device/dist/index.js").DeviceInfo} DeviceInfo
 */

/**
 * Creates a USB interface wrapper for node-usb library.
 * This allows the OpenPort2Transport to work in Node.js environments.
 *
 * @returns {Promise<USB>}
 */
async function createNodeUSBInterface() {
	try {
		// Dynamic import of node-usb
		const usb = await import("usb");

		// Create a USB interface wrapper
		/** @type {any} */
		const usbInterface = {
			async getDevices() {
				try {
					// Get all USB devices
					const deviceList = usb.getDeviceList();

					// Convert node-usb devices to WebUSB-compatible format
					return deviceList.map((nodeDevice) => {
						return createWebUsbDevice(nodeDevice);
					});
				} catch (error) {
					console.error("Failed to get USB devices:", error);
					return [];
				}
			},

			/** @param {any} _options */
			async requestDevice(_options) {
				// In Node.js, we don't have a browser device picker
				// Instead, we return the first matching device
				const devices = await this.getDevices();
				if (devices.length === 0) {
					throw new Error(
						"No USB devices found. Please connect an OpenPort 2.0 device.",
					);
				}
				return devices[0];
			},
		};

		return /** @type {USB} */ (usbInterface);
	} catch (error) {
		console.error("Failed to create USB interface:", error);
		throw error;
	}
}

/**
 * Creates a WebUSB-compatible device from a node-usb device.
 *
 * @param {any} nodeDevice - The node-usb device instance
 * @returns {USBDevice}
 */
function createWebUsbDevice(nodeDevice) {
	const vendorId = nodeDevice.deviceDescriptor.idVendor;
	const productId = nodeDevice.deviceDescriptor.idProduct;
	const serialNumber = getSerialNumber(nodeDevice);
	const productName = getProductName(nodeDevice);

	// Store reference to node-usb device for actual transfers
	const _deviceHandle = nodeDevice;

	// Create the device object with WebUSB-compatible interface
	/** @type {any} */
	const device = {
		vendorId,
		productId,
		serialNumber,
		productName,
		opened: false,
		configuration: null,
		configurations: [],
		deviceClass: nodeDevice.deviceDescriptor.bDeviceClass,
		deviceSubClass: nodeDevice.deviceDescriptor.bDeviceSubClass,
		deviceProtocol: nodeDevice.deviceDescriptor.bDeviceProtocol,
		busNumber: nodeDevice.busNumber,
		deviceAddress: nodeDevice.deviceAddress,
		portNumber: 0,
		manufacturerName: getManufacturerName(nodeDevice),
	};

	// Add methods
	device.open = async () => {
		try {
			nodeDevice.open();
			device.opened = true;
		} catch (error) {
			throw new Error(`Failed to open USB device: ${error}`);
		}
	};

	device.close = async () => {
		try {
			nodeDevice.close();
			device.opened = false;
		} catch (error) {
			throw new Error(`Failed to close USB device: ${error}`);
		}
	};

	/** @param {number} interfaceNumber */
	device.claimInterface = async (interfaceNumber) => {
		try {
			nodeDevice.interface(interfaceNumber).claim();
		} catch (error) {
			throw new Error(`Failed to claim interface: ${error}`);
		}
	};

	/** @param {number} interfaceNumber */
	device.releaseInterface = async (interfaceNumber) => {
		try {
			const intf = nodeDevice.interface(interfaceNumber);
			if (intf.isClaimed) {
				intf.release();
			}
		} catch (_error) {
			// Ignore release errors
		}
	};

	/**
	 * @param {number} endpointNumber
	 * @param {number} length
	 */
	device.transferIn = async (endpointNumber, length) =>
		new Promise((resolve, reject) => {
			// Find the input endpoint
			let endpoint = null;
			if (nodeDevice.interfaces?.[0]) {
				const endpoints = nodeDevice.interfaces[0].endpoints || [];
				endpoint = endpoints.find(
					(/** @type {any} */ e) =>
						e.direction === "in" && e.address === endpointNumber,
				);
			}

			if (!endpoint) {
				reject(new Error(`Endpoint ${endpointNumber} not found`));
				return;
			}

			const buffer = Buffer.alloc(length);
			endpoint.transfer(
				buffer,
				(/** @type {any} */ error, /** @type {any} */ transferred) => {
					if (error) {
						reject(new Error(`Transfer failed: ${error}`));
						return;
					}
					resolve({
						data: buffer.slice(0, transferred),
						status: "ok",
					});
				},
			);
		});

	/**
	 * @param {number} endpointNumber
	 * @param {Uint8Array} data
	 */
	device.transferOut = async (endpointNumber, data) =>
		new Promise((resolve, reject) => {
			// Find the output endpoint
			let endpoint = null;
			if (nodeDevice.interfaces?.[0]) {
				const endpoints = nodeDevice.interfaces[0].endpoints || [];
				endpoint = endpoints.find(
					(/** @type {any} */ e) =>
						e.direction === "out" && e.address === endpointNumber,
				);
			}

			if (!endpoint) {
				reject(new Error(`Endpoint ${endpointNumber} not found`));
				return;
			}

			// Convert Uint8Array to Buffer if needed
			const buffer =
				data instanceof Uint8Array
					? Buffer.from(data.buffer, data.byteOffset, data.length)
					: Buffer.from(data);

			endpoint.transfer(
				buffer,
				(/** @type {any} */ error, /** @type {any} */ transferred) => {
					if (error) {
						reject(new Error(`Transfer failed: ${error}`));
						return;
					}
					resolve({
						bytesWritten: transferred,
						status: "ok",
					});
				},
			);
		});

	return /** @type {USBDevice} */ (device);
}

/**
 * @param {any} device
 * @returns {string | null}
 */
function getSerialNumber(device) {
	try {
		return device.serialNumber || null;
	} catch {
		return null;
	}
}

/**
 * @param {any} device
 * @returns {string | null}
 */
function getProductName(device) {
	try {
		return device.productName || null;
	} catch {
		return null;
	}
}

/**
 * @param {any} device
 * @returns {string | null}
 */
function getManufacturerName(device) {
	try {
		return device.manufacturerName || null;
	} catch {
		return null;
	}
}

/**
 * Convert internal DiagnosticEvent to formatter-compatible format.
 *
 * @param {DiagnosticEvent} event
 * @returns {any}
 */
function convertEvent(event) {
	return {
		stage: event.stage,
		status: event.status,
		timestamp: event.timestamp,
		duration: event.duration,
		summary: event.summary,
		details: event.details,
	};
}

/**
 * Convert internal DiagnosticResult to formatter-compatible format.
 *
 * @param {DiagnosticResult} result
 * @returns {any}
 */
function convertResult(result) {
	return {
		device: result.device
			? { id: result.device.id, name: result.device.name }
			: null,
		connection: result.connection
			? {
					deviceInfo: {
						id: result.connection.deviceInfo.id,
						name: result.connection.deviceInfo.name,
					},
				}
			: null,
		protocol: result.protocol ? { name: result.protocol.name } : null,
		events: result.events.map(convertEvent),
		error: result.error,
	};
}

/**
 * Registered protocols for probing.
 */
const registeredProtocols = [
	new Obd2Protocol(),
	// Additional protocols can be added here as they become available:
	// new Mut3Protocol(),
	// new SubaruSsmProtocol(),
	// new UdsProtocol(),
];

/**
 * Handle diagnostic events for verbose output.
 *
 * @param {boolean} verbose
 * @param {((event: DiagnosticEvent) => void)} [onEvent]
 * @returns {(event: DiagnosticEvent) => void}
 */
function createEventHandler(verbose, onEvent) {
	return (event) => {
		if (verbose) {
			const statusIcon =
				event.status === DiagnosticStatus.SUCCESS
					? "✓"
					: event.status === DiagnosticStatus.FAILURE
						? "✗"
						: "○";
			console.error(`  ${statusIcon} [${event.stage}] ${event.summary}`);
		}
		if (onEvent) {
			onEvent(event);
		}
	};
}

/**
 * List connected devices.
 *
 * @param {any} opts
 * @returns {Promise<void>}
 */
async function listDevices(opts) {
	const usb = await createNodeUSBInterface();
	const transport = new OpenPort2Transport(/** @type {any} */ ({ usb }));

	const traceWriter = opts.traceFile
		? new TraceWriter(opts.traceFile)
		: undefined;

	try {
		if (opts.verbose) {
			console.error("Enumerating devices...");
		}

		const devices = await transport.listDevices();

		if (opts.verbose) {
			console.error(`Found ${devices.length} device(s)`);
		}

		// Create a simple result for the formatter
		/** @type {DiagnosticResult} */
		const result = {
			device: devices[0] ?? null,
			connection: null,
			protocol: null,
			events: [
				{
					stage: DiagnosticStage.ENUMERATE,
					status: DiagnosticStatus.SUCCESS,
					timestamp: Date.now(),
					summary: `Found ${devices.length} device(s)`,
					details: { deviceCount: devices.length },
				},
			],
		};

		// Format and output
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}
		const output = formatDiagnosticOutput(
			"list",
			convertResult(result),
			tracePath,
		);
		console.log(output);
	} catch (error) {
		const err = error instanceof Error ? error : new Error(String(error));
		/** @type {DiagnosticResult} */
		const result = {
			device: null,
			connection: null,
			protocol: null,
			events: [
				{
					stage: DiagnosticStage.ENUMERATE,
					status: DiagnosticStatus.FAILURE,
					timestamp: Date.now(),
					summary: err.message,
				},
			],
			error: err,
		};

		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}
		const output = formatDiagnosticOutput(
			"list",
			convertResult(result),
			tracePath,
		);
		console.log(output);
		throw error;
	}
}

/**
 * Connect to a device.
 *
 * @param {any} opts
 * @returns {Promise<void>}
 */
async function connectDevice(opts) {
	const usb = await createNodeUSBInterface();
	const transport = new OpenPort2Transport(/** @type {any} */ ({ usb }));

	const traceWriter = opts.traceFile
		? new TraceWriter(opts.traceFile)
		: undefined;

	const eventHandler = createEventHandler(opts.verbose ?? false);

	try {
		if (opts.verbose) {
			console.error("Running diagnostic workflow...");
		}

		const result = await runDiagnostic(transport, {
			deviceId: opts.device,
			protocols: registeredProtocols,
			operation: "none",
			onEvent: eventHandler,
			traceWriter: traceWriter ?? null,
		});

		// Close trace writer
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		// Format and output
		const output = formatDiagnosticOutput(
			"connect",
			convertResult(result),
			tracePath,
		);
		console.log(output);

		if (result.error) {
			throw result.error;
		}
	} catch (error) {
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		const err = error instanceof Error ? error : new Error(String(error));
		/** @type {DiagnosticResult} */
		const result = {
			device: null,
			connection: null,
			protocol: null,
			events: [
				{
					stage: DiagnosticStage.CONNECT,
					status: DiagnosticStatus.FAILURE,
					timestamp: Date.now(),
					summary: err.message,
				},
			],
			error: err,
		};

		const output = formatDiagnosticOutput(
			"connect",
			convertResult(result),
			tracePath,
		);
		console.log(output);
		throw error;
	}
}

/**
 * Probe for protocols.
 *
 * @param {any} opts
 * @returns {Promise<void>}
 */
async function probeDevice(opts) {
	const usb = await createNodeUSBInterface();
	const transport = new OpenPort2Transport(/** @type {any} */ ({ usb }));

	const traceWriter = opts.traceFile
		? new TraceWriter(opts.traceFile)
		: undefined;

	const eventHandler = createEventHandler(opts.verbose ?? false);

	try {
		if (opts.verbose) {
			console.error("Probing for protocols...");
		}

		const result = await runDiagnostic(transport, {
			deviceId: opts.device,
			protocols: registeredProtocols,
			operation: "none",
			onEvent: eventHandler,
			traceWriter: traceWriter ?? null,
		});

		// Close trace writer
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		// Format and output
		const output = formatDiagnosticOutput(
			"probe",
			convertResult(result),
			tracePath,
		);
		console.log(output);

		if (result.error) {
			throw result.error;
		}
	} catch (error) {
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		const err = error instanceof Error ? error : new Error(String(error));
		/** @type {DiagnosticResult} */
		const result = {
			device: null,
			connection: null,
			protocol: null,
			events: [
				{
					stage: DiagnosticStage.PROBE,
					status: DiagnosticStatus.FAILURE,
					timestamp: Date.now(),
					summary: err.message,
				},
			],
			error: err,
		};

		const output = formatDiagnosticOutput(
			"probe",
			convertResult(result),
			tracePath,
		);
		console.log(output);
		throw error;
	}
}

/**
 * Run a logging probe.
 *
 * @param {any} opts
 * @returns {Promise<void>}
 */
async function logDevice(opts) {
	const usb = await createNodeUSBInterface();
	const transport = new OpenPort2Transport(/** @type {any} */ ({ usb }));

	const traceWriter = opts.traceFile
		? new TraceWriter(opts.traceFile)
		: undefined;

	const eventHandler = createEventHandler(opts.verbose ?? false);

	try {
		if (opts.verbose) {
			console.error(`Running log probe for ${opts.duration ?? 1000}ms...`);
		}

		const result = await runDiagnostic(transport, {
			deviceId: opts.device,
			protocols: registeredProtocols,
			operation: "log",
			logDuration: opts.duration ?? 1000,
			onEvent: eventHandler,
			traceWriter: traceWriter ?? null,
		});

		// Close trace writer
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		// Format and output
		const output = formatDiagnosticOutput(
			"log",
			convertResult(result),
			tracePath,
		);
		console.log(output);

		if (result.error) {
			throw result.error;
		}
	} catch (error) {
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		const err = error instanceof Error ? error : new Error(String(error));
		/** @type {DiagnosticResult} */
		const result = {
			device: null,
			connection: null,
			protocol: null,
			events: [
				{
					stage: DiagnosticStage.OPERATION,
					status: DiagnosticStatus.FAILURE,
					timestamp: Date.now(),
					summary: err.message,
				},
			],
			error: err,
		};

		const output = formatDiagnosticOutput(
			"log",
			convertResult(result),
			tracePath,
		);
		console.log(output);
		throw error;
	}
}

/**
 * Run a ROM read (dry run).
 *
 * @param {any} opts
 * @returns {Promise<void>}
 */
async function readRomDevice(opts) {
	const usb = await createNodeUSBInterface();
	const transport = new OpenPort2Transport(/** @type {any} */ ({ usb }));

	const traceWriter = opts.traceFile
		? new TraceWriter(opts.traceFile)
		: undefined;

	const eventHandler = createEventHandler(opts.verbose ?? false);

	try {
		if (opts.verbose) {
			console.error("Running ROM read (dry run)...");
		}

		const result = await runDiagnostic(transport, {
			deviceId: opts.device,
			protocols: registeredProtocols,
			operation: "read-rom",
			onEvent: eventHandler,
			traceWriter: traceWriter ?? null,
		});

		// Close trace writer
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		// Format and output
		const output = formatDiagnosticOutput(
			"read-rom",
			convertResult(result),
			tracePath,
		);
		console.log(output);

		if (result.error) {
			throw result.error;
		}
	} catch (error) {
		let tracePath;
		if (traceWriter) {
			await traceWriter.close();
			tracePath = opts.traceFile;
		}

		const err = error instanceof Error ? error : new Error(String(error));
		/** @type {DiagnosticResult} */
		const result = {
			device: null,
			connection: null,
			protocol: null,
			events: [
				{
					stage: DiagnosticStage.OPERATION,
					status: DiagnosticStatus.FAILURE,
					timestamp: Date.now(),
					summary: err.message,
				},
			],
			error: err,
		};

		const output = formatDiagnosticOutput(
			"read-rom",
			convertResult(result),
			tracePath,
		);
		console.log(output);
		throw error;
	}
}

// Create CLI with Sade
const prog = sade("inspect-device");

prog
	.version("1.0.0")
	.describe("Device diagnostics and protocol probing tool")
	.example("inspect-device list")
	.example("inspect-device connect --device openport2:ABC123")
	.example("inspect-device probe --verbose")
	.example("inspect-device log --duration 5000")
	.example("inspect-device read-rom --dry-run");

// Global options
prog
	.option("-d, --device", "Specific device ID (otherwise uses first available)")
	.option("-v, --verbose", "Enable verbose output")
	.option("--trace-file", "Write trace output to file");

// List subcommand
prog
	.command("list")
	.describe("Enumerate compatible OpenPort 2.0 devices")
	.action((opts) => {
		listDevices({
			device: opts.device,
			verbose: opts.verbose,
			traceFile: opts.traceFile,
		}).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

// Connect subcommand
prog
	.command("connect")
	.describe("Connect to a device and initialize transport")
	.action((opts) => {
		connectDevice({
			device: opts.device,
			verbose: opts.verbose,
			traceFile: opts.traceFile,
		}).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

// Probe subcommand
prog
	.command("probe")
	.describe("Connect and probe for protocols via canHandle()")
	.action((opts) => {
		probeDevice({
			device: opts.device,
			verbose: opts.verbose,
			traceFile: opts.traceFile,
		}).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

// Log subcommand
prog
	.command("log")
	.describe("Run a logging probe for specified duration")
	.option("--duration", "Duration in milliseconds", 1000)
	.action((opts) => {
		logDevice({
			device: opts.device,
			verbose: opts.verbose,
			traceFile: opts.traceFile,
			duration: opts.duration,
		}).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

// Read ROM subcommand
prog
	.command("read-rom")
	.describe("Test ROM-read path (with optional dry-run)")
	.option("--dry-run", "Perform dry run without actual ROM read", true)
	.action((opts) => {
		readRomDevice({
			device: opts.device,
			verbose: opts.verbose,
			traceFile: opts.traceFile,
			dryRun: opts.dryRun,
		}).catch((err) => {
			console.error(err instanceof Error ? err.message : String(err));
			process.exit(1);
		});
	});

prog.parse(process.argv);
