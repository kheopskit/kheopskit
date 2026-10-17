/**
 * @vitest-environment node
 */
import { polkadot } from "@kheopskit/core/polkadot";
import { cachedWalletOf } from "@kheopskit/core/testing";
import { renderToString } from "react-dom/server";
import { expect, it } from "vitest";
import { createKheopskit } from "./createKheopskit";

const cookiesWith = (walletId: `polkadot:${string}`, name: string) =>
	`kheopskit=${encodeURIComponent(
		JSON.stringify({
			cachedWallets: [cachedWalletOf(walletId, name)],
			cachedAccounts: [],
		}),
	)}`;

it("renders each SSR request from its own cookies through one createKheopskit result", () => {
	const { KheopskitProvider, useWallets } = createKheopskit({
		platforms: [polkadot()],
	});
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

	expect([
		renderRequest(cookiesWith("polkadot:talisman", "Talisman")),
		renderRequest(cookiesWith("polkadot:subwallet-js", "SubWallet")),
	]).toEqual(["<span>Talisman</span>", "<span>SubWallet</span>"]);
});
