import { getWallets } from "@wallet-standard/app";
import type { Wallet as WalletStandardWallet } from "@wallet-standard/base";
import { announceProvider, type EIP6963ProviderDetail } from "mipd";
import type { Subscription } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakePolkadotExtension, createMemoryStorage } from "../testing";
import { clearAllCachedObservables } from "../utils/getCachedObservable";
import type { SyncableStorage } from "../utils/storage";
import { ethereum } from "./ethereum/plugin";
import { kheopskitRun$ } from "./kheopskit";
import { polkadot } from "./polkadot/plugin";
import { solana } from "./solana/plugin";
import { createKheopskitStore, type KheopskitStore } from "./store";
import type { KheopskitPlatform, KheopskitState } from "./types";

const DOT_ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const DOT_BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";
const ETH_ALICE = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
const ETH_BOB = "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359";
const SOL_ALICE = "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV";
const SOL_BOB = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

const NAMES: Record<string, string> = {
	[DOT_ALICE]: "Alice",
	[DOT_BOB]: "Bob",
	[ETH_ALICE]: "Alice",
	[ETH_BOB]: "Bob",
	[SOL_ALICE]: "Alice",
	[SOL_BOB]: "Bob",
};

const PROVIDER_EVENT_GAP_MS = 10;

const betweenProviderEvents = () =>
	vi.advanceTimersByTimeAsync(PROVIDER_EVENT_GAP_MS);

type Listener = (...args: unknown[]) => void;

type FakeWallet = {
	platform: KheopskitPlatform;
	/** The wallet's accounts once `changeAccounts` ran, as `frameOf` labels them. */
	changedAccounts: string[];
	changeAccounts: () => void;
	/** The provider events of Talisman's "Disconnect All". */
	disconnectAll: () => Promise<void>;
	/** The provider events of Talisman's "Connect All" after a "Disconnect All". */
	connectAll: () => Promise<void>;
	uninstall: () => void;
};

const installPolkadotWallet = (): FakeWallet => {
	const alice = { address: DOT_ALICE, name: "Alice", type: "sr25519" as const };
	const bob = { address: DOT_BOB, name: "Bob", type: "sr25519" as const };
	const extension = createFakePolkadotExtension({
		name: "talisman",
		accounts: [alice],
	});
	return {
		platform: polkadot(),
		changedAccounts: ["Alice", "Bob"],
		changeAccounts: () => extension.setAccounts([alice, bob]),
		disconnectAll: async () => extension.setAccounts([]),
		connectAll: async () => extension.setAccounts([alice]),
		uninstall: extension.uninstall,
	};
};

const installEthereumWallet = (): FakeWallet & { switchChain: () => void } => {
	let authorized: string[] = [];
	let chainId = "0x1";
	const listeners = new Map<string, Set<Listener>>();
	const emit = (event: string, ...args: unknown[]) => {
		for (const listener of listeners.get(event) ?? []) listener(...args);
	};
	const provider = {
		request: async ({ method }: { method: string }) => {
			if (method === "eth_requestAccounts") authorized = [ETH_ALICE];
			if (method === "eth_requestAccounts" || method === "eth_accounts")
				return authorized;
			if (method === "eth_chainId") return chainId;
			throw new Error(`unexpected request ${method}`);
		},
		on: (event: string, listener: Listener) => {
			const set = listeners.get(event) ?? new Set<Listener>();
			set.add(listener);
			listeners.set(event, set);
		},
		removeListener: (event: string, listener: Listener) => {
			listeners.get(event)?.delete(listener);
		},
	};
	const unannounce = announceProvider({
		info: {
			uuid: "00000000-0000-4000-8000-000000000001",
			name: "Talisman",
			icon: "data:image/svg+xml,",
			rdns: "xyz.talisman",
		},
		provider: provider as unknown as EIP6963ProviderDetail["provider"],
	});
	return {
		platform: ethereum(),
		changedAccounts: ["Bob @1"],
		changeAccounts: () => {
			authorized = [ETH_BOB];
			emit("accountsChanged", authorized);
		},
		switchChain: () => {
			chainId = "0x89";
			emit("chainChanged", chainId);
		},
		disconnectAll: async () => {
			authorized = [];
			emit("accountsChanged", authorized);
			await betweenProviderEvents();
			emit("disconnect", { code: 4901, message: "Disconnected" });
		},
		connectAll: async () => {
			authorized = [ETH_ALICE];
			emit("connect", { chainId });
			await betweenProviderEvents();
			emit("accountsChanged", authorized);
		},
		uninstall: unannounce,
	};
};

const installSolanaWallet = (): FakeWallet => {
	const account = (address: string) => ({
		address,
		publicKey: new Uint8Array(32),
		chains: ["solana:mainnet"],
		features: [],
		label: NAMES[address],
	});
	let authorized: ReturnType<typeof account>[] = [];
	const listeners = new Set<Listener>();
	const authorize = (addresses: string[]) => {
		authorized = addresses.map(account);
		for (const listener of listeners) listener({ accounts: authorized });
	};
	const wallet = {
		version: "1.0.0",
		name: "Talisman",
		icon: "data:image/svg+xml;base64,AAAA",
		chains: ["solana:mainnet"],
		get accounts() {
			return authorized;
		},
		features: {
			"standard:connect": {
				version: "1.0.0",
				connect: async () => {
					authorized = [account(SOL_ALICE)];
					return { accounts: authorized };
				},
			},
			"standard:disconnect": {
				version: "1.0.0",
				disconnect: async () => {
					authorized = [];
				},
			},
			"standard:events": {
				version: "1.0.0",
				on: (_event: string, listener: Listener) => {
					listeners.add(listener);
					return () => listeners.delete(listener);
				},
			},
		},
	};
	const unregister = getWallets().register(
		wallet as unknown as WalletStandardWallet,
	);
	return {
		platform: solana(),
		changedAccounts: ["Alice", "Bob"],
		changeAccounts: () => authorize([SOL_ALICE, SOL_BOB]),
		disconnectAll: async () => authorize([]),
		connectAll: async () => authorize([SOL_ALICE]),
		uninstall: unregister,
	};
};

type Frame = {
	isDiscovering?: true;
	isHydrating?: true;
	wallets: string[];
	accounts: string[];
};

const cachedSuffix = (item: { isPlaceholder?: boolean }) =>
	item.isPlaceholder ? " (cached)" : "";

const frameOf = (state: KheopskitState): Frame => ({
	...(state.isDiscovering && { isDiscovering: true }),
	...(state.isHydrating && { isHydrating: true }),
	wallets: state.wallets.map((w) => `${w.status}${cachedSuffix(w)}`),
	accounts: state.accounts.map((a) => {
		const { chainId } = a as { chainId?: number };
		const chain = chainId === undefined ? "" : ` @${chainId}`;
		return `${NAMES[a.address] ?? a.address}${chain}${cachedSuffix(a)}`;
	}),
});

let storage: Required<SyncableStorage>;
let store: KheopskitStore | undefined;
let subscription: Subscription | undefined;
let frames: Frame[];
let latest: KheopskitState | undefined;
let installed: FakeWallet | undefined;

const loadPage = (wallet: FakeWallet) => {
	store = createKheopskitStore({ storage });
	frames = [];
	subscription = kheopskitRun$(
		{ platforms: [wallet.platform] },
		{ store },
	).subscribe((state) => {
		latest = state;
		frames.push(frameOf(state));
	});
};

const closePage = () => {
	subscription?.unsubscribe();
	subscription = undefined;
	store?.destroy();
	store = undefined;
	clearAllCachedObservables();
};

const settle = () => vi.advanceTimersByTimeAsync(5000);

const framesDuring = async (act: () => unknown) => {
	await settle();
	const from = frames.length;
	await act();
	await settle();
	return frames.slice(from);
};

const listedWallet = () => {
	const wallet = latest?.wallets[0];
	if (!wallet) throw new Error("no wallet listed");
	return wallet;
};

const connectedPage = async (wallet: FakeWallet) => {
	loadPage(wallet);
	await settle();
	await listedWallet().connect();
	await settle();
};

beforeEach(() => {
	vi.useFakeTimers();
	storage = createMemoryStorage();
});

afterEach(() => {
	closePage();
	installed?.uninstall();
	installed = undefined;
	vi.useRealTimers();
});

describe.each([
	{ name: "Polkadot", install: installPolkadotWallet, alice: "Alice" },
	{ name: "Ethereum", install: installEthereumWallet, alice: "Alice @1" },
	{ name: "Solana", install: installSolanaWallet, alice: "Alice" },
])("kheopskit$ emissions on $name", ({ install, alice }) => {
	const installWallet = () => {
		installed = install();
		return installed;
	};

	it("discovery lists the installed wallet, then ends", async () => {
		loadPage(installWallet());
		await settle();

		expect(frames).toEqual([
			{ isDiscovering: true, wallets: ["disconnected"], accounts: [] },
			{ wallets: ["disconnected"], accounts: [] },
		]);
	});

	it("connect shows the wallet connecting, then connected with its accounts", async () => {
		loadPage(installWallet());

		expect(await framesDuring(() => listedWallet().connect())).toEqual([
			{ wallets: ["connecting"], accounts: [] },
			{ wallets: ["connected"], accounts: [alice] },
		]);
	});

	it("disconnect shows the wallet disconnected without accounts", async () => {
		await connectedPage(installWallet());

		expect(await framesDuring(() => listedWallet().disconnect())).toEqual([
			{ wallets: ["disconnected"], accounts: [] },
		]);
	});

	it("an account change in the wallet emits the new account list once", async () => {
		const wallet = installWallet();
		await connectedPage(wallet);

		expect(await framesDuring(wallet.changeAccounts)).toEqual([
			{ wallets: ["connected"], accounts: wallet.changedAccounts },
		]);
	});

	it("a wallet-side disconnect then reconnect emits the empty list, then the accounts", async () => {
		const wallet = installWallet();
		await connectedPage(wallet);

		expect(await framesDuring(wallet.disconnectAll)).toEqual([
			{ wallets: ["connected"], accounts: [] },
		]);
		expect(await framesDuring(wallet.connectAll)).toEqual([
			{ wallets: ["connected"], accounts: [alice] },
		]);
	});

	it("a reload shows the cached wallet and accounts, swaps in the live ones, then ends hydration and discovery", async () => {
		const wallet = installWallet();
		await connectedPage(wallet);
		closePage();

		loadPage(wallet);
		await settle();

		expect(frames).toEqual([
			{
				isDiscovering: true,
				isHydrating: true,
				wallets: ["connecting"],
				accounts: [`${alice} (cached)`],
			},
			{
				isDiscovering: true,
				isHydrating: true,
				wallets: ["connected"],
				accounts: [alice],
			},
			{ isDiscovering: true, wallets: ["connected"], accounts: [alice] },
			{ wallets: ["connected"], accounts: [alice] },
		]);
	});
});

it("an Ethereum chain change emits the accounts on the new chain once", async () => {
	const wallet = installEthereumWallet();
	installed = wallet;
	await connectedPage(wallet);

	expect(await framesDuring(wallet.switchChain)).toEqual([
		{ wallets: ["connected"], accounts: ["Alice @137"] },
	]);
});
