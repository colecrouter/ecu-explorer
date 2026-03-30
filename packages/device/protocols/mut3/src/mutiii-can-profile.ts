import type { PidDescriptor } from "@ecu-explorer/device";
import type { Mut3LoggingProfile } from "./logging-profiles.js";

const MUTIII_CAN_PID_BASE = 0x9000;

interface BuiltinMutiiiCanChannel {
	channelKey: string;
	displayName: string;
	logReference: string | null;
	request: {
		bank: number;
		slot: number;
		raw: string;
	};
	decode: {
		eval: string | null;
		metricEval: string | null;
		unit: string | null;
		metricUnit: string | null;
		responseBytes: number | null;
		signed: boolean;
	};
}

const BUILTIN_EVOX_CAN_MUTIII_CHANNELS: BuiltinMutiiiCanChannel[] = [
	{
		channelKey: "BATTERY",
		displayName: "Battery Level",
		logReference: "Battery",
		request: { bank: 0, slot: 0, raw: "CAN0-0" },
		decode: {
			eval: "0.07333*x",
			metricEval: null,
			unit: "V",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "TPS",
		displayName: "Throttle Position (TPS)",
		logReference: "TPS",
		request: { bank: 1, slot: 2, raw: "CAN1-2" },
		decode: {
			eval: "100*x/255",
			metricEval: null,
			unit: "%",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "RPM",
		displayName: "RPM",
		logReference: "RPM",
		request: { bank: 2, slot: 2, raw: "CAN2-2" },
		decode: {
			eval: "31.25*x",
			metricEval: null,
			unit: "RPM",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "SPEED",
		displayName: "Speed",
		logReference: "Speed",
		request: { bank: 3, slot: 1, raw: "CAN3-1" },
		decode: {
			eval: "1.2427424*x",
			metricEval: "2*x",
			unit: "Mph",
			metricUnit: "Kph",
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "AIRTEMP",
		displayName: "Air Temperature",
		logReference: "AirTemp",
		request: { bank: 4, slot: 0, raw: "CAN4-0" },
		decode: {
			eval: "x*1.8+32",
			metricEval: "x",
			unit: "deg F",
			metricUnit: "deg C",
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "LOAD",
		displayName: "Load",
		logReference: "Load",
		request: { bank: 27, slot: 0, raw: "CAN27-0" },
		decode: {
			eval: "x",
			metricEval: null,
			unit: "%",
			metricUnit: null,
			responseBytes: 2,
			signed: false,
		},
	},
	{
		channelKey: "COOLANTTEMP",
		displayName: "Coolant Temp",
		logReference: "CoolantTemp",
		request: { bank: 5, slot: 0, raw: "CAN5-0" },
		decode: {
			eval: "x*1.8+32",
			metricEval: "x",
			unit: "deg F",
			metricUnit: "deg C",
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "BOOST",
		displayName: "Boost (MAP)",
		logReference: "Boost",
		request: { bank: 6, slot: 0, raw: "CAN6-0" },
		decode: {
			eval: "0.49*x",
			metricEval: null,
			unit: "kPa",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "TIMINGADV",
		displayName: "Timing Advance",
		logReference: "TimingAdv",
		request: { bank: 11, slot: 0, raw: "CAN11-0" },
		decode: {
			eval: "x-20",
			metricEval: null,
			unit: "CA",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "KNOCKSUM",
		displayName: "Knock Sum",
		logReference: "KnockSum",
		request: { bank: 11, slot: 1, raw: "CAN11-1" },
		decode: {
			eval: "x",
			metricEval: null,
			unit: "count",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "INJPULSEWIDTH",
		displayName: "Injector Pulse Width",
		logReference: "InjPulseWidth",
		request: { bank: 8, slot: 1, raw: "CAN8-1" },
		decode: {
			eval: "0.256*x",
			metricEval: null,
			unit: "ms",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "LTFT_BANK1",
		displayName: "Fuel Trim (LTFT)",
		logReference: "LTFT_Bank1",
		request: { bank: 9, slot: 2, raw: "CAN9-2" },
		decode: {
			eval: "(0.1961*x)-25",
			metricEval: null,
			unit: "%",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "KNOCKRETARD",
		displayName: "Knock Retard",
		logReference: "KnockRetard",
		request: { bank: 11, slot: 2, raw: "CAN11-2" },
		decode: {
			eval: "x",
			metricEval: null,
			unit: "deg",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "STFT_BANK1",
		displayName: "Oxygen Feedback Trim (STFT)",
		logReference: "STFT_Bank1",
		request: { bank: 10, slot: 1, raw: "CAN10-1" },
		decode: {
			eval: "(0.1961*x)-25",
			metricEval: null,
			unit: "%",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "TRANS_TEMP",
		displayName: "Transmission Temp",
		logReference: "Trans_Temp",
		request: { bank: 28, slot: 0, raw: "CAN28-0" },
		decode: {
			eval: "x-50",
			metricEval: "x-50",
			unit: "Deg F",
			metricUnit: "Deg C",
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "OCTANEFLAG",
		displayName: "Octane Level",
		logReference: "OctaneFlag",
		request: { bank: 12, slot: 3, raw: "CAN12-3" },
		decode: {
			eval: "100*x/255",
			metricEval: null,
			unit: "%",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "VVTINTAKE",
		displayName: "VVT Intake",
		logReference: "VVTIntake",
		request: { bank: 13, slot: 0, raw: "CAN13-0" },
		decode: {
			eval: "x-20",
			metricEval: null,
			unit: "deg",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "VVTEXHAUST",
		displayName: "VVT Exhaust",
		logReference: "VVTExhaust",
		request: { bank: 14, slot: 0, raw: "CAN14-0" },
		decode: {
			eval: "x-20",
			metricEval: null,
			unit: "deg",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "PURGERELAYDUTY",
		displayName: "Purge Relay Duty",
		logReference: "PurgeRelayDuty",
		request: { bank: 15, slot: 0, raw: "CAN15-0" },
		decode: {
			eval: "100*x/255",
			metricEval: null,
			unit: "%",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "THROTTLEACTUATOR",
		displayName: "Throttle Actuator",
		logReference: "ThrottleActuator",
		request: { bank: 16, slot: 2, raw: "CAN16-2" },
		decode: {
			eval: "100*x/255",
			metricEval: null,
			unit: "%",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "ETVIDLEOPEN",
		displayName: "ETV Idle Open",
		logReference: "ETVIdleOpen",
		request: { bank: 17, slot: 0, raw: "CAN17-0" },
		decode: {
			eval: "0.0195*x",
			metricEval: null,
			unit: "V",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "ISCLEARNACOFF",
		displayName: "ISC Learn (A/C off)",
		logReference: "ISCLearnACoff",
		request: { bank: 18, slot: 0, raw: "CAN18-0" },
		decode: {
			eval: "x",
			metricEval: null,
			unit: "L/S",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "ISCLEARNACON",
		displayName: "ISC Learn (A/C on)",
		logReference: "ISCLearnACon",
		request: { bank: 19, slot: 1, raw: "CAN19-1" },
		decode: {
			eval: "x",
			metricEval: null,
			unit: "L/S",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "ABSLOAD",
		displayName: "Absolute Load",
		logReference: "AbsLoad",
		request: { bank: 20, slot: 0, raw: "CAN20-0" },
		decode: {
			eval: "x",
			metricEval: null,
			unit: "%",
			metricUnit: null,
			responseBytes: 2,
			signed: false,
		},
	},
	{
		channelKey: "ACCLOAD",
		displayName: "Accelerate Load",
		logReference: "AccLoad",
		request: { bank: 21, slot: 2, raw: "CAN21-2" },
		decode: {
			eval: "x",
			metricEval: null,
			unit: "%",
			metricUnit: null,
			responseBytes: 2,
			signed: false,
		},
	},
	{
		channelKey: "ACTIVEWGDC",
		displayName: "Active WGDC",
		logReference: "ActiveWGDC",
		request: { bank: 26, slot: 0, raw: "CAN26-0" },
		decode: {
			eval: "x/2",
			metricEval: null,
			unit: "%",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "PASSIVEWGDC",
		displayName: "Passive WGDC",
		logReference: "PassiveWGDC",
		request: { bank: 26, slot: 1, raw: "CAN26-1" },
		decode: {
			eval: "x/2",
			metricEval: null,
			unit: "%",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "TARGETIDLERPM",
		displayName: "Target Idle RPM",
		logReference: "TargetIdleRPM",
		request: { bank: 2, slot: 0, raw: "CAN2-0" },
		decode: {
			eval: "7.8*x",
			metricEval: null,
			unit: "rpm",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "AIRFLOW",
		displayName: "Airflow",
		logReference: "AirFlow",
		request: { bank: 22, slot: 3, raw: "CAN22-3" },
		decode: {
			eval: "6.25*x",
			metricEval: null,
			unit: "g/s",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "O2SENSOR",
		displayName: "Oxygen Sensor Front",
		logReference: "O2Sensor",
		request: { bank: 23, slot: 0, raw: "CAN23-0" },
		decode: {
			eval: "0.01952*x",
			metricEval: null,
			unit: "V",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
	{
		channelKey: "O2SENSOR2",
		displayName: "Oxygen Sensor Rear",
		logReference: "O2Sensor2",
		request: { bank: 24, slot: 0, raw: "CAN24-0" },
		decode: {
			eval: "0.01952*x",
			metricEval: null,
			unit: "V",
			metricUnit: null,
			responseBytes: 1,
			signed: false,
		},
	},
];

function normalizeDisplayUnit(unit: string | null): string {
	switch ((unit ?? "").toLowerCase()) {
		case "kph":
			return "km/h";
		case "deg c":
			return "°C";
		case "deg f":
			return "°F";
		default:
			return unit ?? "";
	}
}

function buildMutiiiCanPidDescriptors(): PidDescriptor[] {
	return BUILTIN_EVOX_CAN_MUTIII_CHANNELS.map((channel, index) => ({
		pid: MUTIII_CAN_PID_BASE + index,
		name: channel.logReference ?? channel.displayName,
		unit: normalizeDisplayUnit(
			channel.decode.metricUnit ?? channel.decode.unit ?? "",
		),
		minValue: 0,
		maxValue: channel.decode.responseBytes === 2 ? 65535 : 255,
	}));
}

const MUTIII_CAN_PID_DESCRIPTORS = buildMutiiiCanPidDescriptors();

function decodeMutiiiCanPid(
	pid: number,
): (BuiltinMutiiiCanChannel & { pid: number }) | null {
	const index = pid - MUTIII_CAN_PID_BASE;
	if (index < 0) {
		return null;
	}
	const channel = BUILTIN_EVOX_CAN_MUTIII_CHANNELS[index];
	if (channel == null) {
		return null;
	}
	return {
		...channel,
		pid,
	};
}

const BUILTIN_EVOX_CAN_MUTIII_PROFILE: Mut3LoggingProfile = {
	profileName: "Mitsubishi EvoX CAN MUTIII",
	backends: ["mutiii-can"],
	source: {
		fileName: "Mitsubishi EvoX CAN MUTIII.xml",
		vehicleName: "Mitsubishi EvoX CAN MUTIII",
		ecuName: "EVOX CAN MUTIII",
	},
	channels: BUILTIN_EVOX_CAN_MUTIII_CHANNELS.map((channel) => ({
		channelKey: channel.channelKey,
		displayName: channel.displayName,
		logReference: channel.logReference,
		request: {
			kind: "mutiii-can",
			raw: channel.request.raw,
			bank: channel.request.bank,
			slot: channel.request.slot,
		},
		request2: null,
		decode: channel.decode,
		priority: 1,
		visible: false,
		notes: null,
		provenance: "xml-derived",
	})),
};

export type { BuiltinMutiiiCanChannel };
export {
	BUILTIN_EVOX_CAN_MUTIII_CHANNELS,
	BUILTIN_EVOX_CAN_MUTIII_PROFILE,
	MUTIII_CAN_PID_BASE,
	MUTIII_CAN_PID_DESCRIPTORS,
	decodeMutiiiCanPid,
};
