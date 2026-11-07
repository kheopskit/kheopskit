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
 * An extension's page script hears from its background through `postMessage`:
 * every answer and every event arrives in its own task, in the order the
 * background sent them.
 */
const createChannel = () => {
	let tail: Promise<unknown> = Promise.resolve();
	return <T>(message: () => T | Promise<T>): Promise<T> => {
		const delivered = tail
			.then(() => new Promise((resolve) => setTimeout(resolve, 0)))
			.then(message);
		tail = delivered.catch(() => {});
		return delivered;
	};
};

/** How the user answers the wallet's connect prompts. */
type PromptAnswer = "approve" | "refuse" | "hold";

/** What a wallet does when a site the user revoked in the wallet asks to connect. */
type RevokedConnect = "prompt" | "answer no account" | { reject: string };

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

type InjectedWeb3Global = { injectedWeb3?: Record<string, unknown> };

const installPolkadotWallet = ({
	key,
	name,
	accounts,
	refusal,
	revokedConnect,
}: {
	key: string;
	name: string;
	accounts: Person[];
	/** How `enable()` fails when the user refuses its prompt. */
	refusal: { reject: string } | { rejectAccountsGet: string };
	revokedConnect: RevokedConnect;
}): FakeWallet => {
	const toAccount = (person: Person) => ({
		address: ADDRESSES.polkadot[person],
		name: person,
		type: "sr25519" as const,
	});
	const deliver = createChannel();
	const prompts = createPrompts();
	let access: SiteAccess = "new";
	let granted = accounts;
	const listeners = new Set<(list: ReturnType<typeof toAccount>[]) => void>();
	const visible = () => (access === "authorized" ? granted.map(toAccount) : []);
	const notify = () => {
		const list = visible();
		for (const listener of listeners) deliver(() => listener(list));
	};
	const signature = `0x${"01".repeat(64)}` as const;
	const injected = (refused: boolean): PolkadotInjected => ({
		accounts: {
			get: () =>
				deliver(() => {
					if (refused && "rejectAccountsGet" in refusal)
						throw new Error(refusal.rejectAccountsGet);
					return visible();
				}),
			subscribe: (listener) => {
				listeners.add(listener);
				const list = visible();
				deliver(() => listener(list));
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
		if (access === "revoked" && revokedConnect !== "prompt") {
			const answer =
				revokedConnect === "answer no account"
					? undefined
					: new Error(revokedConnect.reject);
			return deliver(() => {
				if (answer) throw answer;
				return injected(false);
			});
		}
		if (access === "authorized") return deliver(() => injected(false));
		const answer = await prompts.ask();
		if (answer === "approve") {
			access = "authorized";
			granted = accounts;
			return deliver(() => injected(false));
		}
		if ("rejectAccountsGet" in refusal) return deliver(() => injected(true));
		return deliver(() => {
			throw new Error(refusal.reject);
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

export type FakeEthereumWallet = FakeWallet & {
	/** The user switches the wallet to another chain. */
	switchChain: (chainId: `0x${string}`) => void;
	/** The wallet answers the next `eth_chainId` only once `answerChainRead()` runs. */
	holdChainRead: () => void;
	answerChainRead: () => void;
};

let announcements = 0;

const installEthereumWallet = ({
	rdns,
	name,
	accounts,
	revokedConnect,
	disconnectAllEvents,
	approvalEvents,
	emitsAccountsWithAnswers = false,
}: {
	rdns: string;
	name: string;
	accounts: Person[];
	revokedConnect: RevokedConnect;
	/** The events the wallet sends when the user removes the site's accounts. */
	disconnectAllEvents: "accountsChanged" | "accountsChanged, disconnect";
	/** The events the wallet sends once the user approves the site. */
	approvalEvents: "accountsChanged" | "connect, accountsChanged";
	/** MetaMask's provider emits `accountsChanged` itself when an accounts answer differs from the last list it saw. */
	emitsAccountsWithAnswers?: boolean;
}): FakeEthereumWallet => {
	const deliver = createChannel();
	const prompts = createPrompts();
	let access: SiteAccess = "new";
	let granted = accounts;
	let chainId = "0x1";
	let heldChainRead: (() => void) | undefined;
	let lastSeen: string[] = [];
	const listeners = new Map<string, Set<Listener>>();
	const visible = () =>
		access === "authorized"
			? granted.map((person) => ADDRESSES.ethereum[person])
			: [];
	const emitNow = (event: string, ...args: unknown[]) => {
		if (event === "accountsChanged") {
			const addresses = args[0] as string[];
			if (emitsAccountsWithAnswers && addresses.join() === lastSeen.join())
				return;
			lastSeen = addresses;
		}
		for (const listener of listeners.get(event) ?? []) listener(...args);
	};
	const send = (event: string, ...args: unknown[]) =>
		void deliver(() => emitNow(event, ...args));
	const answerAccounts = (addresses: string[]) =>
		deliver(() => {
			if (emitsAccountsWithAnswers && addresses.join() !== lastSeen.join())
				emitNow("accountsChanged", addresses);
			return addresses;
		});
	const requestAccounts = async () => {
		if (access === "revoked" && revokedConnect !== "prompt") {
			if (revokedConnect === "answer no account") return answerAccounts([]);
			const message = revokedConnect.reject;
			return deliver(() => {
				throw new Error(message);
			});
		}
		if (access === "authorized") return answerAccounts(visible());
		const answer = await prompts.ask();
		if (answer === "refuse")
			return deliver(() => {
				throw { code: 4001, message: "User rejected the request." };
			});
		access = "authorized";
		granted = accounts;
		const answered = answerAccounts(visible());
		if (approvalEvents === "connect, accountsChanged")
			send("connect", { chainId });
		send("accountsChanged", visible());
		return answered;
	};
	const provider = {
		request: async ({ method }: { method: string }) => {
			if (method === "eth_requestAccounts") return requestAccounts();
			if (method === "eth_accounts") return answerAccounts(visible());
			if (method === "eth_chainId") {
				if (heldChainRead) {
					const answered = new Promise<void>((resolve) => {
						heldChainRead = resolve;
					});
					await answered;
				}
				return deliver(() => chainId);
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
			send("accountsChanged", visible());
		},
		disconnectAll: () => {
			access = "revoked";
			send("accountsChanged", []);
			if (disconnectAllEvents === "accountsChanged, disconnect")
				send("disconnect", { code: 4901, message: "Disconnected" });
		},
		connectAll: () => {
			access = "authorized";
			granted = accounts;
			send("connect", { chainId });
			send("accountsChanged", visible());
		},
		answerPrompts: prompts.answerWith,
		releasePrompts: prompts.release,
		openPrompts: prompts.pending,
		promptsShown: prompts.shown,
		switchChain: (next) => {
			chainId = next;
			send("chainChanged", chainId);
		},
		holdChainRead: () => {
			heldChainRead = () => {};
		},
		answerChainRead: () => {
			const answer = heldChainRead;
			heldChainRead = undefined;
			answer?.();
		},
		uninstall: unannounce,
	});
};

const installSolanaWallet = ({
	name,
	account: person,
	refusal,
}: {
	name: string;
	/** Talisman and the Wallet Standard reference wallet show the site one selected account. */
	account: Person;
	refusal: string;
}): FakeWallet => {
	const toAccount = (selected: Person) => ({
		address: ADDRESSES.solana[selected],
		publicKey: new Uint8Array(32),
		chains: ["solana:mainnet"],
		features: [],
		label: selected,
	});
	const deliver = createChannel();
	const prompts = createPrompts();
	let access: SiteAccess = "new";
	let selected = person;
	let shown: ReturnType<typeof toAccount> | null = null;
	const listeners = new Set<Listener>();
	const show = (next: ReturnType<typeof toAccount> | null) => {
		if (shown?.address === next?.address) return;
		shown = next;
		for (const listener of listeners)
			listener({ accounts: shown ? [shown] : [] });
	};
	const standardWallet = {
		version: "1.0.0",
		name,
		icon: "data:image/svg+xml;base64,AAAA",
		chains: ["solana:mainnet"],
		get accounts() {
			return shown ? [shown] : [];
		},
		features: {
			"standard:connect": {
				version: "1.0.0",
				connect: async () => {
					if (access !== "authorized") {
						const answer = await prompts.ask();
						if (answer === "refuse")
							return deliver(() => {
								throw new Error(refusal);
							});
						access = "authorized";
						selected = person;
					}
					await deliver(() => {});
					show(toAccount(selected));
					return { accounts: [toAccount(selected)] };
				},
			},
			"standard:disconnect": {
				version: "1.0.0",
				disconnect: async () => {
					access = "revoked";
					await deliver(() => show(null));
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
			const [next] = people;
			if (!next || people.length > 1)
				throw new Error(`${name} shows the site exactly one selected account`);
			selected = next;
			deliver(() => show(toAccount(selected)));
		},
		disconnectAll: () => {
			access = "revoked";
			deliver(() => show(null));
		},
		connectAll: () => {
			access = "authorized";
			selected = person;
			deliver(() => show(toAccount(selected)));
		},
		answerPrompts: prompts.answerWith,
		releasePrompts: prompts.release,
		openPrompts: prompts.pending,
		promptsShown: prompts.shown,
		uninstall: unregister,
	});
};

const TALISMAN_POLKADOT_REVOKED = (url: string) =>
	`No Talisman wallet accounts are authorised to connect to ${url}`;

/** Talisman on every platform, with the same person's account on each. */
export const installTalisman = (person: Person = "Alice") => ({
	polkadot: installPolkadotWallet({
		key: "talisman",
		name: "Talisman",
		accounts: [person],
		refusal: {
			rejectAccountsGet: `Site ${window.location.origin} has not been authorised for Talisman yet`,
		},
		revokedConnect: { reject: TALISMAN_POLKADOT_REVOKED(window.location.href) },
	}),
	ethereum: installEthereumWallet({
		rdns: "xyz.talisman",
		name: "Talisman",
		accounts: [person],
		revokedConnect: "answer no account",
		disconnectAllEvents: "accountsChanged, disconnect",
		approvalEvents: "connect, accountsChanged",
	}),
	solana: installSolanaWallet({
		name: "Talisman",
		account: person,
		refusal: "Rejected",
	}),
});

export const installSubWallet = (person: Person = "Alice") => ({
	polkadot: installPolkadotWallet({
		key: "subwallet-js",
		name: "SubWallet",
		accounts: [person],
		refusal: { reject: "Rejected" },
		revokedConnect: "prompt",
	}),
	ethereum: installEthereumWallet({
		rdns: "app.subwallet",
		name: "SubWallet",
		accounts: [person],
		revokedConnect: "prompt",
		disconnectAllEvents: "accountsChanged",
		approvalEvents: "accountsChanged",
	}),
});

export const installMetaMask = (person: Person = "Alice") => ({
	ethereum: installEthereumWallet({
		rdns: "io.metamask",
		name: "MetaMask",
		accounts: [person],
		revokedConnect: "prompt",
		disconnectAllEvents: "accountsChanged",
		approvalEvents: "accountsChanged",
		emitsAccountsWithAnswers: true,
	}),
});

export const installPhantom = (person: Person = "Bob") => ({
	ethereum: installEthereumWallet({
		rdns: "app.phantom",
		name: "Phantom",
		accounts: [person],
		revokedConnect: "prompt",
		disconnectAllEvents: "accountsChanged",
		approvalEvents: "accountsChanged",
	}),
	solana: installSolanaWallet({
		name: "Phantom",
		account: person,
		refusal: "User rejected the request.",
	}),
});
