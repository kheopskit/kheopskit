/**
 * @vitest-environment node
 */
import { polkadot } from "@kheopskit/core/polkadot";
import { cachedWalletOf } from "@kheopskit/core/testing";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createKheopskit } from "./createKheopskit";

const cookiesWith = (walletId: `polkadot:${string}`, name: string) =>
	`kheopskit=${encodeURIComponent(
		JSON.stringify({
			cachedWallets: [cachedWalletOf(walletId, name)],
			cachedAccounts: [],
		}),
	)}`;

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

it("renders each SSR request from its own cookies through one createKheopskit result, running nothing", () => {
	const { KheopskitProvider, useWallets } = createKheopskit(
		{ platforms: [polkadot()] },
		{ ssr: true },
	);
	const WalletNames = () => (
		<span>
			{useWallets()
				.wallets.map((wallet) => wallet.name)
				.join(",")}
		</span>
	);
	const renderRequest = (ssrCookies: string) =>
		renderToString(
			<KheopskitProvider ssrCookies={ssrCookies}>
				<WalletNames />
			</KheopskitProvider>,
		);

	expect({
		renders: [
			renderRequest(cookiesWith("polkadot:talisman", "Talisman")),
			renderRequest(cookiesWith("polkadot:subwallet-js", "SubWallet")),
		],
		timers: vi.getTimerCount(),
	}).toEqual({
		renders: ["<span>Talisman</span>", "<span>SubWallet</span>"],
		timers: 0,
	});
});
