import type {
	DeviceConnection,
	EcuProtocol,
	LiveDataFrame,
	LiveDataProfileDescriptor,
	LiveDataSession,
	LiveDataStreamSelection,
	PidDescriptor,
} from "@ecu-explorer/device";
import { vi } from "vitest";

type TestDeviceConnection = Pick<
	DeviceConnection,
	"deviceInfo" | "sendFrame" | "startStream" | "stopStream" | "close"
>;

type TestProtocol = Pick<EcuProtocol, "name" | "canHandle"> &
	Partial<
		Pick<
			EcuProtocol,
			"getSupportedPids" | "getLiveDataProfiles" | "streamLiveData"
		>
	>;

const LIVE_DATA_PIDS = [
	{
		pid: 0x0c,
		name: "Engine RPM",
		unit: "rpm",
		minValue: 0,
		maxValue: 16383,
	},
	{
		pid: 0x0d,
		name: "Vehicle Speed",
		unit: "km/h",
		minValue: 0,
		maxValue: 255,
	},
] satisfies readonly [PidDescriptor, PidDescriptor];

export function createLiveDataPids() {
	const [engineRpm, vehicleSpeed] = LIVE_DATA_PIDS;
	return [{ ...engineRpm }, { ...vehicleSpeed }] satisfies [
		PidDescriptor,
		PidDescriptor,
	];
}

export function createLiveDataProfiles(
	overrides: Partial<LiveDataProfileDescriptor>[] = [],
) {
	const [engineRpm, vehicleSpeed] = createLiveDataPids();
	const baseProfiles: LiveDataProfileDescriptor[] = [
		{
			id: "test-ready",
			name: "Test Ready Profile",
			description: "Ready profile for live data tests.",
			transportFamily: "test",
			requestFamily: "test-request",
			decodeFamily: "direct-scalar",
			status: "ready",
			statusDetail: "Ready for streaming.",
			pids: [{ ...engineRpm }, { ...vehicleSpeed }],
		},
	];

	return baseProfiles.map((profile, index) => ({
		...profile,
		...(overrides[index] ?? {}),
	}));
}

export function createLiveDataFrame(overrides: Partial<LiveDataFrame> = {}) {
	const [engineRpm] = createLiveDataPids();
	return {
		timestamp: 100,
		pid: engineRpm.pid,
		value: 1000,
		unit: engineRpm.unit,
		...overrides,
	} satisfies LiveDataFrame;
}

export function createLiveDataConnection() {
	return {
		deviceInfo: {
			id: "test",
			name: "Test",
			transportName: "test",
			connected: true,
		},
		sendFrame: vi.fn(),
		startStream: vi.fn(),
		stopStream: vi.fn(),
		close: vi.fn(async () => {}),
	} satisfies TestDeviceConnection;
}

export function createLiveDataSession() {
	return {
		stop: vi.fn(),
	} satisfies LiveDataSession;
}

export function createLiveDataProtocol({
	supportedPids = [],
	profiles = [],
	session = createLiveDataSession(),
	onStreamStart,
}: {
	supportedPids?: readonly PidDescriptor[];
	profiles?: readonly LiveDataProfileDescriptor[];
	session?: LiveDataSession;
	onStreamStart?: (
		onFrame: (frame: LiveDataFrame) => void,
		selection: number[] | LiveDataStreamSelection,
	) => void;
} = {}) {
	return {
		name: "Test Protocol",
		canHandle: vi.fn(async () => true),
		getSupportedPids: vi.fn(async () => [...supportedPids]),
		getLiveDataProfiles: vi.fn(async () => [...profiles]),
		streamLiveData: vi.fn(
			(
				_connection: DeviceConnection,
				selection: number[] | LiveDataStreamSelection,
				onFrame: (frame: LiveDataFrame) => void,
			) => {
				onStreamStart?.(onFrame, selection);
				return session;
			},
		),
	} satisfies TestProtocol;
}
