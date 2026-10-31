<script lang="ts">
	import type { DiffGridData } from "../rom-diff-protocol.js";
	let {
		grid,
		other,
		label,
		start = 0,
		delta = false,
	}: {
		grid: DiffGridData;
		other?: DiffGridData | undefined;
		label: string;
		start?: number;
		delta?: boolean;
	} = $props();
	const number = (value: number | undefined) =>
		value === undefined
			? "—"
			: Number.isFinite(value)
				? String(Number(value.toFixed(4)))
				: String(value);
</script>

<div class="grid-scroll">
	<table>
		<caption>{label}</caption>
		<thead
			><tr
				><th scope="col">{grid.is1D ? "Axis / row" : "Y / X"}</th
				>{#each Array(grid.cols) as _, col}<th scope="col"
						>{grid.is1D ? "Value" : number(grid.xAxisValues[col] ?? col)}</th
					>{/each}</tr
			></thead
		>
		<tbody
			>{#each grid.values.slice(start, start + 64) as row, offset}
				{@const rowIndex = start + offset}
				<tr
					><th scope="row"
						>{number(
							(grid.is1D
								? grid.xAxisValues[rowIndex]
								: grid.yAxisValues[rowIndex]) ?? rowIndex,
						)}</th
					>
					{#each row as value, col}
						{@const counterpart = other?.values[rowIndex]?.[col]}
						{@const changed =
							counterpart !== undefined && counterpart !== value}
						<td class:changed title={changed ? "Changed cell" : undefined}
							>{delta && counterpart !== undefined
								? `${value - counterpart > 0 ? "+" : ""}${number(value - counterpart)}`
								: number(value)}</td
						>
					{/each}
				</tr>
			{/each}</tbody
		>
	</table>
</div>
