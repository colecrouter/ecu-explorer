import { groupSerialPorts } from "@ecu-explorer/device/hardware-runtime";
import { SerialPort } from "serialport";

export interface NodeSerialPortInfo {
	path: string;
	serialNumber?: string | null;
	manufacturer?: string | null;
	vendorId?: string | null;
	productId?: string | null;
	friendlyName?: string | null;
}

export interface NodeSerialPortSession {
	readonly path: string;
	readonly isOpen: boolean;
	open(): Promise<void>;
	close(): Promise<void>;
	write(data: Uint8Array): Promise<void>;
	read(maxLength: number, timeoutMs: number): Promise<Uint8Array>;
}

export interface NodeSerialRuntime {
	listPorts(): Promise<readonly NodeSerialPortInfo[]>;
	openPort(path: string): Promise<NodeSerialPortSession>;
}

type BufferedWaiter = {
	resolve: (value: Uint8Array) => void;
	reject: (error: unknown) => void;
	timer: NodeJS.Timeout;
	maxLength: number;
};

function createBufferedReader(port: SerialPort) {
	let buffer = Buffer.alloc(0);
	const waiters: BufferedWaiter[] = [];

	const flushWaiters = () => {
		while (waiters.length > 0 && buffer.length > 0) {
			const waiter = waiters.shift();
			if (waiter == null) {
				return;
			}
			clearTimeout(waiter.timer);
			const size = Math.min(waiter.maxLength, buffer.length);
			const chunk = buffer.subarray(0, size);
			buffer = buffer.subarray(size);
			waiter.resolve(new Uint8Array(chunk));
		}
	};

	port.on("data", (chunk: Buffer) => {
		buffer = Buffer.concat([buffer, chunk]);
		flushWaiters();
	});

	port.on("close", () => {
		for (const waiter of waiters.splice(0)) {
			clearTimeout(waiter.timer);
			waiter.reject(new Error("Serial port closed"));
		}
	});

	port.on("error", (error: Error) => {
		for (const waiter of waiters.splice(0)) {
			clearTimeout(waiter.timer);
			waiter.reject(error);
		}
	});

	return {
		async read(maxLength: number, timeoutMs: number): Promise<Uint8Array> {
			if (buffer.length > 0) {
				const size = Math.min(maxLength, buffer.length);
				const chunk = buffer.subarray(0, size);
				buffer = buffer.subarray(size);
				return new Uint8Array(chunk);
			}

			return new Promise<Uint8Array>((resolve, reject) => {
				const timer = setTimeout(() => {
					const index = waiters.findIndex((entry) => entry.timer === timer);
					if (index >= 0) {
						waiters.splice(index, 1);
					}
					reject(new Error(`Serial read timed out after ${timeoutMs}ms`));
				}, timeoutMs);
				waiters.push({ resolve, reject, timer, maxLength });
			});
		},
	};
}

export async function createNodeSerialRuntime(): Promise<NodeSerialRuntime> {
	return {
		async listPorts() {
			const ports = await SerialPort.list();
			return groupSerialPorts(ports).map((port) => ({
				path: port.preferredPath,
				serialNumber: port.serialNumber ?? null,
				manufacturer: port.manufacturer ?? null,
				vendorId: port.vendorId ?? null,
				productId: port.productId ?? null,
				friendlyName: port.friendlyName ?? null,
			}));
		},
		async openPort(path: string) {
			const port = new SerialPort({
				path,
				baudRate: 115200,
				dataBits: 8,
				stopBits: 1,
				parity: "none",
				autoOpen: false,
			});
			const reader = createBufferedReader(port);

			return {
				path,
				get isOpen() {
					return port.isOpen;
				},
				async open() {
					if (port.isOpen) {
						return;
					}
					await new Promise<void>((resolve, reject) => {
						port.open((error) => (error ? reject(error) : resolve()));
					});
				},
				async close() {
					if (!port.isOpen) {
						return;
					}
					await new Promise<void>((resolve, reject) => {
						port.close((error) => (error ? reject(error) : resolve()));
					});
				},
				async write(data: Uint8Array) {
					await new Promise<void>((resolve, reject) => {
						port.write(Buffer.from(data), (error) => {
							if (error != null) {
								reject(error);
								return;
							}
							port.drain((drainError) =>
								drainError ? reject(drainError) : resolve(),
							);
						});
					});
				},
				read(maxLength: number, timeoutMs: number) {
					return reader.read(maxLength, timeoutMs);
				},
			};
		},
	};
}
