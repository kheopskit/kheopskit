import { createKheopskitStore } from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import {
	createFakePolkadotExtension,
	type FakePolkadotExtension,
} from "@kheopskit/core/testing";
import { act, useEffect } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createKheopskit } from "./createKheopskit";

let fake: FakePolkadotExtension;

beforeEach(() => {
	vi.useFakeTimers();
	fake = createFakePolkadotExtension({ name: "talisman" });
	fake.setAccounts([
		{ address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY" },
	]);
	const cookieStore = createKheopskitStore({ ssrCookies: "" });
	cookieStore.rememberWallet(fake.walletId);
	cookieStore.destroy();
});

afterEach(() => {
	fake.uninstall();
	vi.useRealTimers();
});

it("keeps the cookie store when a child subscribes kheopskit$ in an effect during hydration", async () => {
	const ssrCookies = document.cookie;
	const { KheopskitProvider, kheopskit$, useWallets } = createKheopskit({
		platforms: [polkadot()],
	});
	const SessionSync = () => {
		useEffect(() => {
			const subscription = kheopskit$.subscribe();
			return () => subscription.unsubscribe();
		}, []);
		return null;
	};
	const Statuses = () => (
		<span>
			{useWallets()
				.wallets.map((wallet) => `${wallet.name}:${wallet.status}`)
				.join()}
		</span>
	);
	const app = (
		<KheopskitProvider ssrCookies={ssrCookies}>
			<SessionSync />
			<Statuses />
		</KheopskitProvider>
	);
	const container = document.createElement("div");
	container.innerHTML = renderToString(app);
	let root: Root | undefined;

	await act(async () => {
		root = hydrateRoot(container, app);
	});
	await act(() => vi.advanceTimersByTimeAsync(3000));

	expect({
		rendered: container.textContent,
		enableCalls: fake.enableCalls().length,
		localStorage: localStorage.getItem("kheopskit"),
	}).toEqual({
		rendered: "Talisman:connected",
		enableCalls: 1,
		localStorage: null,
	});
	await act(async () => root?.unmount());
});
