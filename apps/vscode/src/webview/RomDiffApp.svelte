<script lang="ts">
	import { onMount } from "svelte";
	import type {
		DiffHostMessage,
		DiffSummaryMessage,
		DiffTableDetail,
		DiffTableStatus,
		DiffWebviewMessage,
	} from "../rom-diff-protocol.js";
	import DiffGrid from "./DiffGrid.svelte";
	let { send }: { send: (message: DiffWebviewMessage) => void } = $props();
	let summary = $state<DiffSummaryMessage>();
	let detail = $state<DiffTableDetail>();
	let selected = $state<number>();
	let query = $state("");
	let showUnchanged = $state(false);
	let rowStart = $state(0);
	const statusLabel: Record<DiffTableStatus, string> = {
		changed: "Values changed",
		axis_changed: "Axes changed",
		unchanged: "Unchanged",
		incompatible: "Cannot compare",
		base_only: "Baseline only",
		target_only: "Comparison only",
	};
	let filtered = $derived(
		summary?.tables.filter(
			(table) =>
				(showUnchanged || table.status !== "unchanged") &&
				`${table.name} ${table.category} ${statusLabel[table.status]}`
					.toLowerCase()
					.includes(query.toLowerCase()),
		) ?? [],
	);
	function select(index: number) {
		selected = index;
		detail = undefined;
		rowStart = 0;
		send({ type: "selectTable", index });
	}
	onMount(() => {
		const receive = (event: MessageEvent<DiffHostMessage>) => {
			if (event.data.type === "summary") {
				summary = event.data;
				const first = summary.tables.find(
					(table) => table.status !== "unchanged",
				);
				if (first) select(first.index);
			} else if (
				event.data.type === "detail" &&
				event.data.detail.index === selected
			)
				detail = event.data.detail;
		};
		window.addEventListener("message", receive);
		send({ type: "ready" });
		return () => window.removeEventListener("message", receive);
	});
</script>

{#if summary}
	<header class="diff-header">
		<h1>ROM comparison</h1>
		<div class="sources">
			{#each [{ name: "Baseline", source: summary.base }, { name: "Comparison", source: summary.target }] as { name, source }}
				<div class="source">
					<span class="source-label">{name}</span><strong>{source.label}</strong
					><small>{source.path}</small><small
						>{source.definition} · Captured {new Date(
							source.capturedAt,
						).toLocaleString()}</small
					>
				</div>
			{/each}
		</div>
		{#if summary.definitionsDiffer}<p class="notice">
				These ROMs use different definitions. Only unique, exact table names are
				paired; review their axes and units.
			</p>{/if}
	</header>
	<div class="diff-layout">
		<nav class="table-nav" aria-label="Comparison tables">
			<label for="table-search">Find a table</label><input
				class="search"
				id="table-search"
				type="search"
				bind:value={query}
				placeholder="Name, category, or status"
			/>
			<label class="filter"
				><input type="checkbox" bind:checked={showUnchanged} /> Show unchanged tables</label
			>
			<p class="table-count" aria-live="polite">
				{filtered.length} of {summary.tables.length} tables
			</p>
			<div class="table-list">
				{#each filtered as table}
					<button
						class="table-choice"
						aria-pressed={selected === table.index}
						onclick={() => select(table.index)}
						>{table.name}<span
							>{statusLabel[table.status]}{table.cellsChanged
								? ` · ${table.cellsChanged} ${table.cellsChanged === 1 ? "cell" : "cells"}`
								: ""}</span
						>{#if table.category}<span>{table.category}</span>{/if}</button
					>
				{:else}<p class="empty">
						{query
							? "No tables match your search."
							: "No differences found. Show unchanged tables to inspect matching values."}
					</p>{/each}
			</div>
		</nav>
		<main
			class="table-detail"
			aria-label="Table differences"
			aria-live="polite"
		>
			{#if detail}
				<h2>{detail.name}</h2>
				<p class="table-meta">
					{statusLabel[detail.status]} · {detail.category ||
						"Uncategorized"}{detail.unit ? ` · ${detail.unit}` : ""}
				</p>
				{#if detail.reason}<p class="notice">{detail.reason}</p>{/if}
				{#if detail.status === "base_only" || detail.status === "target_only"}<p
					>
						This table exists only in the {detail.status === "base_only"
							? "baseline"
							: "comparison"} definition.
					</p>{/if}
				{#if detail.xAxisChanged || detail.yAxisChanged}
					<p class="notice">
						Axis breakpoints differ. Values below are shown at their own
						breakpoints; cell deltas are unavailable because operating points
						may differ.
					</p>
					{#each ["xAxisValues", "yAxisValues"] as axis}{#if detail.base && detail.target && (axis === "xAxisValues" ? detail.xAxisChanged : detail.yAxisChanged)}<p
							>
								<strong
									>{axis === "xAxisValues" ? "X" : "Y"} axis baseline:</strong
								>
								{(axis === "xAxisValues"
									? detail.base.xAxisValues
									: detail.base.yAxisValues
								).join(", ")}
							</p>
							<p>
								<strong>Comparison:</strong>
								{(axis === "xAxisValues"
									? detail.target.xAxisValues
									: detail.target.yAxisValues
								).join(", ")}
							</p>{/if}{/each}
				{/if}
				{#if detail.base && detail.target}
					{#if detail.base.rows > 64}<div class="paging">
							<button
								disabled={rowStart === 0}
								onclick={() => (rowStart = Math.max(0, rowStart - 64))}
								>Previous rows</button
							><span
								>Rows {rowStart + 1}–{Math.min(rowStart + 64, detail.base.rows)} of
								{detail.base.rows}</span
							><button
								disabled={rowStart + 64 >= detail.base.rows}
								onclick={() => (rowStart += 64)}>Next rows</button
							>
						</div>{/if}
					<div class="grids">
						<section class="grid-section">
							<h3>Baseline</h3>
							<DiffGrid
								grid={detail.base}
								other={detail.target}
								start={rowStart}
								label="Baseline values"
							/>
						</section>
						<section class="grid-section">
							<h3>Comparison</h3>
							<DiffGrid
								grid={detail.target}
								other={detail.base}
								start={rowStart}
								label="Comparison values"
							/>
						</section>
					</div>
					{#if detail.status === "changed" || detail.status === "unchanged"}<section
							class="delta"
						>
							<h3>Delta · comparison minus baseline</h3>
							<DiffGrid
								grid={detail.target}
								other={detail.base}
								start={rowStart}
								delta
								label="Cell deltas"
							/>
						</section>{/if}
				{/if}
			{:else}<p class="empty">
					{selected === undefined
						? "Select a table to inspect its values."
						: "Loading table…"}
				</p>{/if}
		</main>
	</div>
{:else}<p class="empty" role="status">Preparing ROM comparison…</p>{/if}
