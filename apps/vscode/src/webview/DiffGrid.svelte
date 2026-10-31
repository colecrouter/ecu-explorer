<script lang="ts">
	import {
		diffValueDelta,
		formatDiffValue as number,
		type DiffGridData,
	} from "../rom-diff-protocol.js";
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
						{@const deltaValue = diffValueDelta(value, counterpart)}
						<td
							class:changed
							title={delta && deltaValue === undefined
								? "Delta unavailable for infinite values"
								: changed
									? "Changed cell"
									: undefined}
							>{delta && counterpart !== undefined
								? `${deltaValue !== undefined && deltaValue > 0 ? "+" : ""}${number(deltaValue)}`
								: number(value)}</td
						>
					{/each}
				</tr>
			{/each}</tbody
		>
	</table>
</div>
