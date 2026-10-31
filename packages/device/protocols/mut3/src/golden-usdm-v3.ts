import type { LiveDataProfileDescriptor } from "@ecu-explorer/device";
import type { Mode23ParameterDescriptor } from "./mode23-parameters.js";

/** Direct Mode23 map from Michael Golden's 29 August 2014 EvoScan file.
 * Source: Mitsubishi EvoX Golden.xml / Golden 2011 USDM v3 EVOX.
 * Metric formulas are preferred; external WDB is handled by the wideband source.
 * RPM, coolant, and speed were checked against OBD-II on 2026-10-31.
 */
export const GOLDEN_USDM_V3_PROFILE_ID = "mitsubishi-evox-golden-usdm-v3";
const PID_BASE = 0xa000;
type Channel = readonly [
	name: string,
	address: number,
	size: 1 | 2 | 4,
	unit: string,
	decode: (x: number) => number,
	min: number,
	max: number,
];
const channels: readonly Channel[] = [
	["2-Byte RPM", 0x878c, 2, "rpm", (x) => 3.90625 * x, 0, 10000],
	["Barometer", 0xab0d, 1, "kPa", (x) => x / 2, 0, 255],
	["PSIG", 0x875e, 2, "kPa", (x) => x * 0.3326271, -15, 35],
	["Load", 0x87b4, 2, "load", (x) => (x * 10) / 32, 0, 300],
	["TimingAdv", 0x8a4f, 1, "deg", (x) => x - 20, -10, 50],
	["Knock Sum", 0x8a93, 1, "count", (x) => x * 1.000001, 0, 20],
	["TPS", 0x873d, 1, "%", (x) => (x * 100) / 255, 0, 100],
	["Active WGDC", 0x8b9d, 1, "%", (x) => x / 2, 0, 100],
	["IPW", 0xab48, 2, "ms", (x) => x / 1000, 0, 255],
	["MAFCalcs", 0x8fc0, 4, "Load", (x) => (x * 100) / 16384, 0, 255],
	["MAPCalcs", 0x87fe, 2, "Load", (x) => (x * 100) / 16384, 0, 255],
	[
		"Load (MIVEC) and (Timing if IAT GT 75F)",
		0x87ba,
		2,
		"Load",
		(x) => (x * 10) / 32,
		0,
		340,
	],
	["WGDC Correction", 0x8b9b, 1, "unit", (x) => 0.5 * x - 64, 0, 255],
	[
		"Accel Pedal Position",
		0x9631,
		1,
		"%",
		(x) => ((x - 32) * 129) / 255,
		0,
		255,
	],
	["Manifold Air Temp", 0x86a1, 1, "Deg C", (x) => x - 40, -10, 200],
	["Coolant Temp", 0x867f, 1, "Deg C", (x) => x - 40, -10, 130],
	["Intake Air Temp", 0x869b, 1, "Deg C", (x) => x - 40, -10, 130],
	["Speed", 0x882f, 1, "kph", (x) => x * 2, 0, 250],
	["MAF Volts", 0x8fb0, 2, "V", (x) => (x / 1024) * 5, 0, 255],
	["STFT", 0x88e0, 1, "%", (x) => 0.1953125 * x - 25, 0, 255],
	["LTFT idle", 0x4573, 1, "%", (x) => 0.1953125 * x - 25, 0, 255],
	["LTFT Cruise", 0x4575, 1, "%", (x) => 0.1953125 * x - 25, 0, 255],
	["LTFT In Use", 0x88f1, 1, "%", (x) => 0.1953125 * x - 25, 0, 255],
	["Air/Fuel Ratio (Map)", 0x893d, 1, "AFR", (x) => (14.7 * 128) / x, 0, 255],
	["Front O2", 0x86ad, 1, "V", (x) => 0.01952 * x, 0, 255],
	["Rear O2", 0x86b1, 1, "V", (x) => 0.01952 * x, 0, 255],
	["Battery Level", 0x8733, 1, "V", (x) => 0.07333 * x, 0, 255],
	[
		"InVVT (target)",
		0x9552,
		2,
		"Deg",
		(x) => (x - 4096) * -0.01953125,
		-40,
		50,
	],
	[
		"InVVT (actual)",
		0x958a,
		2,
		"Deg",
		(x) => (x - 4096) * -0.01953125,
		-40,
		50,
	],
	[
		"ExVVT (target)",
		0x955e,
		2,
		"Deg",
		(x) => (x - 4096) * -0.01953125,
		-40,
		50,
	],
	[
		"ExVVT (actual)",
		0x9596,
		2,
		"Deg",
		(x) => (x - 4096) * -0.01953125,
		-40,
		50,
	],
	["MAF Hz", 0x8823, 1, "Hz", (x) => 6.25 * x, 0, 1650],
	["knock_adc_processed", 0x8a99, 1, "%", (x) => x, 0, 255],
	["knock_base", 0xab3f, 1, "%", (x) => x, 0, 255],
	["knock_var", 0xab3b, 1, "%", (x) => x, 0, 255],
	["knock_change", 0xab41, 1, "%", (x) => x, 0, 255],
	["knock_dynamics", 0x8aa7, 1, "%", (x) => x, 0, 255],
	["knock_flag", 0x8135, 1, "%", (x) => x, 0, 255],
	["Cruise Light", 0x45c5, 1, "raw", (x) => x, 0, 255],
];

/** All 39 ECU channels; PSIG depends on the Barometer channel in kPa. */
export const GOLDEN_USDM_V3_PARAMETERS: Mode23ParameterDescriptor[] =
	channels.map(
		([name, address, size, unit, decodeRaw, minValue, maxValue], index) => ({
			pid: PID_BASE + index,
			name,
			address,
			size,
			unit,
			decodeRaw,
			minValue,
			maxValue,
			...(index === 2
				? {
						dependencies: [PID_BASE + 1],
						decodeWithDependencies: (
							raw: number,
							values: ReadonlyMap<number, number>,
						) => {
							const barometer = values.get(PID_BASE + 1);
							if (barometer == null)
								throw new Error("Golden boost requires a barometer sample");
							return decodeRaw(raw) - barometer;
						},
					}
				: {}),
		}),
	);

/** Explicit ROM-specific profile; does not require the RAX logging patch. */
export const GOLDEN_USDM_V3_LIVE_DATA_PROFILE: LiveDataProfileDescriptor = {
	id: GOLDEN_USDM_V3_PROFILE_ID,
	name: "Golden 2011 USDM v3 EVOX",
	description:
		"Direct Mode23 channels from Michael Golden's 2011 USDM v3 Evo X map, using metric units. No RAX patch required.",
	transportFamily: "can-iso15765",
	requestFamily: "mode23",
	decodeFamily: "direct-scalar",
	status: "experimental",
	statusDetail:
		"ROM-specific addresses: confirm compatibility with your calibration. External wideband AFR uses the separate wideband source.",
	pids: GOLDEN_USDM_V3_PARAMETERS,
};
