import { getWallets } from "@wallet-standard/app";
import type { Wallet as WalletStandardWallet } from "@wallet-standard/base";
import { announceProvider, type EIP6963ProviderDetail } from "mipd";
import { vi } from "vitest";
import {
	createFakePolkadotExtension,
	type FakePolkadotExtension,
} from "../../testing";
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

const PROVIDER_EVENT_GAP_MS = 10;

export const betweenProviderEvents = () =>
	vi.advanceTimersByTimeAsync(PROVIDER_EVENT_GAP_MS);

/** How the wallet answers the next connect requests. */
type ConnectAnswer = "grant" | "refuse" | "hold";

export type FakeWallet = {
	/** The wallet's label in a `Frame`: its name, a slash, its platform. */
	label: string;
	/** Replaces the accounts the site may see, as an account switch in the wallet does. */
	setAccounts: (people: Person[]) => void;
	/** The events of Talisman's "Disconnect All". */
	disconnectAll: () => Promise<void>;
	/** The events of Talisman's "Connect All" after a "Disconnect All". */
	connectAll: () => Promise<void>;
	/** Sets how the wallet answers connects from now on, as revoking the site or locking the wallet does. */
	answerConnects: (answer: ConnectAnswer) => void;
	/** Grants the connects held by `answerConnects("hold")`, as unlocking the wallet does. */
	grantHeldConnects: () => void;
	uninstall: () => void;
};

const installed = new Set<FakeWallet>();

const track = (wallet: FakeWallet): FakeWallet => {
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

const held = () => {
	let release = () => {};
	const released = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { released, release };
};

export const installPolkadotWallet = ({
	key,
	name,
	accounts,
}: {
	key: string;
	name: string;
	accounts: Person[];
}): FakeWallet => {
	const toAccount = (person: Person) => ({
		address: ADDRESSES.polkadot[person],
		name: person,
		type: "sr25519" as const,
	});
	let authorized = accounts.map(toAccount);
	let extension: FakePolkadotExtension = createFakePolkadotExtension({
		name: key,
		accounts: authorized,
	});
	const setAccounts = (people: Person[]) => {
		authorized = people.map(toAccount);
		extension.setAccounts(authorized);
	};
	return track({
		label: `${name}/polkadot`,
		setAccounts,
		disconnectAll: async () => setAccounts([]),
		connectAll: async () => setAccounts(accounts),
		answerConnects: (answer) => {
			extension.uninstall();
			extension = createFakePolkadotExtension({
				name: key,
				accounts: authorized,
				enable:
					answer === "grant"
						? "resolve"
						: answer === "refuse"
							? "reject"
							: "hold",
			});
		},
		grantHeldConnects: () => extension.resolveEnable(),
		uninstall: () => extension.uninstall(),
	});
};

type Listener = (...args: unknown[]) => void;

type HeldRequest = "eth_requestAccounts" | "eth_chainId";

export type FakeEthereumWallet = FakeWallet & {
	switchChain: (chainId: `0x${string}`) => void;
	/** Holds the answers to `method`, as computed when requested, until `release(method)`. */
	hold: (method: HeldRequest) => void;
	release: (method: HeldRequest) => void;
};

let announcements = 0;

export const installEthereumWallet = ({
	rdns,
	name,
	accounts,
}: {
	rdns: string;
	name: string;
	accounts: Person[];
}): FakeEthereumWallet => {
	let authorized: string[] = [];
	let chainId = "0x1";
	let connectAnswer: ConnectAnswer = "grant";
	const heldRequests = new Map<string, ReturnType<typeof held>>();
	const listeners = new Map<string, Set<Listener>>();
	const emit = (event: string, ...args: unknown[]) => {
		for (const listener of listeners.get(event) ?? []) listener(...args);
	};
	const addressesOf = (people: Person[]) =>
		people.map((person) => ADDRESSES.ethereum[person]);
	const answerOf = (method: string) => {
		if (method === "eth_requestAccounts") {
			if (connectAnswer === "refuse")
				return Promise.reject({
					code: 4001,
					message: "User rejected the request.",
				});
			if (!authorized.length) authorized = addressesOf(accounts);
		}
		if (method === "eth_requestAccounts" || method === "eth_accounts")
			return authorized;
		if (method === "eth_chainId") return chainId;
		throw new Error(`unexpected request ${method}`);
	};
	const provider = {
		request: async ({ method }: { method: string }) => {
			if (method === "eth_requestAccounts" && connectAnswer === "hold")
				await heldRequests.get("connect")?.released;
			const answer = answerOf(method);
			await heldRequests.get(method)?.released;
			return answer;
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
	const setAccounts = (people: Person[]) => {
		authorized = addressesOf(people);
		emit("accountsChanged", authorized);
	};
	const wallet = track({
		label: `${name}/ethereum`,
		setAccounts,
		disconnectAll: async () => {
			setAccounts([]);
			await betweenProviderEvents();
			emit("disconnect", { code: 4901, message: "Disconnected" });
		},
		connectAll: async () => {
			emit("connect", { chainId });
			await betweenProviderEvents();
			setAccounts(accounts);
		},
		answerConnects: (answer) => {
			connectAnswer = answer;
			if (answer === "hold") heldRequests.set("connect", held());
		},
		grantHeldConnects: () => {
			connectAnswer = "grant";
			heldRequests.get("connect")?.release();
			heldRequests.delete("connect");
		},
		uninstall: unannounce,
	});
	return Object.assign(wallet, {
		switchChain: (next: `0x${string}`) => {
			chainId = next;
			emit("chainChanged", chainId);
		},
		hold: (method: HeldRequest) => heldRequests.set(method, held()),
		release: (method: HeldRequest) => {
			heldRequests.get(method)?.release();
			heldRequests.delete(method);
		},
	});
};

export const installSolanaWallet = ({
	name,
	accounts,
}: {
	name: string;
	accounts: Person[];
}): FakeWallet => {
	const toAccount = (person: Person) => ({
		address: ADDRESSES.solana[person],
		publicKey: new Uint8Array(32),
		chains: ["solana:mainnet"],
		features: [],
		label: person,
	});
	let authorized: ReturnType<typeof toAccount>[] = [];
	let connectAnswer: ConnectAnswer = "grant";
	let heldConnects = held();
	const listeners = new Set<Listener>();
	const setAccounts = (people: Person[]) => {
		authorized = people.map(toAccount);
		for (const listener of listeners) listener({ accounts: authorized });
	};
	const standardWallet = {
		version: "1.0.0",
		name,
		icon: "data:image/svg+xml;base64,AAAA",
		chains: ["solana:mainnet"],
		get accounts() {
			return authorized;
		},
		features: {
			"standard:connect": {
				version: "1.0.0",
				connect: async () => {
					if (connectAnswer === "hold") await heldConnects.released;
					if (connectAnswer === "refuse")
						throw new Error("User rejected the request.");
					if (!authorized.length) authorized = accounts.map(toAccount);
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
		standardWallet as unknown as WalletStandardWallet,
	);
	return track({
		label: `${name}/solana`,
		setAccounts,
		disconnectAll: async () => setAccounts([]),
		connectAll: async () => setAccounts(accounts),
		answerConnects: (answer) => {
			connectAnswer = answer;
			if (answer === "hold") heldConnects = held();
		},
		grantHeldConnects: () => {
			connectAnswer = "grant";
			heldConnects.release();
		},
		uninstall: unregister,
	});
};

/** Talisman on every platform, with the same accounts on each. */
export const installTalisman = (accounts: Person[] = ["Alice"]) => ({
	polkadot: installPolkadotWallet({
		key: "talisman",
		name: "Talisman",
		accounts,
	}),
	ethereum: installEthereumWallet({
		rdns: "xyz.talisman",
		name: "Talisman",
		accounts,
	}),
	solana: installSolanaWallet({ name: "Talisman", accounts }),
});

export const installSubWallet = (accounts: Person[] = ["Alice"]) => ({
	polkadot: installPolkadotWallet({
		key: "subwallet-js",
		name: "SubWallet",
		accounts,
	}),
	ethereum: installEthereumWallet({
		rdns: "app.subwallet",
		name: "SubWallet",
		accounts,
	}),
});

export const installMetaMask = (accounts: Person[] = ["Alice"]) => ({
	ethereum: installEthereumWallet({
		rdns: "io.metamask",
		name: "MetaMask",
		accounts,
	}),
});

export const installPhantom = (accounts: Person[] = ["Bob"]) => ({
	ethereum: installEthereumWallet({
		rdns: "app.phantom",
		name: "Phantom",
		accounts,
	}),
	solana: installSolanaWallet({ name: "Phantom", accounts }),
});
