<script lang="ts">
	import { onMount } from "svelte";
	import type { LiveDataFrame, PidDescriptor } from "@ecu-explorer/device";
	let { send }: { send: (message: { type: string }) => void } = $props();
	let profileName = $state("Not configured");
	let pids = $state<PidDescriptor[]>([]);
	let liveData = $state<Record<number, LiveDataFrame>>({});
	let isStreaming = $state(false);
	let recording = $state(false);
	let startTime = $state<number>();
	let seconds = $state(0);
	onMount(() => {
		const receive = (event: MessageEvent) => {
			const message = event.data;
			switch (message.type) {
				case "configuration": {
					if (
						profileName !== message.profileName ||
						pids.map((pid) => pid.pid).join(",") !==
							message.pids.map((pid: PidDescriptor) => pid.pid).join(",")
					)
						liveData = {};
					profileName = message.profileName;
					pids = message.pids;
					recording = message.recording;
					break;
				}
				case "data":
					liveData[message.frame.pid] = message.frame;
					break;
				case "streamingStarted":
					if (!isStreaming) {
						startTime = Date.now();
						seconds = 0;
					}
					isStreaming = true;
					break;
				case "streamingStopped":
					isStreaming = false;
					startTime = undefined;
					break;
			}
		};
		window.addEventListener("message", receive);
		const timer = window.setInterval(() => {
			if (startTime !== undefined)
				seconds = Math.floor((Date.now() - startTime) / 1000);
		}, 1000);
		send({ type: "ready" });
		return () => {
			window.removeEventListener("message", receive);
			window.clearInterval(timer);
		};
	});
</script>

<main>
	<header>
		<h1>Live Data</h1>
		<div class="controls">
			<button onclick={() => send({ type: "changeConfiguration" })}
				>Change Configuration</button
			>
			{#if isStreaming}<button
					disabled={recording}
					title={recording
						? "Stop the log before stopping live data"
						: undefined}
					onclick={() => send({ type: "stopStreaming" })}>Stop Streaming</button
				>
			{:else}<button onclick={() => send({ type: "startStreaming" })}
					>Start Streaming</button
				>{/if}
		</div>
	</header>
	<section aria-label="Current logging configuration">
		<h2>{profileName}</h2>
		<p class="summary">
			{pids.length} selected {pids.length === 1 ? "channel" : "channels"} · {isStreaming
				? `Streaming · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
				: "Stopped"}{recording ? " · Log active" : ""}
		</p>
	</section>
	<section aria-label="Live values">
		{#if pids.length}<div class="data-grid">
				{#each pids as pid (pid.pid)}
					<div class="data-card">
						<span class="label">{pid.name}</span><span class="value"
							>{liveData[pid.pid]?.value.toFixed(2) ?? "—"}</span
						><span class="unit">{pid.unit}</span>
					</div>
				{/each}
			</div>
		{:else}<p class="summary">
				Choose Change Configuration to select a logging profile and channels.
			</p>{/if}
	</section>
</main>

<style>
	:global(body) {
		margin: 0;
		color: var(--vscode-foreground);
		background: var(--vscode-editor-background);
		font-family: var(--vscode-font-family);
		font-size: var(--vscode-font-size);
	}
	main {
		padding: 20px 24px;
		display: flex;
		flex-direction: column;
		gap: 24px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		border-bottom: 1px solid var(--vscode-panel-border);
		padding-bottom: 16px;
		flex-wrap: wrap;
	}
	h1 {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
	}
	h2 {
		margin: 0 0 8px;
		font-size: 15px;
		font-weight: 600;
	}
	.controls {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	button {
		font: inherit;
		padding: 6px 12px;
		border: 1px solid var(--vscode-button-border, transparent);
		border-radius: 2px;
		background: var(--vscode-button-secondaryBackground);
		color: var(--vscode-button-secondaryForeground);
		cursor: pointer;
	}
	button:hover {
		background: var(--vscode-button-secondaryHoverBackground);
	}
	button:focus-visible {
		outline: 2px solid var(--vscode-focusBorder);
		outline-offset: 2px;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.summary {
		color: var(--vscode-descriptionForeground);
		margin: 0;
		line-height: 1.5;
	}
	.data-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
		gap: 16px;
	}
	.data-card {
		padding: 16px;
		display: flex;
		flex-direction: column;
		gap: 8px;
		border: 1px solid var(--vscode-panel-border);
	}
	.label {
		font-size: 13px;
	}
	.value {
		font-size: 28px;
		font-variant-numeric: tabular-nums;
	}
	.unit {
		color: var(--vscode-descriptionForeground);
	}
	@media (max-width: 500px) {
		main {
			padding: 16px;
		}
		.data-grid {
			grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
		}
	}
</style>
