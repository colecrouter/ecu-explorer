<script lang="ts">
	import type {
		LiveDataFrame,
		LiveDataProfileDescriptor,
		PidDescriptor,
	} from "@ecu-explorer/device";

	const vscode = acquireVsCodeApi();

	let profiles: LiveDataProfileDescriptor[] = [];
	let selectedProfileId: string | null = null;
	let supportedPids: PidDescriptor[] = [];
	let selectedPids: Set<number> = new Set();
	let liveData: Map<number, LiveDataFrame> = new Map();
	let isStreaming = false;
	let isRecording = false;
	let startTime: number | null = null;
	let duration = "00:00";
	let currentProfile: LiveDataProfileDescriptor | null = null;
	let visiblePids: PidDescriptor[] = [];

	window.addEventListener("message", (event) => {
		const message = event.data;
		switch (message.type) {
			case "supportedProfiles":
				profiles = message.profiles;
				selectedProfileId =
					message.selectedProfileId ?? message.profiles[0]?.id ?? null;
				selectedPids = new Set();
				break;
			case "supportedPids":
				supportedPids = message.pids;
				break;
			case "data":
				liveData.set(message.frame.pid, message.frame);
				liveData = liveData; // trigger reactivity
				break;
			case "streamingStarted":
				isStreaming = true;
				startTime = Date.now();
				updateDuration();
				break;
			case "streamingStopped":
				isStreaming = false;
				isRecording = false;
				startTime = null;
				break;
		}
	});

	function getCurrentProfile(): LiveDataProfileDescriptor | null {
		return (
			profiles.find((profile) => profile.id === selectedProfileId) ?? null
		);
	}

	function getVisiblePids(): PidDescriptor[] {
		return getCurrentProfile()?.pids ?? supportedPids;
	}

	function onProfileChange(event: Event) {
		const value = (event.currentTarget as HTMLSelectElement).value;
		selectedProfileId = value.length > 0 ? value : null;
		selectedPids = new Set();
	}

	$: currentProfile = getCurrentProfile();
	$: visiblePids = getVisiblePids();

	function togglePid(pid: number) {
		if (selectedPids.has(pid)) {
			selectedPids.delete(pid);
		} else {
			selectedPids.add(pid);
		}
		selectedPids = selectedPids;
	}

	function startStreaming() {
		const profile = getCurrentProfile();
		vscode.postMessage({
			type: "startStreaming",
			pids: Array.from(selectedPids),
			profileId: profile?.id,
			record: isRecording,
		});
	}

	function stopStreaming() {
		vscode.postMessage({ type: "stopStreaming" });
	}

	function updateDuration() {
		if (startTime && isStreaming) {
			const diff = Math.floor((Date.now() - startTime) / 1000);
			const mins = Math.floor(diff / 60)
				.toString()
				.padStart(2, "0");
			const secs = (diff % 60).toString().padStart(2, "0");
			duration = `${mins}:${secs}`;
			setTimeout(updateDuration, 1000);
		}
	}

	// Signal ready
	vscode.postMessage({ type: "ready" });
</script>

<main>
	<header>
		<h1>Live Data</h1>
		<div class="controls">
			{#if !isStreaming}
				<label>
					<input type="checkbox" bind:checked={isRecording} />
					Record to CSV
				</label>
				<button
					on:click={startStreaming}
					disabled={
						selectedPids.size === 0 ||
						(currentProfile !== null && currentProfile.status === "unavailable")
					}
				>
					Start Streaming
				</button>
			{:else}
				<span class="status">
					{isRecording ? "🔴 Recording" : "🟢 Streaming"} - {duration}
				</span>
				<button on:click={stopStreaming}>Stop</button>
			{/if}
		</div>
	</header>

	{#if profiles.length > 0}
		<section class="profile-selector">
			<h2>Logging Profile</h2>
			<label class="profile-field">
				<span>Profile</span>
				<select
					bind:value={selectedProfileId}
					on:change={onProfileChange}
					disabled={isStreaming}
				>
					{#each profiles as profile}
						<option value={profile.id}>
							{profile.name} [{profile.requestFamily ?? profile.transportFamily ?? "profile"}]
						</option>
					{/each}
				</select>
			</label>
			{#if currentProfile}
				<p class="profile-summary">
					<strong>{currentProfile.status}</strong>
					{#if currentProfile.transportFamily}
						<span> • {currentProfile.transportFamily}</span>
					{/if}
					{#if currentProfile.requestFamily}
						<span> • {currentProfile.requestFamily}</span>
					{/if}
					{#if currentProfile.decodeFamily}
						<span> • {currentProfile.decodeFamily}</span>
					{/if}
				</p>
				{#if currentProfile.description}
					<p class="profile-note">{currentProfile.description}</p>
				{/if}
				{#if currentProfile.statusDetail}
					<p class="profile-note">{currentProfile.statusDetail}</p>
				{/if}
			{/if}
		</section>
	{/if}

	<section class="pid-selector">
		<h2>Select PIDs</h2>
		<div class="pid-grid">
			{#each visiblePids as pid}
				<button
					class="pid-chip"
					class:selected={selectedPids.has(pid.pid)}
					on:click={() => togglePid(pid.pid)}
					disabled={isStreaming}
				>
					{pid.name}
				</button>
			{/each}
		</div>
	</section>

	<section class="data-display">
		<h2>Real-time Data</h2>
		<div class="data-grid">
			{#each Array.from(selectedPids) as pidId}
				{@const descriptor = supportedPids.find((p) => p.pid === pidId)}
				{@const data = liveData.get(pidId)}
				<div class="data-card">
					<span class="label"
						>{descriptor?.name ?? `PID 0x${pidId.toString(16)}`}</span
					>
					<span class="value">{data?.value.toFixed(2) ?? "--"}</span>
					<span class="unit">{descriptor?.unit ?? ""}</span>
				</div>
			{/each}
		</div>
	</section>
</main>

<style>
	main {
		padding: 1rem;
		display: flex;
		flex-direction: column;
		gap: 2rem;
	}

	.profile-selector {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.profile-field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		max-width: 32rem;
	}

	.profile-field select {
		padding: 0.5rem 0.75rem;
		border-radius: 6px;
		border: 1px solid var(--vscode-dropdown-border, var(--vscode-panel-border));
		background: var(--vscode-dropdown-background, var(--vscode-input-background));
		color: var(--vscode-dropdown-foreground, var(--vscode-input-foreground));
	}

	.profile-summary,
	.profile-note {
		margin: 0;
		color: var(--vscode-descriptionForeground);
	}

	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid var(--vscode-panel-border);
		padding-bottom: 1rem;
	}

	.controls {
		display: flex;
		align-items: center;
		gap: 1rem;
	}

	.status {
		font-weight: bold;
	}

	.pid-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	.pid-chip {
		padding: 0.25rem 0.75rem;
		border-radius: 1rem;
		border: 1px solid var(--vscode-button-background);
		background: transparent;
		color: var(--vscode-foreground);
		cursor: pointer;
	}

	.pid-chip.selected {
		background: var(--vscode-button-background);
		color: var(--vscode-button-foreground);
	}

	.pid-chip:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.data-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 1rem;
	}

	.data-card {
		background: var(--vscode-sideBar-background);
		padding: 1rem;
		border-radius: 4px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		border: 1px solid var(--vscode-panel-border);
	}

	.label {
		font-size: 0.8rem;
		opacity: 0.8;
	}

	.value {
		font-size: 2rem;
		font-weight: bold;
	}

	.unit {
		font-size: 0.9rem;
		opacity: 0.7;
	}
</style>
