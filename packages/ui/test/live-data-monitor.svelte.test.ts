import { describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-svelte";
import LiveDataApp from "../../../apps/vscode/src/webview/LiveDataApp.svelte";

describe("Live Data monitor", () => {
	it("shows the shared profile and selected values and routes configuration to native controls", async () => {
		const send = vi.fn();
		const screen = render(LiveDataApp, { send });
		await vi.waitFor(() =>
			expect(send).toHaveBeenCalledWith({ type: "ready" }),
		);
		window.dispatchEvent(
			new MessageEvent("message", {
				data: {
					type: "configuration",
					profileName: "Golden USDM v3",
					pids: [{ pid: 12, name: "Engine RPM", unit: "rpm" }],
					recording: false,
				},
			}),
		);
		window.dispatchEvent(
			new MessageEvent("message", {
				data: { type: "data", frame: { pid: 12, value: 850 } },
			}),
		);
		await expect
			.element(screen.getByRole("heading", { name: "Golden USDM v3" }))
			.toBeVisible();
		await expect
			.element(screen.getByText("850.00", { exact: true }))
			.toBeVisible();
		expect(screen.container.querySelector("select")).toBeNull();
		expect(screen.container.querySelector("input[type=checkbox]")).toBeNull();
		await screen.getByRole("button", { name: "Change Configuration" }).click();
		expect(send).toHaveBeenCalledWith({ type: "changeConfiguration" });
	});
	it("protects an active recording and clears stale values when channels change", async () => {
		const send = vi.fn();
		const screen = render(LiveDataApp, { send });
		await vi.waitFor(() =>
			expect(send).toHaveBeenCalledWith({ type: "ready" }),
		);
		const post = (data: unknown) =>
			window.dispatchEvent(new MessageEvent("message", { data }));
		post({
			type: "configuration",
			profileName: "Test",
			pids: [{ pid: 12, name: "RPM", unit: "rpm" }],
			recording: true,
		});
		post({ type: "streamingStarted" });
		post({ type: "data", frame: { pid: 12, value: 900 } });
		await expect
			.element(screen.getByRole("button", { name: "Stop Streaming" }))
			.toBeDisabled();
		post({
			type: "configuration",
			profileName: "Test",
			pids: [{ pid: 13, name: "Speed", unit: "km/h" }],
			recording: true,
		});
		await expect
			.element(screen.getByText("Speed", { exact: true }))
			.toBeVisible();
		await expect
			.element(screen.getByText("900.00", { exact: true }))
			.not.toBeInTheDocument();
	});
});
