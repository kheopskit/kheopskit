import { firstValueFrom } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import { createKheopskitStore } from "../store";
import type { KheopskitConfig, WalletConnectConfig } from "../types";
import { polkadot } from "./plugin";

const { getInjectedExtensions, injected } = vi.hoisted(() => {
	const injected = { names: ["test-extension"] };
	return {
		getInjectedExtensions: vi.fn(() => injected.names),
		injected,
	};
});

vi.mock("polkadot-api/pjs-signer", async (importOriginal) => ({
	...(await importOriginal<typeof import("polkadot-api/pjs-signer")>()),
	getInjectedExtensions,
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
	const enable = vi.fn();

	beforeEach(() => {
		localStorage.clear();
		enable.mockReset().mockResolvedValue({
			accounts: { get: async () => [], subscribe: () => () => {} },
			signer: { signRaw: vi.fn(), signPayload: vi.fn() },
		});
		window.injectedWeb3 = { "test-extension": { enable } };
	});

	afterEach(() => {
		delete window.injectedWeb3;
	});

	it("sends appName as the dapp name", async () => {
		await connectWith({ appName: "My Dapp", walletConnect });

		expect(enable).toHaveBeenCalledWith("My Dapp");
	});

	it("falls back to the WalletConnect metadata name", async () => {
		await connectWith({ walletConnect });

		expect(enable).toHaveBeenCalledWith("WalletConnect Dapp");
	});

	it("falls back to the page hostname", async () => {
		await connectWith({ appName: "" });

		expect(enable).toHaveBeenCalledWith("localhost");
	});
});

describe("polkadot wallet enable() result", () => {
	const alice = {
		address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
		name: "Alice",
		type: "sr25519" as const,
		genesisHash: null,
	};
	let pushAccounts: (accounts: (typeof alice)[]) => void = () => {};
	const good = {
		enable: vi.fn().mockResolvedValue({
			accounts: {
				get: async () => [alice],
				subscribe: (cb: (accounts: (typeof alice)[]) => void) => {
					pushAccounts = cb;
					cb([alice]);
					return () => {};
				},
			},
			signer: { signPayload: vi.fn(), signRaw: vi.fn() },
		}),
	};
	const get = async () => [];
	const subscribe = () => () => {};
	const signPayload = vi.fn();
	const signRaw = vi.fn();
	const accounts = { get, subscribe };
	const signer = { signPayload, signRaw };

	beforeEach(() => {
		localStorage.clear();
		injected.names = ["good", "bad"];
	});

	afterEach(() => {
		delete window.injectedWeb3;
		injected.names = ["test-extension"];
	});

	it.each([
		["signer.signRaw", { accounts, signer: { signPayload } }],
		["signer.signPayload", { accounts, signer: { signRaw } }],
		["accounts.get", { accounts: { subscribe }, signer }],
		["accounts.subscribe", { accounts: { get }, signer }],
		["a signer object", { accounts }],
		["an accounts object", { signer }],
		["an object (null)", null],
		["an object (undefined)", undefined],
		["an object (a string)", "not an object"],
	])(
		"rejects connect() when enable() resolves without %s and keeps the other wallet's accounts streaming",
		async (_, enableResult) => {
			window.injectedWeb3 = {
				good,
				bad: { enable: vi.fn().mockResolvedValue(enableResult) },
			};
			const plugin = polkadot();
			const store = createKheopskitStore();
			const wallets$ = plugin.getWallets$({
				store,
				config: resolveConfig({ appName: "test", platforms: [plugin] }),
			});
			const emissions: string[][] = [];
			const subscription = plugin
				.getAccounts$(wallets$)
				.subscribe((accounts) =>
					emissions.push(
						accounts.map((account) => `${account.walletId}:${account.name}`),
					),
				);
			const walletById = async (id: string) => {
				const wallet = (await firstValueFrom(wallets$)).find(
					(w) => w.id === id,
				);
				if (!wallet) throw new Error(`no wallet ${id}`);
				return wallet;
			};

			await (await walletById("polkadot:good")).connect();
			await expect(
				(await walletById("polkadot:bad")).connect(),
			).rejects.toMatchObject({
				code: "CONNECT_FAILED",
				cause: new Error('Unsupported extension: "bad"'),
			});

			const wallets = await firstValueFrom(wallets$);
			expect(wallets.map((w) => [w.id, w.isConnected])).toEqual([
				["polkadot:good", true],
				["polkadot:bad", false],
			]);
			expect((await firstValueFrom(store.observable)).remembered).toEqual([
				"polkadot:good",
			]);

			pushAccounts([{ ...alice, name: "Alice (renamed)" }]);
			expect(emissions.at(-1)).toEqual(["polkadot:good:Alice (renamed)"]);
			subscription.unsubscribe();
		},
	);
});

describe("polkadot connect abandoned after the grant", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		localStorage.clear();
	});

	afterEach(() => {
		delete window.injectedWeb3;
		vi.useRealTimers();
		injected.names = ["test-extension"];
	});

	it("drops the handle without subscribing when the extension leaves before kheopskit processes the grant", async () => {
		const subscribe = vi.fn(() => () => {});
		const handle = {
			accounts: { get: async () => [], subscribe },
			signer: { signPayload: vi.fn(), signRaw: vi.fn() },
		};
		let grant: (injected: typeof handle) => void = () => {};
		window.injectedWeb3 = {
			"test-extension": {
				enable: () =>
					new Promise<typeof handle>((resolve) => {
						grant = resolve;
					}),
			},
		};
		const plugin = polkadot();
		const store = createKheopskitStore();
		const wallets$ = plugin.getWallets$({
			store,
			config: resolveConfig({ appName: "test", platforms: [plugin] }),
		});
		const emissions: [string, boolean][][] = [];
		const subscription = wallets$.subscribe((wallets) =>
			emissions.push(wallets.map((w) => [w.id, w.isConnected])),
		);
		const accountsSubscription = plugin.getAccounts$(wallets$).subscribe();
		const [wallet] = await firstValueFrom(wallets$);
		if (!wallet) throw new Error("no wallet");

		const connect = wallet.connect();
		grant(handle);
		injected.names = [];
		vi.advanceTimersByTime(100);

		await expect(connect).rejects.toMatchObject({ code: "ABORTED" });
		for (let i = 0; i < 30; i++) await Promise.resolve();
		expect(subscribe).not.toHaveBeenCalled();
		expect(emissions.at(-1)).toEqual([]);
		expect((await firstValueFrom(store.observable)).remembered ?? []).toEqual(
			[],
		);

		injected.names = ["test-extension"];
		vi.advanceTimersByTime(200);
		expect(emissions.at(-1)).toEqual([["polkadot:test-extension", false]]);
		accountsSubscription.unsubscribe();
		subscription.unsubscribe();
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
