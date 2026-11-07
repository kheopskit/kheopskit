import { getWallets } from "@wallet-standard/app";
import type { Wallet as WalletStandardWallet } from "@wallet-standard/base";
import { announceProvider, type EIP6963ProviderDetail } from "mipd";
import type { PolkadotInjected } from "../polkadot/types";
import type { WalletPlatform } from "../types";

export type Person = "Alice" | "Bob";

const ADDRESSES: Record<WalletPlatform, Record<Person, string>> = {
	polkadot: {
		Alice: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
		Bob: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
	},
	ethereum: {
		Alice: "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed",
		Bob: "0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359",
	},
	solana: {
		Alice: "7EcDhSYGxXyscszYEp35KHN8vvw3svAuLKTzXwCFLtV",
		Bob: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
	},
};

export const personOf = (address: string): string =>
	Object.values(ADDRESSES)
		.flatMap((byPerson) => Object.entries(byPerson))
		.find(([, candidate]) => candidate === address)?.[0] ?? address;

/**
 * How the wallet's answers and events reach the page, in the order the wallet
 * sent them: at once, in a microtask, or each in its own task after
 * `latencyMs`, as an extension's `postMessage` transport delivers them.
 */
export type Delivery = "sync" | "microtask" | { latencyMs: number };

const createChannel = (delivery: Delivery) => {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(message: () => T | Promise<T>): Promise<T> => {
		if (delivery === "sync")
			return new Promise<T>((resolve) => resolve(message()));
		const delivered =
			delivery === "microtask"
				? tail.then(message)
				: tail
						.then(
							() =>
								new Promise((resolve) =>
									setTimeout(resolve, delivery.latencyMs),
								),
						)
						.then(message);
		tail = delivered.catch(() => {});
		return delivered;
	};
};

type PromptAnswer = "approve" | "refuse" | "hold";

type SiteAccess = "new" | "authorized" | "revoked";

const createPrompts = () => {
	let answer: PromptAnswer = "approve";
	let shown = 0;
	const held: ((answer: "approve" | "refuse") => void)[] = [];
	return {
		answerWith: (next: PromptAnswer) => {
			answer = next;
		},
		release: (next: "approve" | "refuse") => {
			answer = next;
			for (const settle of held.splice(0)) settle(next);
		},
		ask: (): Promise<"approve" | "refuse"> => {
			shown++;
			return answer === "hold"
				? new Promise((resolve) => held.push(resolve))
				: Promise.resolve(answer);
		},
		pending: () => held.length,
		shown: () => shown,
	};
};

export type FakeWallet = {
	/** The wallet's label in a `Frame`: its name, a slash, its platform. */
	label: string;
	/** The user switches the accounts this site sees, in the wallet. */
	setAccounts: (people: Person[]) => void;
	/** The user removes this site's accounts in the wallet, as Talisman's "Disconnect All" does. */
	disconnectAll: () => void;
	/** The user gives this site its accounts back in the wallet, as Talisman's "Connect All" does. */
	connectAll: () => void;
	/** How the user answers the wallet's next connect prompts. */
	answerPrompts: (answer: PromptAnswer) => void;
	/** The user answers the prompts left open by `answerPrompts("hold")`. */
	releasePrompts: (answer: "approve" | "refuse") => void;
	/** Connect prompts the wallet shows and the user has not answered yet. */
	openPrompts: () => number;
	/** Connect prompts the wallet has shown since it was installed. */
	promptsShown: () => number;
	uninstall: () => void;
};

const installed = new Set<FakeWallet>();

const track = <W extends FakeWallet>(wallet: W): W => {
	installed.add(wallet);
	const uninstall = wallet.uninstall;
	wallet.uninstall = () => {
		installed.delete(wallet);
		uninstall();
	};
	return wallet;
};

export const uninstallAll = () => {
	for (const wallet of [...installed]) wallet.uninstall();
};

type Identity = { name: string; accounts?: Person[] };

export type PolkadotBehavior = {
	delivery: Delivery;
	/** How a refused prompt reaches the site. */
	refusal: { enableRejects: string } | { accountsGetRejects: string };
	/** What `enable()` does for a site the user revoked in the wallet. */
	revoked: "prompt" | "grants no account" | { enableRejects: string };
	/** Whether `accounts.subscribe` calls back before it returns. */
	firstListCallback: "before subscribe returns" | "delivered later";
};

export const POLKADOT_BASELINE: PolkadotBehavior = {
	delivery: { latencyMs: 0 },
	refusal: { enableRejects: "Rejected" },
	revoked: "prompt",
	firstListCallback: "delivered later",
};

type InjectedWeb3Global = { injectedWeb3?: Record<string, unknown> };

export const installPolkadotWallet = (
	{ name, accounts = ["Alice"] }: Identity,
	behavior: PolkadotBehavior = POLKADOT_BASELINE,
	key = name,
): FakeWallet => {
	const toAccount = (person: Person) => ({
		address: ADDRESSES.polkadot[person],
		name: person,
		type: "sr25519" as const,
	});
	const deliver = createChannel(behavior.delivery);
	const prompts = createPrompts();
	const { refusal, revoked } = behavior;
	let access: SiteAccess = "new";
	let granted = accounts;
	const listeners = new Set<(list: ReturnType<typeof toAccount>[]) => void>();
	const visible = () => (access === "authorized" ? granted.map(toAccount) : []);
	const notify = () => {
		const list = visible();
		for (const listener of listeners) void deliver(() => listener(list));
	};
	const signature = `0x${"01".repeat(64)}` as const;
	const injected = (refused: boolean): PolkadotInjected => ({
		accounts: {
			get: () =>
				deliver(() => {
					if (refused && "accountsGetRejects" in refusal)
						throw new Error(refusal.accountsGetRejects);
					return visible();
				}),
			subscribe: (listener) => {
				listeners.add(listener);
				const list = visible();
				if (behavior.firstListCallback === "before subscribe returns")
					listener(list);
				else void deliver(() => listener(list));
				return () => {
					listeners.delete(listener);
				};
			},
		},
		signer: {
			signPayload: async () => ({ id: 1, signature }),
			signRaw: async () => ({ id: 1, signature }),
		},
	});
	const enable = async () => {
		if (access === "revoked" && revoked !== "prompt")
			return deliver(() => {
				if (revoked !== "grants no account")
					throw new Error(revoked.enableRejects);
				return injected(false);
			});
		if (access === "authorized") return deliver(() => injected(false));
		if ((await prompts.ask()) === "approve") {
			access = "authorized";
			granted = accounts;
			return deliver(() => injected(false));
		}
		if ("accountsGetRejects" in refusal) return deliver(() => injected(true));
		return deliver(() => {
			throw new Error(refusal.enableRejects);
		});
	};
	const entry = { version: "1.0.0", enable };
	const global = globalThis as InjectedWeb3Global;
	global.injectedWeb3 ??= {};
	global.injectedWeb3[key] = entry;
	return track({
		label: `${name}/polkadot`,
		setAccounts: (people) => {
			granted = people;
			notify();
		},
		disconnectAll: () => {
			access = "revoked";
			notify();
		},
		connectAll: () => {
			access = "authorized";
			granted = accounts;
			notify();
		},
		answerPrompts: prompts.answerWith,
		releasePrompts: prompts.release,
		openPrompts: prompts.pending,
		promptsShown: prompts.shown,
		uninstall: () => {
			const registry = global.injectedWeb3;
			if (registry?.[key] !== entry) return;
			delete registry[key];
			if (!Object.keys(registry).length) delete global.injectedWeb3;
		},
	});
};

type Listener = (...args: unknown[]) => void;

type EthereumEvent = "accountsChanged" | "connect" | "disconnect";

type EthereumError = { code?: number; message: string };

export type EthereumBehavior = {
	delivery: Delivery;
	/** How `eth_requestAccounts` rejects when the user refuses its prompt. */
	refusal: EthereumError;
	/** What `eth_requestAccounts` does for a site the user revoked in the wallet. */
	revoked: "prompt" | "answers no account" | EthereumError;
	/** The events, in order, when the user removes the site's accounts. */
	disconnectAllEvents: EthereumEvent[];
	/** The events, in order, when the user gives the site its accounts back. */
	connectAllEvents: EthereumEvent[];
	/** The events, in order, after the user approves a connect prompt. */
	approvalEvents: EthereumEvent[];
	/** The provider emits `accountsChanged` itself when an accounts answer differs from the last list it saw, and drops repeats. */
	accountsChangedFromAnswers: boolean;
	/** The provider asks its background to authorize the site before it reads the accounts. */
	authorizesBeforeAccounts: boolean;
};

export const ETHEREUM_BASELINE: EthereumBehavior = {
	delivery: { latencyMs: 0 },
	refusal: { code: 4001, message: "User rejected the request." },
	revoked: "prompt",
	disconnectAllEvents: ["accountsChanged"],
	connectAllEvents: ["accountsChanged"],
	approvalEvents: ["accountsChanged"],
	accountsChangedFromAnswers: false,
	authorizesBeforeAccounts: false,
};

export type FakeEthereumWallet = FakeWallet & {
	/** The user switches the wallet to another chain. */
	switchChain: (chainId: `0x${string}`) => void;
	/**
	 * The wallet reads the chain for the next `eth_chainId`, then waits until
	 * `answerChainRead()` before answering with it, as SubWallet does while it
	 * reconnects its RPC.
	 */
	stallChainRead: () => void;
	answerChainRead: () => void;
};

let announcements = 0;

export const installEthereumWallet = (
	{ name, accounts = ["Alice"] }: Identity,
	behavior: EthereumBehavior = ETHEREUM_BASELINE,
	rdns = `test.${name.toLowerCase()}`,
): FakeEthereumWallet => {
	const deliver = createChannel(behavior.delivery);
	const prompts = createPrompts();
	let access: SiteAccess = "new";
	let granted = accounts;
	let chainId = "0x1";
	let stalledChainRead: (() => void) | undefined;
	let lastSeen: string[] = [];
	const listeners = new Map<string, Set<Listener>>();
	const visible = () =>
		access === "authorized"
			? granted.map((person) => ADDRESSES.ethereum[person])
			: [];
	const emitNow = (event: string, ...args: unknown[]) => {
		if (event === "accountsChanged") {
			const addresses = args[0] as string[];
			if (
				behavior.accountsChangedFromAnswers &&
				addresses.join() === lastSeen.join()
			)
				return;
			lastSeen = addresses;
		}
		for (const listener of listeners.get(event) ?? []) listener(...args);
	};
	const argsOf = (event: EthereumEvent) =>
		event === "accountsChanged"
			? [visible()]
			: event === "connect"
				? [{ chainId }]
				: [{ code: 4901, message: "Disconnected" }];
	const send = (events: EthereumEvent[]) => {
		for (const event of events) {
			const args = argsOf(event);
			void deliver(() => emitNow(event, ...args));
		}
	};
	const answerAccounts = (addresses: string[]) =>
		deliver(() => {
			if (behavior.accountsChangedFromAnswers)
				emitNow("accountsChanged", addresses);
			return addresses;
		});
	const reject = (error: EthereumError) =>
		deliver(() => {
			throw error;
		});
	const requestAccounts = async () => {
		if (behavior.authorizesBeforeAccounts) await deliver(() => {});
		const { revoked } = behavior;
		if (access === "revoked" && revoked !== "prompt")
			return revoked === "answers no account"
				? answerAccounts([])
				: reject(revoked);
		if (access === "authorized") return answerAccounts(visible());
		if ((await prompts.ask()) === "refuse") return reject(behavior.refusal);
		access = "authorized";
		granted = accounts;
		const answered = answerAccounts(visible());
		send(behavior.approvalEvents);
		return answered;
	};
	const provider = {
		request: async ({ method }: { method: string }) => {
			if (method === "eth_requestAccounts") return requestAccounts();
			if (method === "eth_accounts") return answerAccounts(visible());
			if (method === "eth_chainId") {
				const read = chainId;
				if (stalledChainRead)
					await new Promise<void>((resolve) => {
						stalledChainRead = resolve;
					});
				return deliver(() => read);
			}
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
			uuid: `00000000-0000-4000-8000-${String(++announcements).padStart(12, "0")}`,
			name,
			icon: "data:image/svg+xml,",
			rdns,
		},
		provider: provider as unknown as EIP6963ProviderDetail["provider"],
	});
	return track({
		label: `${name}/ethereum`,
		setAccounts: (people) => {
			granted = people;
			send(["accountsChanged"]);
		},
		disconnectAll: () => {
			access = "revoked";
			send(behavior.disconnectAllEvents);
		},
		connectAll: () => {
			access = "authorized";
			granted = accounts;
			send(behavior.connectAllEvents);
		},
		answerPrompts: prompts.answerWith,
		releasePrompts: prompts.release,
		openPrompts: prompts.pending,
		promptsShown: prompts.shown,
		switchChain: (next) => {
			chainId = next;
			void deliver(() => emitNow("chainChanged", next));
		},
		stallChainRead: () => {
			stalledChainRead = () => {};
		},
		answerChainRead: () => {
			const answer = stalledChainRead;
			stalledChainRead = undefined;
			answer?.();
		},
		uninstall: unannounce,
	});
};

type ChangeTiming = "before resolving" | "after resolving" | "never";

export type SolanaBehavior = {
	delivery: Delivery;
	/** The message `standard:connect` rejects with when the user refuses its prompt. */
	refusal: string;
	/** Whether the site sees the account selected in the wallet only, or every account it authorized. */
	shows: "selected account" | "authorized accounts";
	/** When `standard:connect` emits `change` with the connected accounts. */
	changeOnConnect: ChangeTiming;
	/** When `standard:disconnect` emits `change` with no account. */
	changeOnDisconnect: ChangeTiming;
	/** Whether `standard:disconnect` revokes the site, so that the next connect prompts. */
	disconnectRevokes: boolean;
};

export const SOLANA_BASELINE: SolanaBehavior = {
	delivery: { latencyMs: 0 },
	refusal: "User rejected the request.",
	shows: "selected account",
	changeOnConnect: "before resolving",
	changeOnDisconnect: "before resolving",
	disconnectRevokes: true,
};

export const installSolanaWallet = (
	{ name, accounts = ["Alice"] }: Identity,
	behavior: SolanaBehavior = SOLANA_BASELINE,
): FakeWallet => {
	const toAccount = (person: Person) => ({
		address: ADDRESSES.solana[person],
		publicKey: new Uint8Array(32),
		chains: ["solana:mainnet"],
		features: [],
		label: person,
	});
	const deliver = createChannel(behavior.delivery);
	const prompts = createPrompts();
	let access: SiteAccess = "new";
	let granted = accounts;
	let shown: Person[] = [];
	const listeners = new Set<Listener>();
	const authorized = () =>
		behavior.shows === "selected account" ? granted.slice(0, 1) : granted;
	const show = (next: Person[]) => {
		if (next.join() === shown.join()) return;
		shown = next;
		for (const listener of listeners)
			listener({ accounts: shown.map(toAccount) });
	};
	const showAfterResolving = (timing: ChangeTiming, next: Person[]) => {
		if (timing === "after resolving") void deliver(() => show(next));
		if (timing === "never") shown = next;
	};
	const standardWallet = {
		version: "1.0.0",
		name,
		icon: "data:image/svg+xml;base64,AAAA",
		chains: ["solana:mainnet"],
		get accounts() {
			return shown.map(toAccount);
		},
		features: {
			"standard:connect": {
				version: "1.0.0",
				connect: async () => {
					if (access !== "authorized") {
						if ((await prompts.ask()) === "refuse")
							return deliver(() => {
								throw new Error(behavior.refusal);
							});
						access = "authorized";
						granted = accounts;
					}
					const next = authorized();
					await deliver(() => {
						if (behavior.changeOnConnect === "before resolving") show(next);
					});
					showAfterResolving(behavior.changeOnConnect, next);
					return { accounts: next.map(toAccount) };
				},
			},
			"standard:disconnect": {
				version: "1.0.0",
				disconnect: async () => {
					if (behavior.disconnectRevokes) access = "revoked";
					await deliver(() => {
						if (behavior.changeOnDisconnect === "before resolving") show([]);
					});
					showAfterResolving(behavior.changeOnDisconnect, []);
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
		standardWallet as unknown as WalletStandardWallet,
	);
	return track({
		label: `${name}/solana`,
		setAccounts: (people) => {
			granted = people;
			void deliver(() => show(authorized()));
		},
		disconnectAll: () => {
			access = "revoked";
			void deliver(() => show([]));
		},
		connectAll: () => {
			access = "authorized";
			granted = accounts;
			void deliver(() => show(authorized()));
		},
		answerPrompts: prompts.answerWith,
		releasePrompts: prompts.release,
		openPrompts: prompts.pending,
		promptsShown: prompts.shown,
		uninstall: unregister,
	});
};

/**
 * What each wallet did when its source was read, in November 2026. These are
 * examples of what kheopskit meets, not a contract: a wallet may change any of
 * them in its next release.
 */
export const installTalisman = (person: Person = "Alice") => ({
	polkadot: installPolkadotWallet(
		{ name: "Talisman", accounts: [person] },
		{
			...POLKADOT_BASELINE,
			refusal: {
				accountsGetRejects: `Site ${window.location.origin} has not been authorised for Talisman yet`,
			},
			revoked: {
				enableRejects: `No Talisman wallet accounts are authorised to connect to ${window.location.href}`,
			},
		},
		"talisman",
	),
	ethereum: installEthereumWallet(
		{ name: "Talisman", accounts: [person] },
		{
			...ETHEREUM_BASELINE,
			revoked: "answers no account",
			disconnectAllEvents: ["accountsChanged", "disconnect"],
			connectAllEvents: ["connect", "accountsChanged"],
			approvalEvents: ["connect", "accountsChanged"],
		},
		"xyz.talisman",
	),
	solana: installSolanaWallet(
		{ name: "Talisman", accounts: [person] },
		{ ...SOLANA_BASELINE, refusal: "Rejected" },
	),
});

export const installSubWallet = (person: Person = "Alice") => ({
	polkadot: installPolkadotWallet(
		{ name: "SubWallet", accounts: [person] },
		POLKADOT_BASELINE,
		"subwallet-js",
	),
	ethereum: installEthereumWallet(
		{ name: "SubWallet", accounts: [person] },
		{ ...ETHEREUM_BASELINE, authorizesBeforeAccounts: true },
		"app.subwallet",
	),
});

export const installMetaMask = (person: Person = "Alice") => ({
	ethereum: installEthereumWallet(
		{ name: "MetaMask", accounts: [person] },
		{ ...ETHEREUM_BASELINE, accountsChangedFromAnswers: true },
		"io.metamask",
	),
});

export const installPhantom = (person: Person = "Bob") => ({
	ethereum: installEthereumWallet(
		{ name: "Phantom", accounts: [person] },
		ETHEREUM_BASELINE,
		"app.phantom",
	),
	solana: installSolanaWallet({ name: "Phantom", accounts: [person] }),
});
