import { describe, expect, it } from "vitest";
import {
	groupMutiiiCanChannels,
	normalizeChannelKey,
	parseEvoScanLoggingProfilesXml,
	parseEvoScanLoggingProfileXml,
	parseRequestToken,
	summarizeLoggingProfile,
} from "../src/logging-profiles.js";

describe("parseRequestToken()", () => {
	it("classifies CAN MUTIII request tokens", () => {
		expect(parseRequestToken("CAN6-0")).toEqual({
			kind: "mutiii-can",
			raw: "CAN6-0",
			bank: 6,
			slot: 0,
		});
	});

	it("classifies Mode 23 request tokens", () => {
		expect(parseRequestToken("2380878C")).toEqual({
			kind: "mode23",
			raw: "2380878C",
			serviceId: 0x23,
			address: 0x80878c,
		});
	});

	it("classifies CALC request tokens", () => {
		expect(parseRequestToken("CALC")).toEqual({
			kind: "calc",
			raw: "CALC",
		});
	});

	it("classifies external wideband request tokens", () => {
		expect(parseRequestToken("WDB")).toEqual({
			kind: "external-wideband",
			raw: "WDB",
		});
	});
});

describe("normalizeChannelKey()", () => {
	it("normalizes display or log reference names into stable keys", () => {
		expect(normalizeChannelKey("Coolant Temp")).toBe("COOLANT_TEMP");
		expect(normalizeChannelKey("Battery Level")).toBe("BATTERY_LEVEL");
	});
});

describe("parseEvoScanLoggingProfileXml()", () => {
	it("parses a CAN MUTIII profile into a backend-aware channel model", () => {
		const xml = `
			<EvoScanDataLogger>
				<vehicle name="Mitsubishi EvoX">
					<ecu name="CAN MUTIII">
						<Mode2>
							<DataListItem
								Display="Battery Level"
								LogReference="Battery"
								RequestID="CAN0-0"
								Eval="x/10"
								MetricEval="x/10"
								Unit="V"
								MetricUnit="V"
								ResponseBytes="1"
								Priority="1"
								Visible="1"
							/>
							<DataListItem
								Display="Coolant Temp"
								LogReference="ECT"
								RequestID="CAN5-0"
								Eval="x"
								MetricEval="x"
								Unit="deg F"
								MetricUnit="deg C"
								ResponseBytes="1"
								Priority="2"
								Visible="1"
							/>
						</Mode2>
					</ecu>
				</vehicle>
			</EvoScanDataLogger>
		`;

		const profile = parseEvoScanLoggingProfileXml(xml, {
			fileName: "Mitsubishi EvoX CAN MUTIII.xml",
		});

		expect(profile.profileName).toBe("Mitsubishi EvoX CAN MUTIII");
		expect(profile.backends).toEqual(["mutiii-can"]);
		expect(profile.channels).toHaveLength(2);
		expect(profile.channels[0]).toMatchObject({
			channelKey: "BATTERY",
			displayName: "Battery Level",
			logReference: "Battery",
			request: {
				kind: "mutiii-can",
				raw: "CAN0-0",
				bank: 0,
				slot: 0,
			},
			decode: {
				eval: "x/10",
				metricEval: "x/10",
				unit: "V",
				metricUnit: "V",
				responseBytes: 1,
				signed: false,
			},
			priority: 1,
			visible: true,
			provenance: "xml-derived",
		});
	});

	it("preserves Mode23 and CALC families without collapsing them into one model", () => {
		const xml = `
			<EvoScanDataLogger>
				<vehicle name="Mitsubishi EvoX">
					<ecu name="Hybrid Profile">
						<Mode2>
							<DataListItem
								Display="RPM"
								LogReference="RPM"
								RequestID="2380878C"
								Eval="x/4"
								ResponseBytes="2"
								Visible="1"
							/>
							<DataListItem
								Display="Boost"
								LogReference="Boost"
								RequestID="CALC"
								Eval="[RAX_G_Dat]BITS(24,8)*0.07333"
								ResponseBytes="0"
								Visible="0"
							/>
						</Mode2>
					</ecu>
				</vehicle>
			</EvoScanDataLogger>
		`;

		const profile = parseEvoScanLoggingProfileXml(xml, {
			fileName: "Hybrid Profile.xml",
		});

		expect(profile.backends.sort()).toEqual(["calc", "mode23"]);
		expect(profile.channels[0]?.request).toEqual({
			kind: "mode23",
			raw: "2380878C",
			serviceId: 0x23,
			address: 0x80878c,
		});
		expect(profile.channels[1]?.request).toEqual({
			kind: "calc",
			raw: "CALC",
		});
	});

	it("keeps mixed-backend profiles mixed instead of forcing one file-level backend", () => {
		const xml = `
			<EvoScanDataLogger>
				<vehicle name="Mitsubishi EvoX">
					<ecu name="Mixed Profile">
						<Mode2>
							<DataListItem Display="RPM" LogReference="RPM" RequestID="2380878C" />
							<DataListItem Display="Trans Temp" LogReference="Trans Temp" RequestID="CAN28-0" />
							<DataListItem Display="External Wideband A/F Ratio" LogReference="WidebandAF" RequestID="WDB" />
						</Mode2>
					</ecu>
				</vehicle>
			</EvoScanDataLogger>
		`;

		const profile = parseEvoScanLoggingProfileXml(xml, {
			fileName: "Mixed Profile.xml",
		});

		expect(profile.backends.sort()).toEqual([
			"external-wideband",
			"mode23",
			"mutiii-can",
		]);
	});

	it("parses multiple ECU profiles from a single EvoScan file", () => {
		const xml = `
			<EvoScanDataLogger>
				<vehicle name="Mitsubishi EvoX">
					<ecu name="Profile A">
						<Mode2>
							<DataListItem Display="RPM" LogReference="RPM" RequestID="2380878C" />
						</Mode2>
					</ecu>
					<ecu name="Profile B">
						<Mode2>
							<DataListItem Display="Battery" LogReference="Battery" RequestID="CAN0-0" />
						</Mode2>
					</ecu>
				</vehicle>
			</EvoScanDataLogger>
		`;

		const profiles = parseEvoScanLoggingProfilesXml(xml, {
			fileName: "Multi.xml",
		});

		expect(profiles).toHaveLength(2);
		expect(profiles[0]?.source.ecuName).toBe("Profile A");
		expect(profiles[1]?.source.ecuName).toBe("Profile B");
		expect(profiles[1]?.channels[0]?.request.kind).toBe("mutiii-can");
	});

	it("groups MUTIII CAN channels by bank and slot for executor planning", () => {
		const xml = `
			<EvoScanDataLogger>
				<vehicle name="Mitsubishi EvoX">
					<ecu name="CAN MUTIII">
						<Mode2>
							<DataListItem Display="Battery" LogReference="Battery" RequestID="CAN0-0" />
							<DataListItem Display="RPM" LogReference="RPM" RequestID="CAN2-2" />
							<DataListItem Display="Target Idle RPM" LogReference="TargetIdleRPM" RequestID="CAN2-0" />
							<DataListItem Display="Boost" LogReference="Boost" RequestID="2380875E" />
						</Mode2>
					</ecu>
				</vehicle>
			</EvoScanDataLogger>
		`;

		const profile = parseEvoScanLoggingProfileXml(xml, {
			fileName: "Mitsubishi EvoX CAN MUTIII.xml",
		});

		expect(groupMutiiiCanChannels(profile)).toEqual([
			{
				bank: 0,
				slots: [0],
				channels: [
					{
						channelKey: "BATTERY",
						displayName: "Battery",
						logReference: "Battery",
						bank: 0,
						slot: 0,
						rawRequest: "CAN0-0",
					},
				],
			},
			{
				bank: 2,
				slots: [0, 2],
				channels: [
					{
						channelKey: "TARGETIDLERPM",
						displayName: "Target Idle RPM",
						logReference: "TargetIdleRPM",
						bank: 2,
						slot: 0,
						rawRequest: "CAN2-0",
					},
					{
						channelKey: "RPM",
						displayName: "RPM",
						logReference: "RPM",
						bank: 2,
						slot: 2,
						rawRequest: "CAN2-2",
					},
				],
			},
		]);
	});
});

describe("summarizeLoggingProfile()", () => {
	it("summarizes backend counts and request drift by logical channel key", () => {
		const xml = `
			<EvoScanDataLogger>
				<vehicle name="Mitsubishi EvoX">
					<ecu name="USA">
						<Mode2>
							<DataListItem Display="Battery Level" LogReference="Battery" RequestID="23808703" />
							<DataListItem Display="Battery Level 2" LogReference="Battery" RequestID="23808733" />
							<DataListItem Display="RPM" LogReference="RPM" RequestID="2380878C" />
						</Mode2>
					</ecu>
				</vehicle>
			</EvoScanDataLogger>
		`;

		const profile = parseEvoScanLoggingProfileXml(xml, {
			fileName: "Mitsubishi EvoX Mode23 USA.xml",
		});
		const summary = summarizeLoggingProfile(profile);

		expect(summary.channelCount).toBe(3);
		expect(summary.backendCounts.mode23).toBe(3);
		expect(summary.requestDriftByChannelKey.get("BATTERY")).toEqual([
			"23808703",
			"23808733",
		]);
	});
});
