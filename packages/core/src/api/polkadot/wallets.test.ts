import { firstValueFrom } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import { createKheopskitStore } from "../store";
import type { KheopskitConfig, WalletConnectConfig } from "../types";
import { polkadot } from "./plugin";

const { connectInjectedExtension, getInjectedExtensions, injected } =
	vi.hoisted(() => {
		const injected = { names: ["test-extension"] };
		return {
			connectInjectedExtension: vi.fn().mockResolvedValue({}),
			getInjectedExtensions: vi.fn(() => injected.names),
			injected,
		};
	});

vi.mock("polkadot-api/pjs-signer", () => ({
	getInjectedExtensions,
	connectInjectedExtension,
}));

const walletConnect = {
	projectId: "test",
	metadata: {
		name: "WalletConnect Dapp",
		description: "",
		url: "",
		icons: [],
	},
	networks: [{}],
} satisfies WalletConnectConfig;

const connectWith = async (config: Partial<KheopskitConfig>) => {
	const plugin = polkadot();
	const wallets$ = plugin.getWallets$({
		store: createKheopskitStore(),
		config: resolveConfig({ ...config, platforms: [plugin] }),
	});
	const subscription = wallets$.subscribe();
	const [wallet] = await firstValueFrom(wallets$);
	await wallet?.connect();
	subscription.unsubscribe();
};

describe("polkadot wallet connect", () => {
	beforeEach(() => {
		localStorage.clear();
		connectInjectedExtension.mockClear();
	});

	it("sends appName as the dapp name", async () => {
		await connectWith({ appName: "My Dapp", walletConnect });

		expect(connectInjectedExtension).toHaveBeenCalledWith(
			"test-extension",
			"My Dapp",
		);
	});

	it("falls back to the WalletConnect metadata name", async () => {
		await connectWith({ walletConnect });

		expect(connectInjectedExtension).toHaveBeenCalledWith(
			"test-extension",
			"WalletConnect Dapp",
		);
	});

	it("falls back to the page hostname", async () => {
		await connectWith({ appName: "" });

		expect(connectInjectedExtension).toHaveBeenCalledWith(
			"test-extension",
			"localhost",
		);
	});
});

describe("polkadot wallet discovery", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		Object.defineProperty(document, "readyState", {
			value: "interactive",
			configurable: true,
		});
		injected.names = [];
	});

	afterEach(() => {
		Reflect.deleteProperty(document, "readyState");
		vi.useRealTimers();
		injected.names = ["test-extension"];
	});

	it("reads injectedWeb3 again at window load", () => {
		const plugin = polkadot();
		const emissions: string[][] = [];
		const subscription = plugin
			.getWallets$({
				store: createKheopskitStore(),
				config: resolveConfig({ platforms: [plugin] }),
			})
			.subscribe((wallets) => emissions.push(wallets.map((w) => w.id)));

		vi.advanceTimersByTime(1200);
		injected.names = ["at-load"];
		window.dispatchEvent(new Event("load"));
		expect(emissions.at(-1)).toEqual(["polkadot:at-load"]);

		injected.names = ["at-load", "load-plus-100"];
		vi.advanceTimersByTime(100);
		expect(emissions.at(-1)).toEqual([
			"polkadot:at-load",
			"polkadot:load-plus-100",
		]);

		injected.names = ["at-load", "load-plus-100", "too-late"];
		vi.advanceTimersByTime(60_000);
		expect(emissions.at(-1)).toEqual([
			"polkadot:at-load",
			"polkadot:load-plus-100",
		]);

		subscription.unsubscribe();
	});

	it("does not read injectedWeb3 after an unsubscribe during the load emission", () => {
		const plugin = polkadot();
		const subscription = plugin
			.getWallets$({
				store: createKheopskitStore(),
				config: resolveConfig({ platforms: [plugin] }),
			})
			.subscribe((wallets) => {
				if (wallets.some((w) => w.id === "polkadot:at-load"))
					subscription.unsubscribe();
			});

		vi.advanceTimersByTime(1200);
		injected.names = ["at-load"];
		window.dispatchEvent(new Event("load"));
		const readsAtUnsubscribe = getInjectedExtensions.mock.calls.length;

		vi.advanceTimersByTime(60_000);
		expect(getInjectedExtensions).toHaveBeenCalledTimes(readsAtUnsubscribe);
	});
});
