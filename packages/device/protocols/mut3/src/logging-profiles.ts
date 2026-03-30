import { XMLParser } from "fast-xml-parser";

type EvoScanDataListItemNode = {
	Display?: string;
	LogReference?: string;
	RequestID?: string | number;
	RequestID2?: string | number;
	Eval?: string;
	MetricEval?: string;
	Unit?: string;
	MetricUnit?: string;
	ResponseBytes?: string | number;
	Priority?: string | number;
	Visible?: string | number | boolean;
	Signed?: string | number | boolean;
	Notes?: string;
};

type EvoScanModeNode = {
	DataListItem?: EvoScanDataListItemNode | EvoScanDataListItemNode[];
};

type EvoScanEcuNode = {
	name?: string;
	Model?: string;
	ECU?: string;
	Mode2?: EvoScanModeNode;
	mode2?: EvoScanModeNode;
};

type EvoScanVehicleNode = {
	name?: string;
	make?: string;
	model?: string;
	ecu?: EvoScanEcuNode | EvoScanEcuNode[];
};

type EvoScanRootNode = {
	EvoScanDataLogger?: {
		vehicle?: EvoScanVehicleNode | EvoScanVehicleNode[];
	};
};

type Mut3LoggingRequestKind =
	| "mutiii-can"
	| "mode23"
	| "calc"
	| "external-wideband"
	| "opaque-request";

type Mut3LoggingChannelProvenance =
	| "xml-derived"
	| "trace-confirmed"
	| "manual"
	| "ambiguous";

type Mut3CanRequest = {
	kind: "mutiii-can";
	raw: string;
	bank: number;
	slot: number;
};

type Mut3Mode23Request = {
	kind: "mode23";
	raw: string;
	serviceId: number;
	address: number;
};

type Mut3CalcRequest = {
	kind: "calc";
	raw: "CALC";
};

type Mut3ExternalWidebandRequest = {
	kind: "external-wideband";
	raw: "WDB";
};

type Mut3OpaqueRequest = {
	kind: "opaque-request";
	raw: string;
};

type Mut3LoggingRequest =
	| Mut3CanRequest
	| Mut3Mode23Request
	| Mut3CalcRequest
	| Mut3ExternalWidebandRequest
	| Mut3OpaqueRequest;

interface Mut3LoggingDecodeModel {
	eval: string | null;
	metricEval: string | null;
	unit: string | null;
	metricUnit: string | null;
	responseBytes: number | null;
	signed: boolean;
}

interface Mut3LoggingChannelDefinition {
	channelKey: string;
	displayName: string;
	logReference: string | null;
	request: Mut3LoggingRequest;
	request2: Mut3LoggingRequest | null;
	decode: Mut3LoggingDecodeModel;
	priority: number | null;
	visible: boolean | null;
	notes: string | null;
	provenance: Mut3LoggingChannelProvenance;
}

interface Mut3LoggingProfileSource {
	fileName: string | null;
	vehicleName: string | null;
	ecuName: string | null;
}

interface Mut3LoggingProfile {
	profileName: string;
	backends: Mut3LoggingRequestKind[];
	source: Mut3LoggingProfileSource;
	channels: Mut3LoggingChannelDefinition[];
}

interface MutiiiCanBankChannel {
	channelKey: string;
	displayName: string;
	logReference: string | null;
	bank: number;
	slot: number;
	rawRequest: string;
}

interface MutiiiCanBankGroup {
	bank: number;
	channels: MutiiiCanBankChannel[];
	slots: number[];
}

const XML_OPTIONS = {
	ignoreAttributes: false,
	attributeNamePrefix: "",
	parseAttributeValue: false,
	parseTagValue: false,
	trimValues: true,
} as const;

const parser = new XMLParser(XML_OPTIONS);

function asArray<T>(value: T | T[] | null | undefined): T[] {
	if (value === undefined || value === null) {
		return [];
	}
	return Array.isArray(value) ? value : [value];
}

function asString(value: unknown): string | null {
	if (typeof value === "string") {
		const trimmed = value.trim();
		return trimmed.length > 0 ? trimmed : null;
	}
	if (typeof value === "number") {
		return String(value);
	}
	return null;
}

function asNumber(value: unknown): number | null {
	const text = asString(value);
	if (text === null) {
		return null;
	}
	const parsed = Number(text);
	return Number.isFinite(parsed) ? parsed : null;
}

function asBoolean(value: unknown): boolean | null {
	const text = asString(value);
	if (text === null) {
		return null;
	}
	switch (text.toLowerCase()) {
		case "1":
		case "true":
		case "yes":
			return true;
		case "0":
		case "false":
		case "no":
			return false;
		default:
			return null;
	}
}

function normalizeChannelKey(value: string): string {
	return value
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

function parseRequestToken(rawValue: string | null): Mut3LoggingRequest | null {
	if (rawValue === null) {
		return null;
	}

	const canMatch = /^CAN(\d+)-(\d+)$/i.exec(rawValue);
	if (canMatch) {
		const [, bankText, slotText] = canMatch;
		return {
			kind: "mutiii-can",
			raw: rawValue,
			bank: Number(bankText),
			slot: Number(slotText),
		};
	}

	if (rawValue.toUpperCase() === "CALC") {
		return {
			kind: "calc",
			raw: "CALC",
		};
	}

	if (rawValue.toUpperCase() === "WDB") {
		return {
			kind: "external-wideband",
			raw: "WDB",
		};
	}

	if (/^[0-9a-f]{8}$/i.test(rawValue) && rawValue.startsWith("23")) {
		return {
			kind: "mode23",
			raw: rawValue.toUpperCase(),
			serviceId: 0x23,
			address: Number.parseInt(rawValue.slice(2), 16),
		};
	}

	return {
		kind: "opaque-request",
		raw: rawValue,
	};
}

function inferProfileName(
	fileName: string | null,
	vehicleName: string | null,
	ecuName: string | null,
): string {
	if (fileName !== null) {
		return fileName.replace(/\.xml$/i, "");
	}
	if (ecuName !== null && vehicleName !== null) {
		return `${vehicleName} ${ecuName}`.trim();
	}
	return ecuName ?? vehicleName ?? "Unknown MUT3 Profile";
}

function parseChannelsFromModeNode(
	modeNode: EvoScanModeNode | undefined,
): Mut3LoggingChannelDefinition[] {
	if (!modeNode) {
		return [];
	}

	const channels: Mut3LoggingChannelDefinition[] = [];

	for (const item of asArray(modeNode.DataListItem)) {
		const displayName = asString(item.Display);
		const logReference = asString(item.LogReference);
		const request = parseRequestToken(asString(item.RequestID));
		if (displayName === null || request === null) {
			continue;
		}

		channels.push({
			channelKey: normalizeChannelKey(logReference ?? displayName),
			displayName,
			logReference,
			request,
			request2: parseRequestToken(asString(item.RequestID2)),
			decode: {
				eval: asString(item.Eval),
				metricEval: asString(item.MetricEval),
				unit: asString(item.Unit),
				metricUnit: asString(item.MetricUnit),
				responseBytes: asNumber(item.ResponseBytes),
				signed: asBoolean(item.Signed) ?? false,
			},
			priority: asNumber(item.Priority),
			visible: asBoolean(item.Visible),
			notes: asString(item.Notes),
			provenance: "xml-derived",
		});
	}

	return channels;
}

function parseProfileFromNodes(
	vehicleNode: EvoScanVehicleNode | null,
	ecuNode: EvoScanEcuNode | null,
	options?: { fileName?: string },
): Mut3LoggingProfile {
	const modeNode = ecuNode?.Mode2 ?? ecuNode?.mode2;
	const channels = parseChannelsFromModeNode(modeNode);
	const backends = Array.from(
		new Set(channels.map((channel) => channel.request.kind)),
	);
	const fileName = options?.fileName ?? null;
	const fallbackVehicleName =
		[asString(vehicleNode?.make), asString(vehicleNode?.model)]
			.filter((part): part is string => part !== null)
			.join(" ")
			.trim() || null;
	const vehicleName = asString(vehicleNode?.name) ?? fallbackVehicleName;
	const ecuName =
		asString(ecuNode?.name) ??
		asString(ecuNode?.Model) ??
		asString(ecuNode?.ECU);

	return {
		profileName: inferProfileName(fileName, vehicleName, ecuName),
		backends,
		source: {
			fileName,
			vehicleName,
			ecuName,
		},
		channels,
	};
}

function parseEvoScanLoggingProfilesXml(
	xml: string,
	options?: { fileName?: string },
): Mut3LoggingProfile[] {
	const root = parser.parse(xml) as EvoScanRootNode;
	const profiles: Mut3LoggingProfile[] = [];

	for (const vehicleNode of asArray(root.EvoScanDataLogger?.vehicle)) {
		const ecuNodes = asArray(vehicleNode.ecu);
		if (ecuNodes.length === 0) {
			profiles.push(parseProfileFromNodes(vehicleNode, null, options));
			continue;
		}

		for (const ecuNode of ecuNodes) {
			profiles.push(parseProfileFromNodes(vehicleNode, ecuNode, options));
		}
	}

	return profiles;
}

function parseEvoScanLoggingProfileXml(
	xml: string,
	options?: { fileName?: string },
): Mut3LoggingProfile {
	return (
		parseEvoScanLoggingProfilesXml(xml, options)[0] ??
		parseProfileFromNodes(null, null, options)
	);
}

function summarizeLoggingProfile(profile: Mut3LoggingProfile): {
	channelCount: number;
	backendCounts: Partial<Record<Mut3LoggingRequestKind, number>>;
	requestDriftByChannelKey: Map<string, string[]>;
} {
	const backendCounts: Partial<Record<Mut3LoggingRequestKind, number>> = {};
	const requestDriftByChannelKey = new Map<string, string[]>();

	for (const channel of profile.channels) {
		backendCounts[channel.request.kind] =
			(backendCounts[channel.request.kind] ?? 0) + 1;

		const requests = requestDriftByChannelKey.get(channel.channelKey) ?? [];
		requests.push(channel.request.raw);
		requestDriftByChannelKey.set(channel.channelKey, requests);
	}

	return {
		channelCount: profile.channels.length,
		backendCounts,
		requestDriftByChannelKey,
	};
}

function groupMutiiiCanChannels(
	profile: Mut3LoggingProfile,
): MutiiiCanBankGroup[] {
	const groups = new Map<number, MutiiiCanBankGroup>();

	for (const channel of profile.channels) {
		if (channel.request.kind !== "mutiii-can") {
			continue;
		}

		const existing = groups.get(channel.request.bank) ?? {
			bank: channel.request.bank,
			channels: [],
			slots: [],
		};

		existing.channels.push({
			channelKey: channel.channelKey,
			displayName: channel.displayName,
			logReference: channel.logReference,
			bank: channel.request.bank,
			slot: channel.request.slot,
			rawRequest: channel.request.raw,
		});
		if (!existing.slots.includes(channel.request.slot)) {
			existing.slots.push(channel.request.slot);
		}

		groups.set(channel.request.bank, existing);
	}

	return Array.from(groups.values())
		.map((group) => ({
			...group,
			slots: [...group.slots].sort((left, right) => left - right),
			channels: [...group.channels].sort(
				(left, right) => left.slot - right.slot,
			),
		}))
		.sort((left, right) => left.bank - right.bank);
}

export type {
	Mut3CalcRequest,
	Mut3CanRequest,
	Mut3ExternalWidebandRequest,
	MutiiiCanBankChannel,
	MutiiiCanBankGroup,
	Mut3LoggingChannelDefinition,
	Mut3LoggingChannelProvenance,
	Mut3LoggingDecodeModel,
	Mut3LoggingProfile,
	Mut3LoggingProfileSource,
	Mut3LoggingRequest,
	Mut3LoggingRequestKind,
	Mut3Mode23Request,
	Mut3OpaqueRequest,
};
export {
	groupMutiiiCanChannels,
	normalizeChannelKey,
	parseEvoScanLoggingProfileXml,
	parseEvoScanLoggingProfilesXml,
	parseRequestToken,
	summarizeLoggingProfile,
};
