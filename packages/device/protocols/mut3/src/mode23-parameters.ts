import type {
	LiveDataProfileDescriptor,
	PidDescriptor,
} from "@ecu-explorer/device";

export interface Mode23ParameterDescriptor extends PidDescriptor {
	address: number;
	size: 1 | 2 | 4;
	decodeRaw?: (raw: number) => number;
}

const MODE23_PID_BASE = 0x9000;
const MODE23_RESEARCH_PROFILE_ID = "mitsubishi-evox-mode23-usa-research";

const RAW_MODE23_PARAMETERS: Array<{
	address: number;
	size: 1 | 2 | 4;
	name: string;
	unit?: string;
	decodeRaw?: (raw: number) => number;
	minValue?: number;
	maxValue: number;
}> = [
	// Exact matches promoted from EvoScan's "Mitsubishi EvoX Mode23 USA.xml"
	// (2011 USA GSR profile), which aligns cleanly with the traced openport2
	// address family. Ambiguous addresses stay raw until a profile selector or
	// richer formula system exists.
	{
		address: 0x4573,
		size: 1,
		name: "Long-Term Fuel Trim Idle (LTFT)",
		unit: "%",
		decodeRaw: (raw) => raw * 0.1953125 - 25,
		minValue: -25,
		maxValue: 24.8046875,
	},
	{
		address: 0x4575,
		size: 1,
		name: "Long-Term Fuel Trim Cruise (LTFT)",
		unit: "%",
		decodeRaw: (raw) => raw * 0.1953125 - 25,
		minValue: -25,
		maxValue: 24.8046875,
	},
	{
		address: 0x45c5,
		size: 1,
		name: "Cruise Light",
		unit: "raw",
		maxValue: 0xff,
	},
	{
		address: 0x8135,
		size: 1,
		name: "Knock Flag",
		unit: "byte",
		maxValue: 0xff,
	},
	{
		address: 0x867f,
		size: 1,
		name: "Engine Coolant Temperature (ECT)",
		unit: "°C",
		decodeRaw: (raw) => raw - 40,
		minValue: -40,
		maxValue: 215,
	},
	{
		address: 0x869b,
		size: 1,
		name: "Intake Air Temperature (IAT)",
		unit: "°C",
		decodeRaw: (raw) => raw - 40,
		minValue: -40,
		maxValue: 215,
	},
	{
		address: 0x86ad,
		size: 1,
		name: "Front O2 Sensor",
		unit: "V",
		decodeRaw: (raw) => raw * 0.01952,
		maxValue: 4.9776,
	},
	{
		address: 0x86b1,
		size: 1,
		name: "Rear O2 Sensor",
		unit: "V",
		decodeRaw: (raw) => raw * 0.01952,
		maxValue: 4.9776,
	},
	{
		address: 0x8733,
		size: 1,
		name: "Battery",
		unit: "V",
		decodeRaw: (raw) => raw * 0.07333,
		maxValue: 18.69915,
	},
	{
		address: 0x873d,
		size: 1,
		name: "Throttle Position (TPS)",
		unit: "%",
		decodeRaw: (raw) => (raw * 100) / 255,
		maxValue: 100,
	},
	{
		address: 0x875e,
		size: 2,
		name: "Boost Pressure",
		unit: "raw",
		maxValue: 0xffff,
	},
	{
		address: 0x878c,
		size: 2,
		name: "Engine RPM",
		unit: "rpm",
		decodeRaw: (raw) => raw * 3.90625,
		maxValue: 8000,
	},
	{
		address: 0x87b4,
		size: 2,
		name: "Engine Load",
		unit: "load",
		decodeRaw: (raw) => (raw * 10) / 32,
		maxValue: 340,
	},
	{
		address: 0x87ba,
		size: 2,
		name: "MIVEC Load",
		unit: "load",
		decodeRaw: (raw) => (raw * 10) / 32,
		maxValue: 340,
	},
	{
		address: 0x8823,
		size: 2,
		name: "Mass Airflow (MAF)",
		unit: "g/s",
		decodeRaw: (raw) => (raw * 2) / 100,
		maxValue: 1310.7,
	},
	{
		address: 0x882f,
		size: 1,
		name: "Vehicle Speed",
		unit: "km/h",
		decodeRaw: (raw) => raw * 2,
		maxValue: 510,
	},
	{
		address: 0x88e0,
		size: 1,
		name: "Short-Term Fuel Trim (STFT)",
		unit: "%",
		decodeRaw: (raw) => raw * 0.1953125 - 25,
		minValue: -25,
		maxValue: 24.8046875,
	},
	{
		address: 0x88f1,
		size: 1,
		name: "Long-Term Fuel Trim In Use (LTFT)",
		unit: "%",
		decodeRaw: (raw) => raw * 0.1953125 - 25,
		minValue: -25,
		maxValue: 24.8046875,
	},
	{
		address: 0x8a93,
		size: 1,
		name: "Knock Sum",
		unit: "count",
		maxValue: 0xff,
	},
	{
		address: 0x8b9b,
		size: 1,
		name: "WGDC Correction",
		unit: "unit",
		decodeRaw: (raw) => raw * 0.5 - 64,
		minValue: -64,
		maxValue: 63.5,
	},
	{
		address: 0x8fb0,
		size: 2,
		name: "MAF Volts",
		unit: "V",
		decodeRaw: (raw) => (raw / 1024) * 5,
		maxValue: 319.9951171875,
	},
	{
		address: 0x9552,
		size: 2,
		name: "Intake VVT Target",
		unit: "Deg",
		decodeRaw: (raw) => (raw - 4096) * -0.01953125,
		minValue: -1201.15234375,
		maxValue: 80,
	},
	{
		address: 0x955e,
		size: 2,
		name: "Exhaust VVT Target",
		unit: "Deg",
		decodeRaw: (raw) => (raw - 4096) * -0.01953125,
		minValue: -1201.15234375,
		maxValue: 80,
	},
	{
		address: 0x958a,
		size: 2,
		name: "Intake VVT Actual",
		unit: "Deg",
		decodeRaw: (raw) => (raw - 4096) * -0.01953125,
		minValue: -1201.15234375,
		maxValue: 80,
	},
	{
		address: 0x9596,
		size: 2,
		name: "Exhaust VVT Actual",
		unit: "Deg",
		decodeRaw: (raw) => (raw - 4096) * -0.01953125,
		minValue: -1201.15234375,
		maxValue: 80,
	},
];

const MODE23_PID_DESCRIPTORS: Mode23ParameterDescriptor[] =
	RAW_MODE23_PARAMETERS.map((parameter, index) => ({
		pid: MODE23_PID_BASE + index,
		address: parameter.address,
		size: parameter.size,
		name: parameter.name,
		unit: parameter.unit ?? "raw",
		...(parameter.decodeRaw ? { decodeRaw: parameter.decodeRaw } : {}),
		minValue: parameter.minValue ?? 0,
		maxValue: parameter.maxValue,
	}));

function decodeMode23Pid(pid: number): Mode23ParameterDescriptor | null {
	return (
		MODE23_PID_DESCRIPTORS.find((descriptor) => descriptor.pid === pid) ?? null
	);
}

const MODE23_RESEARCH_LIVE_DATA_PROFILE: LiveDataProfileDescriptor = {
	id: MODE23_RESEARCH_PROFILE_ID,
	name: "Evo X Mode23 USA (Research)",
	description:
		"Exact-match 2011 USDM Evo X Mode 23 map retained for research and comparison against drifting XML variants.",
	transportFamily: "can-iso15765",
	requestFamily: "mode23",
	decodeFamily: "direct-scalar",
	status: "unavailable",
	statusDetail:
		"Intentionally not exposed as a production runtime because Mode 23 request maps drift across ROM, market, and model-year variants.",
	pids: MODE23_PID_DESCRIPTORS,
};

export {
	MODE23_PID_BASE,
	MODE23_PID_DESCRIPTORS,
	MODE23_RESEARCH_LIVE_DATA_PROFILE,
	MODE23_RESEARCH_PROFILE_ID,
	decodeMode23Pid,
};
