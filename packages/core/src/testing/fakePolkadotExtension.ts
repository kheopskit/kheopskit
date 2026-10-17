import type { PolkadotInjected } from "../api/polkadot/types";
import type { PolkadotAccountType } from "../api/types";

/** `PolkadotInjectedAccount`, restated so these declarations import nothing from polkadot-api. */
export type FakePolkadotAccount = {
	address: string;
	genesisHash?: string | null;
	name?: string;
	type?: PolkadotAccountType;
	readonly?: boolean;
	partOfPortfolio?: boolean;
};

type EnableAnswer = "resolve" | "reject" | "hold";

export type FakePolkadotExtensionOptions = {
	/** Key under `window.injectedWeb3`. @default "fake-extension" */
	name?: string;
	accounts?: FakePolkadotAccount[];
	/**
	 * How `enable()` answers: `"resolve"` at once, `"reject"` at once with
	 * `new Error("Rejected")`, or `"hold"` until `resolveEnable()` or
	 * `rejectEnable()`.
	 * @default "resolve"
	 */
	enable?: EnableAnswer;
};

export type FakeSignRawCall = {
	address: string;
	data: string;
	type: "bytes" | "payload";
};

export type FakePolkadotExtension = {
	name: string;
	walletId: `polkadot:${string}`;
	/** Replaces the account list and pushes it to every `accounts.subscribe` listener. */
	setAccounts: (accounts: FakePolkadotAccount[]) => void;
	/** Resolves every held `enable()` call with the injected extension. */
	resolveEnable: () => void;
	/** Rejects every held `enable()` call, with `new Error("Rejected")` by default. */
	rejectEnable: (error?: Error) => void;
	/** The app name of each `enable()` call, in call order. */
	enableCalls: () => string[];
	/** What each `signRaw` call received. `signPayload` calls are not recorded. */
	signRawCalls: () => FakeSignRawCall[];
	/** Removes the extension from `window.injectedWeb3`. Calling it again does nothing. */
	uninstall: () => void;
};

type InjectedWeb3Global = {
	injectedWeb3?: Record<string, unknown>;
};

type HeldEnable = {
	resolve: (injected: PolkadotInjected) => void;
	reject: (error: Error) => void;
};

/** The signature the fake resolves for every `signRaw` and `signPayload` call. */
export const FAKE_SIGNATURE: `0x${string}` = `0x${"01".repeat(64)}`;

const rejected = () => new Error("Rejected");

/** Installs a fake Polkadot extension at `window.injectedWeb3[name]` until `uninstall()`. */
export const createFakePolkadotExtension = ({
	name = "fake-extension",
	accounts: initialAccounts = [],
	enable: answer = "resolve",
}: FakePolkadotExtensionOptions = {}): FakePolkadotExtension => {
	let accounts = initialAccounts;
	const listeners = new Set<(accounts: FakePolkadotAccount[]) => void>();
	const appNames: string[] = [];
	const signRawCalls: FakeSignRawCall[] = [];
	let held: HeldEnable[] = [];
	let signatures = 0;

	const injected: PolkadotInjected = {
		accounts: {
			get: async () => accounts,
			subscribe: (listener) => {
				listeners.add(listener);
				listener(accounts);
				return () => {
					listeners.delete(listener);
				};
			},
		},
		signer: {
			signPayload: async () => ({
				id: ++signatures,
				signature: FAKE_SIGNATURE,
			}),
			signRaw: async (payload) => {
				signRawCalls.push({ ...payload });
				return { id: ++signatures, signature: FAKE_SIGNATURE };
			},
		},
	};

	const entry = {
		enable: (appName: string) => {
			appNames.push(appName);
			if (answer === "reject") return Promise.reject(rejected());
			if (answer === "hold")
				return new Promise<PolkadotInjected>((resolve, reject) => {
					held.push({ resolve, reject });
				});
			return Promise.resolve(injected);
		},
	};

	const global = globalThis as InjectedWeb3Global;
	global.injectedWeb3 ??= {};
	global.injectedWeb3[name] = entry;

	const settleHeld = (settle: (request: HeldEnable) => void) => {
		const requests = held;
		held = [];
		for (const request of requests) settle(request);
	};

	return {
		name,
		walletId: `polkadot:${name}`,
		setAccounts: (next) => {
			accounts = next;
			for (const listener of listeners) listener(accounts);
		},
		resolveEnable: () => settleHeld((request) => request.resolve(injected)),
		rejectEnable: (error = rejected()) =>
			settleHeld((request) => request.reject(error)),
		enableCalls: () => [...appNames],
		signRawCalls: () => [...signRawCalls],
		uninstall: () => {
			const registry = global.injectedWeb3;
			if (registry?.[name] !== entry) return;
			delete registry[name];
			if (!Object.keys(registry).length) delete global.injectedWeb3;
		},
	};
};
