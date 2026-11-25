import { firstValueFrom, of } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearAllCachedObservables } from "../../utils/getCachedObservable";
import { WALLET_CONNECT_WALLET_ID } from "../../utils/WalletId";
import type {
	KheopskitPlatform,
	KheopskitState,
	PlatformContext,
	WalletConnectWallet,
} from "../types";
import type { WalletConnectOptions } from "./plugin";

const options: WalletConnectOptions = {
	projectId: "test",
	metadata: { name: "Test Dapp", description: "", url: "", icons: [] },
	networks: [{}],
};

const ctx = { config: { debug: false } } as PlatformContext;

const ADDRESS_A = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const ADDRESS_B = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";

const providerWithSession = (namespace: string) => ({
	session: {
		topic: "topic",
		namespaces: { [namespace]: { accounts: [`${namespace}:chain:address`] } },
	},
});

describe("walletConnect().getWallet$ when @reown/appkit is unavailable", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it("degrades to no connector and logs an error (optional peer dep missing)", async () => {
		vi.resetModules();
		// Simulate @reown/appkit not being installed: the dynamic import rejects.
		vi.doMock("@reown/appkit/core", () => {
			throw new Error("Cannot find module '@reown/appkit/core'");
		});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const { walletConnect, resetAppKitCache } = await import("./plugin");
		resetAppKitCache();

		const result = await firstValueFrom(walletConnect(options).getWallet$(ctx));

		expect(result).toBeNull();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("@reown/appkit"),
			expect.anything(),
		);

		resetAppKitCache();
	});
});

describe("walletConnect().getWallet$ disconnect", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it("awaits the underlying disconnect and drops cached accounts when the status flips to disconnected", async () => {
		vi.resetModules();
		const disconnect = vi.fn(() => Promise.resolve());
		// Capture the providers callback so the test can drive connect/disconnect
		// transitions, mirroring how AppKit reports them via subscribeProviders.
		let emitProviders: (p: Record<string, unknown>) => void = () => {};
		let providers: Record<string, unknown> = {};
		const fakeAppKit = {
			chainNamespaces: ["solana"],
			getUniversalProvider: () => Promise.resolve(undefined),
			getProvider: (namespace: string) => providers[namespace],
			subscribeProviders: (cb: (p: Record<string, unknown>) => void) => {
				emitProviders = (next) => {
					providers = next;
					cb(next);
				};
				emitProviders({ solana: providerWithSession("solana") });
				return () => {};
			},
			getWalletInfo: () => ({ name: "WC", icon: "icon" }),
			open: vi.fn(() => Promise.resolve()),
			disconnect,
		};
		vi.doMock("@reown/appkit/core", () => ({
			createAppKit: () => fakeAppKit,
		}));

		const { walletConnect, resetAppKitCache } = await import("./plugin");
		const { getCachedObservable$, clearAllCachedObservables } = await import(
			"../../utils/getCachedObservable"
		);
		resetAppKitCache();
		clearAllCachedObservables();

		const emissions: (WalletConnectWallet | null)[] = [];
		const sub = walletConnect(options)
			.getWallet$(ctx)
			.subscribe((w) => emissions.push(w));
		// Keep the stream subscribed so the status pipeline (and its disconnect
		// cache-clearing) stays alive while we drive transitions.
		await vi.waitFor(() =>
			expect(emissions.at(-1)?.platforms).toContain("solana"),
		);

		const wallet = emissions.at(-1);
		expect(wallet?.isConnected).toBe(true);

		// Seed a cached account observable as the accounts layer would.
		const key = `accounts:${WALLET_CONNECT_WALLET_ID}:solana:solana:mainnet`;
		const original = { tag: "original" };
		expect(getCachedObservable$(key, () => original)).toBe(original);

		// disconnect() awaits the underlying AppKit disconnect.
		await wallet?.disconnect();
		expect(disconnect).toHaveBeenCalledTimes(1);
		// Cache is still present until the provider status actually flips.
		expect(getCachedObservable$(key, () => ({ tag: "stale" }))).toBe(original);

		// The provider going away flips the status to disconnected, which drops the
		// cached account observables — this also covers external disconnects, where
		// disconnect() is never called.
		emitProviders({});

		const fresh = { tag: "fresh" };
		expect(getCachedObservable$(key, () => fresh)).toBe(fresh);

		sub.unsubscribe();
		resetAppKitCache();
	});
});

describe("walletConnect().getWallet$ single-session connect model", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	// Fake AppKit whose connected namespaces the test drives via `emit`.
	const mockAppKit = (chainNamespaces: string[]) => {
		let emit: (p: Record<string, unknown>) => void = () => {};
		let providers: Record<string, unknown> = {};
		const fakeAppKit = {
			chainNamespaces,
			getUniversalProvider: () => Promise.resolve(undefined),
			getProvider: (namespace: string) => providers[namespace],
			subscribeProviders: (cb: (p: Record<string, unknown>) => void) => {
				emit = (next) => {
					providers = next;
					cb(next);
				};
				emit({}); // start fully disconnected
				return () => {};
			},
			getWalletInfo: () => undefined,
			open: vi.fn(() => Promise.resolve()),
			disconnect: vi.fn(() => Promise.resolve()),
		};
		vi.doMock("@reown/appkit/core", () => ({ createAppKit: () => fakeAppKit }));
		return { emit: (p: Record<string, unknown>) => emit(p) };
	};

	const subscribeConnector = async () => {
		const { walletConnect, resetAppKitCache } = await import("./plugin");
		resetAppKitCache();
		return { walletConnect, resetAppKitCache };
	};

	it("exposes a single disconnected connector (no platforms) while fully disconnected", async () => {
		vi.resetModules();
		mockAppKit(["polkadot", "eip155", "solana"]);
		const { walletConnect, resetAppKitCache } = await subscribeConnector();

		const emissions: (WalletConnectWallet | null)[] = [];
		const sub = walletConnect(options)
			.getWallet$(ctx)
			.subscribe((w) => emissions.push(w));
		await vi.waitFor(() => expect(emissions.length).toBeGreaterThan(0));

		const wallet = emissions.at(-1);
		expect(wallet?.type).toBe("walletconnect");
		expect(wallet?.id).toBe(WALLET_CONNECT_WALLET_ID);
		expect(wallet?.isConnected).toBe(false);
		expect(wallet?.platforms).toEqual([]);

		sub.unsubscribe();
		resetAppKitCache();
	});

	it("reports only the namespaces the wallet approved (no dead per-platform entries)", async () => {
		vi.resetModules();
		const { emit } = mockAppKit(["polkadot", "eip155", "solana"]);
		const { walletConnect, resetAppKitCache } = await subscribeConnector();

		const emissions: (WalletConnectWallet | null)[] = [];
		const sub = walletConnect(options)
			.getWallet$(ctx)
			.subscribe((w) => emissions.push(w));
		await vi.waitFor(() => expect(emissions.length).toBeGreaterThan(0));

		// Wallet approves only eip155 in the single pairing.
		emit({ eip155: providerWithSession("eip155") });
		await vi.waitFor(() => expect(emissions.at(-1)?.isConnected).toBe(true));

		const wallet = emissions.at(-1);
		expect(wallet?.platforms).toEqual(["ethereum"]);

		sub.unsubscribe();
		resetAppKitCache();
	});

	it("reports every namespace when the wallet approves all of them", async () => {
		vi.resetModules();
		const { emit } = mockAppKit(["polkadot", "eip155", "solana"]);
		const { walletConnect, resetAppKitCache } = await subscribeConnector();

		const emissions: (WalletConnectWallet | null)[] = [];
		const sub = walletConnect(options)
			.getWallet$(ctx)
			.subscribe((w) => emissions.push(w));
		await vi.waitFor(() => expect(emissions.length).toBeGreaterThan(0));

		emit({
			polkadot: providerWithSession("polkadot"),
			eip155: providerWithSession("eip155"),
			solana: providerWithSession("solana"),
		});
		await vi.waitFor(() => expect(emissions.at(-1)?.platforms).toHaveLength(3));

		const wallet = emissions.at(-1);
		expect(wallet?.platforms).toEqual(["polkadot", "ethereum", "solana"]);
		expect(wallet?.isConnected).toBe(true);

		sub.unsubscribe();
		resetAppKitCache();
	});

	it("only reports namespaces AppKit was configured for", async () => {
		vi.resetModules();
		// Only eip155 enabled; even if a provider for another namespace appears,
		// it's not in the connector's platforms.
		const { emit } = mockAppKit(["eip155"]);
		const { walletConnect, resetAppKitCache } = await subscribeConnector();

		const emissions: (WalletConnectWallet | null)[] = [];
		const sub = walletConnect(options)
			.getWallet$(ctx)
			.subscribe((w) => emissions.push(w));
		await vi.waitFor(() => expect(emissions.length).toBeGreaterThan(0));

		emit({
			eip155: providerWithSession("eip155"),
			polkadot: providerWithSession("polkadot"),
		});
		await vi.waitFor(() => expect(emissions.at(-1)?.isConnected).toBe(true));

		const wallet = emissions.at(-1);
		expect(wallet?.platforms).toEqual(["ethereum"]);

		sub.unsubscribe();
		resetAppKitCache();
	});

	it("leaves out a namespace whose provider is still registered when the session doesn't carry it", async () => {
		vi.resetModules();
		const { emit } = mockAppKit(["polkadot", "eip155"]);
		const { walletConnect, resetAppKitCache } = await subscribeConnector();

		const emissions: (WalletConnectWallet | null)[] = [];
		const sub = walletConnect(options)
			.getWallet$(ctx)
			.subscribe((w) => emissions.push(w));
		await vi.waitFor(() => expect(emissions.length).toBeGreaterThan(0));

		const ethereumOnlySession = providerWithSession("eip155");
		emit({ polkadot: ethereumOnlySession, eip155: ethereumOnlySession });
		await vi.waitFor(() => expect(emissions.at(-1)?.isConnected).toBe(true));

		expect(emissions.at(-1)?.platforms).toEqual(["ethereum"]);

		sub.unsubscribe();
		resetAppKitCache();
	});
});

describe("walletConnect().getWallet$ single AppKit instance", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	const makeCreateAppKit = () =>
		vi.fn(() => ({
			chainNamespaces: ["eip155"],
			getUniversalProvider: () => Promise.resolve(undefined),
			getProvider: () => undefined,
			subscribeProviders: (cb: (p: Record<string, unknown>) => void) => {
				cb({});
				return () => {};
			},
			getWalletInfo: () => undefined,
			open: vi.fn(() => Promise.resolve()),
			disconnect: vi.fn(() => Promise.resolve()),
		}));

	it("creates the AppKit instance at most once across teardown and re-subscribe", async () => {
		vi.resetModules();
		const createAppKit = makeCreateAppKit();
		vi.doMock("@reown/appkit/core", () => ({ createAppKit }));

		const { walletConnect, resetAppKitCache } = await import("./plugin");
		resetAppKitCache();

		// First subscriber, then fully unsubscribe (drains refCount to 0).
		const sub1 = walletConnect(options).getWallet$(ctx).subscribe();
		await vi.waitFor(() => expect(createAppKit).toHaveBeenCalledTimes(1));
		sub1.unsubscribe();

		// Re-subscribe after the previous subscriber drained — must reuse the
		// existing AppKit instance, not create a second one.
		const sub2 = walletConnect(options).getWallet$(ctx).subscribe();
		await new Promise((r) => setTimeout(r, 10));
		expect(createAppKit).toHaveBeenCalledTimes(1);

		sub2.unsubscribe();
		resetAppKitCache();
	});

	it("warns when re-initialised with a different projectId", async () => {
		vi.resetModules();
		const createAppKit = makeCreateAppKit();
		vi.doMock("@reown/appkit/core", () => ({ createAppKit }));

		const { walletConnect, resetAppKitCache } = await import("./plugin");
		resetAppKitCache();
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const sub = walletConnect(options).getWallet$(ctx).subscribe();
		walletConnect({ ...options, projectId: "different" }).getWallet$(ctx);

		expect(warnSpy).toHaveBeenCalledWith(
			expect.stringContaining("already initialised with projectId"),
			expect.anything(),
			expect.anything(),
		);

		sub.unsubscribe();
		resetAppKitCache();
	});
});

describe("walletConnect() provider subscription lifetime through kheopskitRun$", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
		localStorage.clear();
		clearAllCachedObservables();
	});

	const mockAppKit = () => {
		const listeners = new Set<(p: Record<string, unknown>) => void>();
		let providers: Record<string, unknown> = {};
		let walletInfo: { name: string; icon: string } | undefined;
		const universalProvider = sessionProvider();
		const grantSession = (provider: SessionProvider, address: string) => {
			provider.session = {
				topic: address,
				namespaces: {
					polkadot: {
						accounts: [`polkadot:91b171bb158e2d3848fa23a9f1c25182:${address}`],
					},
				},
			};
		};
		const createAppKit = vi.fn(() => ({
			chainNamespaces: ["polkadot"],
			getUniversalProvider: () => Promise.resolve(universalProvider),
			getProvider: (namespace: string) => providers[namespace],
			subscribeProviders: (cb: (p: Record<string, unknown>) => void) => {
				listeners.add(cb);
				return () => {
					listeners.delete(cb);
				};
			},
			getWalletInfo: () => walletInfo,
			open: vi.fn(() => Promise.resolve()),
			disconnect: vi.fn(() => Promise.resolve()),
		}));
		vi.doMock("@reown/appkit/core", () => ({ createAppKit }));
		const setProviders = (
			next: Record<string, unknown>,
			nextWalletInfo?: { name: string; icon: string },
		) => {
			providers = next;
			walletInfo = nextWalletInfo;
			for (const listener of listeners) listener(providers);
		};
		return {
			createAppKit,
			listeners,
			setProviders,
			universalProvider,
			pair: (
				provider: SessionProvider,
				address: string,
				walletName: string,
			) => {
				grantSession(provider, address);
				setProviders({ polkadot: provider }, { name: walletName, icon: "" });
			},
			disconnect: (provider: SessionProvider) => {
				provider.session = undefined;
				setProviders({});
			},
			// AppKit 1.8.24 keeps the provider registered when the wallet deletes
			// the session, so its providers listeners hear nothing.
			endSessionFromWallet: (provider: SessionProvider) => {
				const topic = provider.session?.topic;
				provider.session = undefined;
				provider.emit("session_delete", { topic });
			},
			// Re-registering the same provider object doesn't notify AppKit's
			// providers listeners either.
			pairAgain: (
				provider: SessionProvider,
				address: string,
				walletName: string,
			) => {
				grantSession(provider, address);
				walletInfo = { name: walletName, icon: "" };
				provider.emit("connect", { session: provider.session });
			},
		};
	};

	const sessionProvider = () => {
		const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
		return {
			session: undefined as
				| { topic: string; namespaces: Record<string, { accounts: string[] }> }
				| undefined,
			on: (event: string, listener: (...args: unknown[]) => void) => {
				listeners.set(event, (listeners.get(event) ?? new Set()).add(listener));
			},
			off: (event: string, listener: (...args: unknown[]) => void) => {
				listeners.get(event)?.delete(listener);
			},
			emit: (event: string, ...args: unknown[]) => {
				for (const listener of listeners.get(event) ?? []) listener(...args);
			},
			listenerCount: () =>
				[...listeners.values()].reduce((count, set) => count + set.size, 0),
			client: { request: vi.fn() },
		};
	};
	type SessionProvider = ReturnType<typeof sessionProvider>;

	const fakePlatform: KheopskitPlatform = {
		platform: "polkadot",
		getWallets$: () => of([]),
		getAccounts$: () => of([]),
	};

	const observe = async (platform = fakePlatform) => {
		const { kheopskitRun$ } = await import("../kheopskit");
		const { createKheopskitStore } = await import("../store");
		const { walletConnect, resetAppKitCache } = await import("./plugin");
		resetAppKitCache();
		const connector = (state: KheopskitState | undefined) =>
			state?.wallets.find((w) => w.id === WALLET_CONNECT_WALLET_ID) as
				| WalletConnectWallet
				| undefined;
		const mount = () => {
			const states: KheopskitState[] = [];
			const sub = kheopskitRun$(
				{ platforms: [platform], walletConnect: walletConnect(options) },
				{ store: createKheopskitStore() },
			).subscribe((s) => states.push(s));
			const accounts = () =>
				states.at(-1)?.accounts.map(({ address, walletName, name }) => ({
					address,
					walletName,
					name,
				}));
			return { sub, current: () => connector(states.at(-1)), accounts };
		};
		return { mount, resetAppKitCache };
	};

	it("releases every provider subscription when the last subscriber leaves", async () => {
		vi.resetModules();
		const appKit = mockAppKit();
		const { mount, resetAppKitCache } = await observe();

		const { sub, current } = mount();
		await vi.waitFor(() => expect(current()?.status).toBe("disconnected"));
		expect(appKit.listeners.size).toBe(1);
		await vi.waitFor(() =>
			expect(appKit.universalProvider.listenerCount()).toBeGreaterThan(0),
		);

		sub.unsubscribe();
		expect(appKit.listeners.size).toBe(0);
		expect(appKit.universalProvider.listenerCount()).toBe(0);

		resetAppKitCache();
	});

	it("reuses the AppKit instance on remount and shows a connection made while unobserved", async () => {
		vi.resetModules();
		const appKit = mockAppKit();
		const { mount, resetAppKitCache } = await observe();

		const first = mount();
		await vi.waitFor(() =>
			expect(first.current()?.status).toBe("disconnected"),
		);
		first.sub.unsubscribe();

		appKit.setProviders({ polkadot: providerWithSession("polkadot") });

		const second = mount();
		await vi.waitFor(() => expect(second.current()?.status).toBe("connected"));
		expect(second.current()?.platforms).toEqual(["polkadot"]);
		expect(appKit.createAppKit).toHaveBeenCalledTimes(1);
		expect(appKit.listeners.size).toBe(1);

		second.sub.unsubscribe();
		resetAppKitCache();
	});

	it("keeps the WalletConnect name and icon when the paired wallet reports empty metadata", async () => {
		vi.resetModules();
		const appKit = mockAppKit();
		const { mount, resetAppKitCache } = await observe();

		const { sub, current } = mount();
		await vi.waitFor(() => expect(current()?.status).toBe("disconnected"));
		const walletConnectIcon = current()?.icon;
		expect(walletConnectIcon).toMatch(/^data:image\//);

		appKit.setProviders(
			{ polkadot: providerWithSession("polkadot") },
			{ name: "", icon: "" },
		);
		await vi.waitFor(() => expect(current()?.status).toBe("connected"));
		expect(current()).toMatchObject({
			name: "WalletConnect",
			icon: walletConnectIcon,
		});

		sub.unsubscribe();
		resetAppKitCache();
	});

	it.each([
		[
			"one provider object across sessions, as AppKit 1.8.24",
			(a: SessionProvider) => a,
		],
		["one provider object per session", () => sessionProvider()],
	])(
		"shows the new session's accounts under its wallet name after a swap while unobserved (%s)",
		async (_shape, providerForB) => {
			vi.resetModules();
			const appKit = mockAppKit();
			const { polkadot } = await import("../polkadot/plugin");
			const { mount, resetAppKitCache } = await observe({
				...polkadot(),
				getWallets$: () => of([]),
			});
			const providerA = sessionProvider();
			const providerB = providerForB(providerA);

			const first = mount();
			await vi.waitFor(() =>
				expect(first.current()?.status).toBe("disconnected"),
			);
			appKit.pair(providerA, ADDRESS_A, "Nova");
			await vi.waitFor(() =>
				expect(first.accounts()).toEqual([
					{ address: ADDRESS_A, walletName: "Nova", name: "Nova Polkadot" },
				]),
			);
			first.sub.unsubscribe();

			appKit.disconnect(providerA);
			appKit.pair(providerB, ADDRESS_B, "SubWallet");

			const second = mount();
			await vi.waitFor(() =>
				expect(second.accounts()).toEqual([
					{
						address: ADDRESS_B,
						walletName: "SubWallet",
						name: "SubWallet Polkadot",
					},
				]),
			);

			second.sub.unsubscribe();
			resetAppKitCache();
		},
	);

	it("shows the connector disconnected without accounts when the wallet ends the session, and connected again when it pairs again", async () => {
		vi.resetModules();
		const appKit = mockAppKit();
		const { polkadot } = await import("../polkadot/plugin");
		const { mount, resetAppKitCache } = await observe({
			...polkadot(),
			getWallets$: () => of([]),
		});
		const provider = appKit.universalProvider;

		const { sub, current, accounts } = mount();
		await vi.waitFor(() => expect(current()?.status).toBe("disconnected"));
		appKit.pair(provider, ADDRESS_A, "Nova");
		await vi.waitFor(() =>
			expect(accounts()).toEqual([
				{ address: ADDRESS_A, walletName: "Nova", name: "Nova Polkadot" },
			]),
		);

		appKit.endSessionFromWallet(provider);
		await vi.waitFor(() => expect(current()?.status).toBe("disconnected"));
		expect(current()?.platforms).toEqual([]);
		expect(accounts()).toEqual([]);

		appKit.pairAgain(provider, ADDRESS_B, "SubWallet");
		await vi.waitFor(() =>
			expect(accounts()).toEqual([
				{
					address: ADDRESS_B,
					walletName: "SubWallet",
					name: "SubWallet Polkadot",
				},
			]),
		);
		expect(current()?.status).toBe("connected");

		sub.unsubscribe();
		resetAppKitCache();
	});
});

describe("walletConnect() appKitOptions", () => {
	afterEach(() => {
		vi.resetModules();
		vi.restoreAllMocks();
	});

	const captureAppKitOptions = async (
		walletConnectOptions: WalletConnectOptions,
	) => {
		vi.resetModules();
		const createAppKit = vi.fn((_options: Record<string, unknown>) => ({
			chainNamespaces: ["eip155"],
			getUniversalProvider: () => Promise.resolve(undefined),
			getProvider: () => undefined,
			subscribeProviders: (cb: (p: Record<string, unknown>) => void) => {
				cb({});
				return () => {};
			},
			getWalletInfo: () => undefined,
			open: vi.fn(() => Promise.resolve()),
			disconnect: vi.fn(() => Promise.resolve()),
		}));
		vi.doMock("@reown/appkit/core", () => ({ createAppKit }));

		const { walletConnect, resetAppKitCache } = await import("./plugin");
		resetAppKitCache();

		const sub = walletConnect(walletConnectOptions).getWallet$(ctx).subscribe();
		await vi.waitFor(() => expect(createAppKit).toHaveBeenCalledTimes(1));
		sub.unsubscribe();
		resetAppKitCache();

		return createAppKit.mock.calls[0]?.[0];
	};

	it("forwards app options to AppKit while kheopskit keeps the keys it owns", async () => {
		const untypedAppKitOptions: Record<string, unknown> = {
			featuredWalletIds: ["wallet-a", "wallet-b"],
			features: { analytics: false },
			allWallets: "SHOW",
			projectId: "injected",
			universalProviderConfigOverride: {
				methods: { polkadot: ["polkadot_injected"] },
			},
		};

		const appKitOptions = await captureAppKitOptions({
			...options,
			networks: [{ chainNamespace: "polkadot" }, { chainNamespace: "solana" }],
			appKitOptions: untypedAppKitOptions,
		});

		expect(appKitOptions?.featuredWalletIds).toEqual(["wallet-a", "wallet-b"]);
		expect(appKitOptions?.features).toEqual({ analytics: false });
		expect(appKitOptions?.allWallets).toBe("SHOW");
		expect(appKitOptions?.projectId).toBe(options.projectId);
		expect(appKitOptions?.universalProviderConfigOverride).toEqual({
			methods: {
				polkadot: ["polkadot_signTransaction", "polkadot_signMessage"],
				solana: [
					"solana_signTransaction",
					"solana_signMessage",
					"solana_signAndSendTransaction",
				],
			},
		});
	});

	it("overrides methods only for the namespaces of the configured networks", async () => {
		const appKitOptions = await captureAppKitOptions({
			...options,
			networks: [
				{ chainNamespace: "polkadot" },
				{ chainNamespace: "polkadot" },
				{ chainNamespace: "eip155" },
			],
		});

		expect(appKitOptions?.universalProviderConfigOverride).toEqual({
			methods: {
				polkadot: ["polkadot_signTransaction", "polkadot_signMessage"],
			},
		});
	});

	it("rejects the keys kheopskit owns at compile time", () => {
		const accept = (appKitOptions: WalletConnectOptions["appKitOptions"]) =>
			appKitOptions;
		// @ts-expect-error kheopskit owns projectId
		accept({ projectId: "other" });
		// @ts-expect-error kheopskit owns networks
		accept({ networks: [] });
		expect(accept({ featuredWalletIds: ["wallet-a"] })).toBeDefined();
	});

	it("hides the all-wallets list when the app sets no options", async () => {
		const appKitOptions = await captureAppKitOptions(options);

		expect(appKitOptions?.allWallets).toBe("HIDE");
	});
});

describe("walletConnect()", () => {
	it("exposes the dapp metadata it was created with", async () => {
		const { walletConnect } = await import("./plugin");

		const plugin = walletConnect(options);

		expect(plugin.type).toBe("walletconnect");
		expect(plugin.metadata).toBe(options.metadata);
	});
});
