/**
 * @vitest-environment node
 */
import { polkadot } from "@kheopskit/core/polkadot";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { createKheopskit } from "./createKheopskit";
import { useConnect } from "./useConnect";

afterEach(() => {
	vi.restoreAllMocks();
});

it("renders useConnect on the server without warnings", () => {
	const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
	const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
	const { KheopskitProvider } = createKheopskit({ platforms: [polkadot()] });
	const Status = () => {
		const { status } = useConnect("polkadot:talisman");
		return <span>{String(status)}</span>;
	};

	const html = renderToString(
		<StrictMode>
			<KheopskitProvider ssrCookies="">
				<Status />
			</KheopskitProvider>
		</StrictMode>,
	);

	expect({
		html,
		errors: consoleError.mock.calls.map(String),
		warnings: consoleWarn.mock.calls.map(String),
	}).toEqual({ html: "<span>undefined</span>", errors: [], warnings: [] });
});
