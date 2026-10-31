import { readFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
	groupMutiiiCanChannels,
	parseEvoScanLoggingProfilesXml,
	summarizeLoggingProfile,
} from "@ecu-explorer/protocol-mut3";
import sade from "sade";

/**
 * @param {import("@ecu-explorer/protocol-mut3").Mut3LoggingProfile} profile
 */
function printProfileSummary(profile) {
	const summary = summarizeLoggingProfile(profile);
	const canGroups = groupMutiiiCanChannels(profile);

	console.log(`profile: ${profile.profileName}`);
	console.log(`source file: ${profile.source.fileName ?? "(unknown)"}`);
	console.log(`vehicle: ${profile.source.vehicleName ?? "(unknown)"}`);
	console.log(`ecu: ${profile.source.ecuName ?? "(unknown)"}`);
	console.log(`backends: ${profile.backends.join(", ") || "(none)"}`);
	console.log(`channels: ${summary.channelCount}`);
	console.log(
		`backend counts: ${
			Object.entries(summary.backendCounts)
				.map(([backend, count]) => `${backend}=${count}`)
				.join(", ") || "(none)"
		}`,
	);

	if (canGroups.length > 0) {
		console.log("mutiii-can banks:");
		for (const group of canGroups) {
			const labels = group.channels.map(
				(channel) =>
					`${channel.rawRequest}:${channel.logReference ?? channel.displayName}`,
			);
			console.log(
				`  bank ${group.bank} slots [${group.slots.join(", ")}] -> ${labels.join(", ")}`,
			);
		}
	}
}

const prog = sade("inspect-mut3-profile", true);

prog
	.version("1.0.0")
	.describe(
		"Inspect EvoScan MUT-III XML logging profiles and summarize backends",
	)
	.option("--xml", "Path to an EvoScan XML file")
	.option("--json", "Emit parsed profile data as JSON", false)
	.action(async (opts) => {
		if (!opts.xml) {
			console.error("Missing required --xml argument");
			process.exit(1);
		}

		const xmlPath = resolve(opts.xml);
		const xml = await readFile(xmlPath, "utf8");
		const profiles = parseEvoScanLoggingProfilesXml(xml, {
			fileName: basename(xmlPath),
		});

		if (opts.json) {
			console.log(JSON.stringify(profiles, null, 2));
			return;
		}

		for (const [index, profile] of profiles.entries()) {
			if (index > 0) {
				console.log("");
			}
			printProfileSummary(profile);
		}
	});

prog.parse(process.argv);
