import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import type {
	DiffGridData,
	DiffSummaryMessage,
	DiffTableDetail,
} from "../../../apps/vscode/src/rom-diff-protocol.js";
import { romDiffStyles } from "../../../apps/vscode/src/rom-diff-styles.js";
import DiffGrid from "../../../apps/vscode/src/webview/DiffGrid.svelte";
import RomDiffApp from "../../../apps/vscode/src/webview/RomDiffApp.svelte";

const source = {
	label: "stock.bin",
	path: "/ROMs/stock.bin",
	definition: "Test ECU",
	capturedAt: "2026-10-31T12:00:00Z",
};
const summary: DiffSummaryMessage = {
	type: "summary",
	base: source,
	target: { ...source, label: "tune.bin (active, unsaved)" },
	definitionsDiffer: false,
	tables: [
		{
			index: 0,
			name: "Fuel",
			category: "Fuel",
			status: "changed",
			cellsChanged: 1,
		},
		{
			index: 1,
			name: "Timing",
			category: "Ignition",
			status: "unchanged",
			cellsChanged: 0,
		},
		{
			index: 2,
			name: "Load",
			category: "Fuel",
			status: "axis_changed",
			cellsChanged: 1,
		},
	],
};
const grid = {
	is1D: true,
	rows: 2,
	cols: 1,
	values: [[10], [20]],
	xAxisValues: [1000, 2000],
	yAxisValues: [],
};
const detail: DiffTableDetail = {
	index: 0,
	name: "Fuel",
	category: "Fuel",
	status: "changed",
	cellsChanged: 1,
	unit: "ms",
	xAxisChanged: false,
	yAxisChanged: false,
	base: grid,
	target: { ...grid, values: [[12], [20]] },
};
const post = (data: unknown) =>
	window.dispatchEvent(new MessageEvent("message", { data }));

describe("ROM diff viewer", () => {
	it("renders serialized infinities and gives equal infinities zero delta", async () => {
		const infinite: DiffGridData = {
			...grid,
			values: [["Infinity"], ["-Infinity"]],
		};
		const screen = render(DiffGrid, {
			grid: infinite,
			label: "Infinite AFR values",
		});
		await expect
			.element(screen.getByRole("cell", { name: "∞", exact: true }))
			.toBeVisible();
		await expect
			.element(screen.getByRole("cell", { name: "−∞", exact: true }))
			.toBeVisible();
		screen.unmount();
		const deltas = render(DiffGrid, {
			grid: infinite,
			other: infinite,
			delta: true,
			label: "Infinite deltas",
		});
		await expect
			.element(
				deltas
					.getByRole("table")
					.getByRole("cell", { name: "0", exact: true })
					.first(),
			)
			.toBeVisible();
		expect(deltas.container.textContent).not.toContain("NaN");
	});
	it.each([
		{ value: "Infinity", baseline: 14.7 },
		{ value: 14.7, baseline: "Infinity" },
		{ value: "-Infinity", baseline: "Infinity" },
	] as const)("marks the delta from $baseline to $value unavailable while highlighting the change", async ({
		value,
		baseline,
	}) => {
		const screen = render(DiffGrid, {
			grid: { ...grid, rows: 1, values: [[value]] },
			other: { ...grid, rows: 1, values: [[baseline]] },
			delta: true,
			label: "Undefined delta",
		});
		const cell = screen.getByRole("cell", { name: "—", exact: true });
		await expect.element(cell).toBeVisible();
		await expect.element(cell).toHaveClass("changed");
		await expect
			.element(cell)
			.toHaveAttribute("title", "Delta unavailable for infinite values");
	});

	it("keeps Y-axis breakpoints for a two-dimensional table with one column", async () => {
		const screen = render(DiffGrid, {
			grid: {
				...grid,
				is1D: false,
				xAxisValues: [20],
				yAxisValues: [1000, 2000],
			},
			label: "Single-column 2D values",
		});
		await expect
			.element(screen.getByRole("rowheader", { name: "2000", exact: true }))
			.toBeVisible();
		await expect
			.element(screen.getByRole("columnheader", { name: "20", exact: true }))
			.toBeVisible();
	});

	it("lists changes, renders signed deltas and lets users search and include unchanged tables", async () => {
		const send = vi.fn();
		const screen = render(RomDiffApp, { send });
		const style = document.createElement("style");
		style.textContent = romDiffStyles;
		screen.container.append(style);
		await vi.waitFor(() =>
			expect(send).toHaveBeenCalledWith({ type: "ready" }),
		);
		post(summary);
		await expect
			.element(screen.getByRole("button", { name: /Fuel Values changed/ }))
			.toBeVisible();
		expect(send).toHaveBeenCalledWith({ type: "selectTable", index: 0 });
		post({ type: "detail", detail });
		await expect
			.element(screen.getByRole("table", { name: "Cell deltas" }))
			.toBeVisible();
		await expect
			.element(
				screen
					.getByRole("table", { name: "Cell deltas" })
					.getByText("+2", { exact: true }),
			)
			.toBeVisible();
		await expect
			.element(screen.getByText("tune.bin (active, unsaved)", { exact: true }))
			.toBeVisible();
		await screen
			.getByRole("checkbox", { name: "Show unchanged tables" })
			.click();
		await expect
			.element(screen.getByRole("button", { name: /Timing Unchanged/ }))
			.toBeVisible();
		await screen
			.getByRole("searchbox", { name: "Find a table" })
			.fill("Ignition");
		await expect
			.element(screen.getByRole("button", { name: /Timing Unchanged/ }))
			.toBeVisible();
		await expect
			.element(screen.getByRole("button", { name: /Fuel Values changed/ }))
			.not.toBeInTheDocument();
	});
	it("shows changed axes explicitly and does not show misleading cell deltas", async () => {
		const send = vi.fn();
		const screen = render(RomDiffApp, { send });
		const style = document.createElement("style");
		style.textContent = romDiffStyles;
		screen.container.append(style);
		await vi.waitFor(() =>
			expect(send).toHaveBeenCalledWith({ type: "ready" }),
		);
		post(summary);
		await screen.getByRole("button", { name: /Load Axes changed/ }).click();
		post({
			type: "detail",
			detail: {
				...detail,
				index: 2,
				name: "Load",
				status: "axis_changed",
				xAxisChanged: true,
				target: { ...grid, xAxisValues: [1200, 2400] },
			},
		});
		await expect
			.element(screen.getByText(/Axis breakpoints differ/))
			.toBeVisible();
		await expect
			.element(screen.getByRole("table", { name: "Cell deltas" }))
			.not.toBeInTheDocument();
		await expect
			.element(screen.getByText("1200, 2400", { exact: false }))
			.toBeVisible();
	});
});
