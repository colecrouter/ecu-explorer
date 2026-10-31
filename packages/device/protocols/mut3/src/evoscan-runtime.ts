import type {
	LiveDataFrame,
	LiveDataHealth,
	LiveDataProfileDescriptor,
	LiveDataSession,
	PidDescriptor,
} from "@ecu-explorer/device";
import { Parser } from "expr-eval";
import { XMLValidator } from "fast-xml-parser";
import {
	normalizeChannelKey,
	parseEvoScanLoggingProfilesXml,
} from "./logging-profiles.js";

export interface EvoScanRuntimeChannel extends PidDescriptor {
	request:
		| { kind: "mode23"; address: number; size: 1 | 2 | 4 }
		| { kind: "calc" };
	dependencies: number[];
	defaultSelected: boolean;
	evaluate(raw: number, values: ReadonlyMap<number, number>): number;
}
export interface EvoScanRuntimeProfile {
	descriptor: LiveDataProfileDescriptor;
	channels: EvoScanRuntimeChannel[];
	issues: string[];
}
function hash(text: string): number {
	let value = 2166136261;
	for (const char of text)
		value = Math.imul(value ^ char.charCodeAt(0), 16777619);
	return value >>> 0;
}
const parser = new Parser({
	allowMemberAccess: false,
	operators: {
		assignment: false,
		concatenate: false,
		conditional: false,
		logical: false,
		comparison: false,
		in: false,
		factorial: false,
	},
});
function extractBits(value: number, upper: number, width: number): number {
	if (
		!Number.isInteger(upper) ||
		!Number.isInteger(width) ||
		upper < 1 ||
		upper > 32 ||
		width < 1 ||
		width > upper
	)
		throw new Error("Invalid BITS range");
	return Math.floor((value >>> 0) / 2 ** (upper - width)) % 2 ** width;
}
parser.functions = { bits: extractBits };

/** Compile file-owned decode rules; no eval, Function constructor, or hardware access. */
export function compileEvoScanProfiles(
	xml: string,
	sourceUri: string,
	units: "metric" | "original" = "metric",
): EvoScanRuntimeProfile[] {
	if (/<!DOCTYPE|<!ENTITY/i.test(xml))
		throw new Error("EvoScan configurations cannot declare XML entities.");
	const validation = XMLValidator.validate(xml);
	if (validation !== true)
		throw new Error(`Invalid EvoScan XML: ${validation.err.msg}`);
	const profiles = parseEvoScanLoggingProfilesXml(xml, {
		fileName: sourceUri.split("/").pop() ?? sourceUri,
	});
	const identities = new Map<string, number>();
	return profiles.map((profile) => {
		const identity = `${profile.source.vehicleName ?? ""}/${profile.source.ecuName ?? profile.profileName}`;
		const ordinal = identities.get(identity) ?? 0;
		identities.set(identity, ordinal + 1);
		const id = `evoscan:${sourceUri}#${encodeURIComponent(identity)}${ordinal ? `:${ordinal}` : ""}`;
		const references = new Map<string, number>();
		const counts = new Map<string, number>();
		for (const channel of profile.channels)
			counts.set(channel.channelKey, (counts.get(channel.channelKey) ?? 0) + 1);
		for (const channel of profile.channels)
			references.set(
				channel.channelKey,
				0x10000000 + (hash(channel.channelKey) & 0x0fffffff),
			);
		const problems = new Map<number, string>();
		const drafts = new Map<number, EvoScanRuntimeChannel>();
		const seenPids = new Map<number, string>();
		for (const channel of profile.channels) {
			const pid = references.get(channel.channelKey);
			if (pid === undefined) continue;
			const fail = (reason: string) =>
				problems.set(pid, `${channel.displayName}: ${reason}`);
			try {
				if (
					/\b(?:AYC|ACD|SAWC|SST|ABS|TCU)\b/i.test(profile.source.ecuName ?? "")
				)
					throw new Error(
						"Alternate ECU/CAN destinations are not supported by this engine connection",
					);
				const previous = seenPids.get(pid);
				if (previous && previous !== channel.channelKey)
					throw new Error("Channel identifier hash collision");
				seenPids.set(pid, channel.channelKey);
				if ((counts.get(channel.channelKey) ?? 0) > 1)
					throw new Error("Ambiguous duplicate LogReference");
				if (channel.request2) throw new Error("RequestID2 is not supported");
				if (
					channel.request.kind !== "mode23" &&
					channel.request.kind !== "calc"
				)
					throw new Error(
						channel.request.kind === "external-wideband"
							? "WDB uses the separately connected wideband source"
							: `Unsupported ${channel.request.kind} request (${channel.request.raw})`,
					);
				const size = channel.decode.responseBytes;
				if (
					channel.request.kind === "mode23" &&
					size !== 1 &&
					size !== 2 &&
					size !== 4
				)
					throw new Error(`Unsupported ResponseBytes: ${size}`);
				let formula =
					(units === "metric" ? channel.decode.metricEval : null) ??
					channel.decode.eval ??
					"x";
				if (formula.length > 2048) throw new Error("Expression is too long");
				formula = formula.replace(
					/(\[[^\]]+\]|\bx)\s*BITS\(\s*(\d+)\s*,\s*(\d+)\s*\)/gi,
					(_match, ref: string, upper: string, width: string) => {
						extractBits(0, Number(upper), Number(width));
						return `bits(${ref},${upper},${width})`;
					},
				);
				const aliases = new Map<string, number>();
				formula = formula.replace(
					/\[([^\]]+)\]/g,
					(_match, reference: string) => {
						const key = normalizeChannelKey(reference);
						const dependency = references.get(key);
						if (dependency === undefined || counts.get(key) !== 1)
							throw new Error(`Unknown or ambiguous reference [${reference}]`);
						const alias = `r${aliases.size}`;
						aliases.set(alias, dependency);
						return alias;
					},
				);
				if (/[^\w\s.+\-*/%^(),]/.test(formula))
					throw new Error("Unsupported formula syntax");
				const expression = parser.parse(formula);
				for (const variable of expression.variables())
					if (variable !== "x" && !aliases.has(variable))
						throw new Error(`Unsupported formula variable ${variable}`);
				if (
					channel.request.kind === "calc" &&
					expression.variables().includes("x")
				)
					throw new Error("CALC has no raw x value");
				const dependencies = [...new Set(aliases.values())];
				const signed = channel.decode.signed;
				const channelSize = size ?? 1;
				const request: EvoScanRuntimeChannel["request"] =
					channel.request.kind === "mode23" &&
					(size === 1 || size === 2 || size === 4)
						? { kind: "mode23", address: channel.request.address, size }
						: { kind: "calc" };
				drafts.set(pid, {
					pid,
					name: channel.displayName,
					unit:
						(units === "metric" && channel.decode.metricEval
							? channel.decode.metricUnit
							: channel.decode.unit) ?? "",
					minValue: channel.minValue ?? 0,
					maxValue: channel.maxValue ?? 255,
					request,
					dependencies,
					defaultSelected: channel.defaultSelected ?? true,
					evaluate: (raw, values) => {
						const variables: Record<string, number> = {
							x:
								signed && raw >= 2 ** (channelSize * 8 - 1)
									? raw - 2 ** (channelSize * 8)
									: raw,
						};
						for (const [alias, dependency] of aliases) {
							const value = values.get(dependency);
							if (value === undefined)
								throw new Error(
									"Dependency did not produce a sample this cycle",
								);
							variables[alias] = value;
						}
						const value: unknown = expression.evaluate(variables);
						if (typeof value !== "number")
							throw new Error("Formula did not return a number");
						return value;
					},
				});
			} catch (error) {
				fail(error instanceof Error ? error.message : String(error));
			}
		}
		const valid = new Set<number>();
		const visit = (pid: number, path: Set<number>): void => {
			if (valid.has(pid)) return;
			if (problems.has(pid)) throw new Error(problems.get(pid));
			if (path.has(pid))
				throw new Error("Cyclic calculated-channel dependency");
			const channel = drafts.get(pid);
			if (!channel) throw new Error("Unsupported dependency");
			const next = new Set(path);
			next.add(pid);
			for (const dependency of channel.dependencies) visit(dependency, next);
			valid.add(pid);
		};
		for (const [pid, channel] of drafts)
			try {
				visit(pid, new Set());
			} catch (error) {
				problems.set(
					pid,
					`${channel.name}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		const channels = [...drafts.values()].filter(
			(channel) => valid.has(channel.pid) && !problems.has(channel.pid),
		);
		const issues = [...problems.values()];
		return {
			channels,
			issues,
			descriptor: {
				id,
				name: profile.source.ecuName ?? profile.profileName,
				description: `EvoScan XML · ${decodeURIComponent(sourceUri.split("/").pop() ?? sourceUri)} · ${units} units`,
				transportFamily: "can-iso15765",
				requestFamily: "mode23",
				decodeFamily: "evoscan-expression",
				status: channels.length ? "experimental" : "unavailable",
				statusDetail: issues.length
					? `${channels.length}/${profile.channels.length} channels available. ${issues.join("; ")}`
					: "ROM-specific addresses loaded from EvoScan XML; confirm compatibility with your calibration.",
				revision: hash(`${xml}\0${units}`).toString(16),
				defaultPids: channels
					.filter((channel) => channel.defaultSelected)
					.map((channel) => channel.pid),
				pids: channels.map(({ pid, name, unit, minValue, maxValue }) => ({
					pid,
					name,
					unit,
					minValue,
					maxValue,
				})),
			},
		};
	});
}

/** Poll only selected channels and their dependency closure, using fresh cycle-local values. */
export function streamEvoScanProfile(
	profile: EvoScanRuntimeProfile,
	pids: number[],
	read: (address: number, size: 1 | 2 | 4) => Promise<number>,
	onFrame: (frame: LiveDataFrame) => void,
	onHealth: ((health: LiveDataHealth) => void) | undefined,
	onComplete: () => void,
): LiveDataSession {
	const channels = new Map(
		profile.channels.map((channel) => [channel.pid, channel]),
	);
	const requested = new Set(pids);
	const visited = new Set<number>();
	const plan: EvoScanRuntimeChannel[] = [];
	const add = (pid: number) => {
		if (visited.has(pid)) return;
		const channel = channels.get(pid);
		if (!channel) throw new Error(`Unknown EvoScan channel ${pid}`);
		visited.add(pid);
		for (const dependency of channel.dependencies) add(dependency);
		plan.push(channel);
	};
	if (!pids.length) throw new Error("Select at least one EvoScan channel");
	for (const pid of pids) add(pid);
	let running = true;
	const start = Date.now();
	let frames = 0,
		dropped = 0,
		healthStart = start,
		totalLatency = 0,
		reads = 0;
	const poll = async () => {
		while (running) {
			const values = new Map<number, number>();
			const rawValues = new Map<string, number>();
			for (const channel of plan) {
				if (!running) break;
				try {
					let raw = 0;
					if (channel.request.kind === "mode23") {
						const key = `${channel.request.address}:${channel.request.size}`;
						const cached = rawValues.get(key);
						if (cached !== undefined) raw = cached;
						else {
							const started = Date.now();
							raw = await read(channel.request.address, channel.request.size);
							totalLatency += Date.now() - started;
							reads++;
							rawValues.set(key, raw);
						}
					}
					const value = channel.evaluate(raw, values);
					if (!Number.isFinite(value))
						throw new Error("Non-finite decoded sample");
					values.set(channel.pid, value);
					if (requested.has(channel.pid)) {
						onFrame({
							pid: channel.pid,
							value,
							unit: channel.unit,
							timestamp: Date.now() - start,
						});
						frames++;
					}
				} catch (error) {
					dropped++;
					console.error(`[EvoScan] ${channel.name}:`, error);
				}
			}
			const now = Date.now();
			if (onHealth && now - healthStart >= 1000) {
				const rate = (frames * 1000) / (now - healthStart);
				onHealth({
					samplesPerSecond: Math.round(rate),
					droppedFrames: dropped,
					latencyMs: reads ? Math.round(totalLatency / reads) : 0,
					status: rate === 0 ? "stalled" : rate < 5 ? "degraded" : "healthy",
				});
				frames = 0;
				dropped = 0;
				totalLatency = 0;
				reads = 0;
				healthStart = now;
			}
			if (running)
				await new Promise<void>((resolve) => setTimeout(resolve, 50));
		}
	};
	const completion = poll()
		.catch((error) => console.error("[EvoScan] Polling failed:", error))
		.finally(onComplete);
	return {
		stop: () => {
			running = false;
		},
		completion,
	};
}
