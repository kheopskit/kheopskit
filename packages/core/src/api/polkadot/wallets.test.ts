import { firstValueFrom } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createFakePolkadotExtension,
	type FakePolkadotExtension,
} from "../../testing/fakePolkadotExtension";
import { createMemoryStorage } from "../../testing/memoryStorage";
import { resolveConfig } from "../config";
import { getKheopskit$ } from "../kheopskit";
import { createKheopskitStore } from "../store";
import type {
	KheopskitConfig,
	KheopskitState,
	WalletConnectConfig,
} from "../types";
import { polkadot } from "./plugin";

const fakes: FakePolkadotExtension[] = [];

const install = (...args: Parameters<typeof createFakePolkadotExtension>) => {
	const fake = createFakePolkadotExtension(...args);
	fakes.push(fake);
	return fake;
};

afterEach(() => {
	for (const fake of fakes.splice(0)) fake.uninstall();
});

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
		store: createKheopskitStore({ storage: createMemoryStorage() }),
		config: resolveConfig({ ...config, platforms: [plugin] }),
	});
	const subscription = wallets$.subscribe();
	const [wallet] = await firstValueFrom(wallets$);
	await wallet?.connect();
	subscription.unsubscribe();
};

describe("polkadot wallet connect", () => {
	let fake: FakePolkadotExtension;

	beforeEach(() => {
		fake = install({ name: "test-extension" });
	});

	it("sends appName as the dapp name", async () => {
		await connectWith({ appName: "My Dapp", walletConnect });

		expect(fake.enableCalls()).toEqual(["My Dapp"]);
	});

	it("falls back to the WalletConnect metadata name", async () => {
		await connectWith({ walletConnect });

		expect(fake.enableCalls()).toEqual(["WalletConnect Dapp"]);
	});

	it("falls back to the page hostname", async () => {
		await connectWith({ appName: "" });

		expect(fake.enableCalls()).toEqual(["localhost"]);
	});
});

describe("polkadot wallet enable() result", () => {
	const alice = {
		address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
		name: "Alice",
		type: "sr25519" as const,
	};
	const get = async () => [];
	const subscribe = () => () => {};
	const signPayload = vi.fn();
	const signRaw = vi.fn();
	const accounts = { get, subscribe };
	const signer = { signPayload, signRaw };

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
			const good = install({ name: "good", accounts: [alice] });
			const injectedWeb3 = window.injectedWeb3 ?? {};
			injectedWeb3.bad = { enable: vi.fn().mockResolvedValue(enableResult) };
			const plugin = polkadot();
			const store = createKheopskitStore({ storage: createMemoryStorage() });
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

			good.setAccounts([{ ...alice, name: "Alice (renamed)" }]);
			expect(emissions.at(-1)).toEqual(["polkadot:good:Alice (renamed)"]);
			subscription.unsubscribe();
			delete injectedWeb3.bad;
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
	});

	it("drops the handle without subscribing when the extension leaves before kheopskit processes the grant", async () => {
		const subscribe = vi.fn(() => () => {});
		const handle = {
			accounts: { get: async () => [], subscribe },
			signer: { signPayload: vi.fn(), signRaw: vi.fn() },
		};
		let grant: (injected: typeof handle) => void = () => {};
		const extension = {
			enable: () =>
				new Promise<typeof handle>((resolve) => {
					grant = resolve;
				}),
		};
		window.injectedWeb3 = { "test-extension": extension };
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
		delete window.injectedWeb3["test-extension"];
		vi.advanceTimersByTime(100);

		await expect(connect).rejects.toMatchObject({ code: "ABORTED" });
		for (let i = 0; i < 30; i++) await Promise.resolve();
		expect(subscribe).not.toHaveBeenCalled();
		expect(emissions.at(-1)).toEqual([]);
		expect((await firstValueFrom(store.observable)).remembered ?? []).toEqual(
			[],
		);

		window.injectedWeb3["test-extension"] = extension;
		vi.advanceTimersByTime(200);
		expect(emissions.at(-1)).toEqual([["polkadot:test-extension", false]]);
		accountsSubscription.unsubscribe();
		subscription.unsubscribe();
	});
});

describe("polkadot accounts at connect", () => {
	const alice = {
		address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
		name: "Alice",
		type: "sr25519" as const,
	};
	const settleMicrotasks = async () => {
		for (let i = 0; i < 30; i++) await Promise.resolve();
	};
	const installExtension = (get: () => Promise<(typeof alice)[]>) => {
		const subscribe = vi.fn(() => () => {});
		window.injectedWeb3 = {
			"test-extension": {
				enable: async () => ({
					accounts: { get, subscribe },
					signer: { signPayload: vi.fn(), signRaw: vi.fn() },
				}),
			},
		};
		return { subscribe };
	};
	const walletsOf = (plugin: ReturnType<typeof polkadot>) => {
		const store = createKheopskitStore();
		const wallets$ = plugin.getWallets$({
			store,
			config: resolveConfig({ appName: "test", platforms: [plugin] }),
		});
		return { store, wallets$ };
	};

	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		delete window.injectedWeb3;
		vi.useRealTimers();
	});

	it("lists the accounts in the emission that first shows the wallet connected", async () => {
		let release: (accounts: (typeof alice)[]) => void = () => {};
		installExtension(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const emissions: KheopskitState[] = [];
		const subscription = getKheopskit$(
			{ platforms: [polkadot()], hydrationGracePeriod: 0 },
			{ store: createKheopskitStore() },
		).subscribe((state) => emissions.push(state));
		for (let i = 0; emissions.length === 0 && i < 20; i++)
			await new Promise((resolve) => setTimeout(resolve, 0));
		const wallet = emissions.at(-1)?.wallets[0];
		if (!wallet) throw new Error("no wallet");

		const connecting = wallet.connect();
		await settleMicrotasks();
		expect(emissions.at(-1)?.wallets[0]?.isConnected).toBe(false);

		release([alice]);
		await connecting;

		const addressesOf = (state: KheopskitState | undefined) =>
			state?.accounts.map((account) => account.address);
		const firstConnected = emissions.find((state) =>
			state.wallets.some((w) => w.isConnected),
		);
		expect(addressesOf(firstConnected)).toEqual([alice.address]);
		expect(addressesOf(emissions.at(-1))).toEqual([alice.address]);
		subscription.unsubscribe();
	});

	it("rejects connect CONNECT_FAILED with the cause when accounts.get() rejects and does not remember the wallet", async () => {
		const cause = new Error("accounts unavailable");
		installExtension(() => Promise.reject(cause));
		const { store, wallets$ } = walletsOf(polkadot());
		const subscription = wallets$.subscribe();
		const [wallet] = await firstValueFrom(wallets$);
		if (!wallet) throw new Error("no wallet");

		await expect(wallet.connect()).rejects.toMatchObject({
			code: "CONNECT_FAILED",
			cause,
		});
		expect((await firstValueFrom(wallets$)).map((w) => w.isConnected)).toEqual([
			false,
		]);
		expect((await firstValueFrom(store.observable)).remembered ?? []).toEqual(
			[],
		);
		subscription.unsubscribe();
	});

	it("aborts a connect whose extension leaves while accounts.get() pends", async () => {
		vi.useFakeTimers();
		let release: (accounts: (typeof alice)[]) => void = () => {};
		const { subscribe } = installExtension(
			() =>
				new Promise((resolve) => {
					release = resolve;
				}),
		);
		const plugin = polkadot();
		const { store, wallets$ } = walletsOf(plugin);
		const emissions: [string, boolean][][] = [];
		const subscription = wallets$.subscribe((wallets) =>
			emissions.push(wallets.map((w) => [w.id, w.isConnected])),
		);
		const accountsSubscription = plugin.getAccounts$(wallets$).subscribe();
		const [wallet] = await firstValueFrom(wallets$);
		if (!wallet) throw new Error("no wallet");

		const connect = wallet.connect();
		await settleMicrotasks();
		delete window.injectedWeb3?.["test-extension"];
		vi.advanceTimersByTime(100);

		await expect(connect).rejects.toMatchObject({ code: "ABORTED" });
		release([alice]);
		await settleMicrotasks();
		expect(subscribe).not.toHaveBeenCalled();
		expect(emissions.at(-1)).toEqual([]);
		expect((await firstValueFrom(store.observable)).remembered ?? []).toEqual(
			[],
		);
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
	});

	afterEach(() => {
		Reflect.deleteProperty(document, "readyState");
		vi.useRealTimers();
	});

	const subscribeToWallets = (onWallets: (ids: string[]) => void) => {
		const plugin = polkadot();
		return plugin
			.getWallets$({
				store: createKheopskitStore({ storage: createMemoryStorage() }),
				config: resolveConfig({ platforms: [plugin] }),
			})
			.subscribe((wallets) => onWallets(wallets.map((w) => w.id)));
	};

	it("reads injectedWeb3 again at window load", () => {
		const emissions: string[][] = [];
		const subscription = subscribeToWallets((ids) => emissions.push(ids));

		vi.advanceTimersByTime(1200);
		install({ name: "at-load" });
		window.dispatchEvent(new Event("load"));
		expect(emissions.at(-1)).toEqual(["polkadot:at-load"]);

		install({ name: "load-plus-100" });
		vi.advanceTimersByTime(100);
		expect(emissions.at(-1)).toEqual([
			"polkadot:at-load",
			"polkadot:load-plus-100",
		]);

		install({ name: "too-late" });
		vi.advanceTimersByTime(60_000);
		expect(emissions.at(-1)).toEqual([
			"polkadot:at-load",
			"polkadot:load-plus-100",
		]);

		subscription.unsubscribe();
	});

	it("does not read injectedWeb3 after an unsubscribe during the load emission", () => {
		let reads = 0;
		let registry: Window["injectedWeb3"];
		Object.defineProperty(window, "injectedWeb3", {
			configurable: true,
			get: () => {
				reads++;
				return registry;
			},
			set: (value: Window["injectedWeb3"]) => {
				registry = value;
			},
		});
		const subscription = subscribeToWallets((ids) => {
			if (ids.includes("polkadot:at-load")) subscription.unsubscribe();
		});

		vi.advanceTimersByTime(1200);
		install({ name: "at-load" });
		window.dispatchEvent(new Event("load"));
		const readsAtUnsubscribe = reads;

		vi.advanceTimersByTime(60_000);
		expect(reads).toBe(readsAtUnsubscribe);
	});
});
