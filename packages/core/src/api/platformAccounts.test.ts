import { BehaviorSubject, Observable, of, Subject, throwError } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { WALLET_CONNECT_WALLET_ID, type WalletId } from "../utils/WalletId";
import { createPlatformAccounts$ } from "./platformAccounts";
import type {
	BaseWallet,
	BaseWalletAccount,
	WalletConnectWallet,
} from "./types";

const A = "polkadot:a" as WalletId;
const B = "polkadot:b" as WalletId;

const injected = (id: WalletId, isConnected = true): BaseWallet => ({
	id,
	platform: "polkadot",
	type: "injected",
	name: id,
	icon: "",
	status: isConnected ? "connected" : "disconnected",
	isConnected,
	connect: async () => {},
	disconnect: async () => {},
});

const walletConnect = (platforms: WalletConnectWallet["platforms"]) =>
	({
		id: WALLET_CONNECT_WALLET_ID,
		type: "walletconnect",
		platforms,
		name: "WalletConnect",
		icon: "",
		status: platforms.length > 0 ? "connected" : "disconnected",
		isConnected: platforms.length > 0,
		connect: async () => {},
		disconnect: async () => {},
	}) as WalletConnectWallet;

const account = (walletId: WalletId, address: string): BaseWalletAccount => ({
	id: `${walletId}::${address}`,
	platform: "polkadot",
	address,
	walletId,
	walletName: walletId,
});

const createSources = () => {
	const subjects = new Map<WalletId, Subject<BaseWalletAccount[]>>();
	const subscribed = new Map<WalletId, number>();
	const unsubscribed = new Map<WalletId, number>();
	const count = (counter: Map<WalletId, number>, id: WalletId) =>
		counter.set(id, (counter.get(id) ?? 0) + 1);
	const subjectOf = (id: WalletId) => {
		const existing = subjects.get(id);
		if (existing) return existing;
		const created = new Subject<BaseWalletAccount[]>();
		subjects.set(id, created);
		return created;
	};
	return {
		emit: (id: WalletId, accounts: BaseWalletAccount[]) =>
			subjectOf(id).next(accounts),
		subscribedTimes: (id: WalletId) => subscribed.get(id) ?? 0,
		unsubscribedTimes: (id: WalletId) => unsubscribed.get(id) ?? 0,
		accountsOf: (wallet: BaseWallet | WalletConnectWallet) =>
			new Observable<BaseWalletAccount[]>((subscriber) => {
				count(subscribed, wallet.id);
				const sub = subjectOf(wallet.id).subscribe(subscriber);
				return () => {
					count(unsubscribed, wallet.id);
					sub.unsubscribe();
				};
			}),
	};
};

const collect = (
	wallets$: Observable<(BaseWallet | WalletConnectWallet)[]>,
) => {
	const sources = createSources();
	const emissions: string[][] = [];
	const sub = createPlatformAccounts$<BaseWallet, BaseWalletAccount>({
		wallets$,
		getInjectedAccounts$: sources.accountsOf,
		getWalletConnectAccounts$: sources.accountsOf,
	}).subscribe((accounts) => emissions.push(accounts.map((a) => a.address)));
	return { ...sources, emissions, sub };
};

const collectFrames = (
	wallets$: Observable<(BaseWallet | WalletConnectWallet)[]>,
) => {
	const sources = createSources();
	const frames: { accounts: string[]; answered: WalletId[] }[] = [];
	const accounts$ = createPlatformAccounts$<BaseWallet, BaseWalletAccount>({
		wallets$,
		getInjectedAccounts$: sources.accountsOf,
		getWalletConnectAccounts$: sources.accountsOf,
	});
	const emissions: string[][] = [];
	const sub = accounts$.subscribe((accounts) =>
		emissions.push(accounts.map((a) => a.address)),
	);
	sub.add(
		accounts$.frames$.subscribe(({ accounts, answered }) =>
			frames.push({ accounts: accounts.map((a) => a.address), answered }),
		),
	);
	return { ...sources, emissions, frames, sub };
};

describe("createPlatformAccounts$", () => {
	it("emits an empty list at once when no wallet is connected", () => {
		const { emissions, sub } = collect(of([injected(A, false)]));

		expect(emissions).toEqual([[]]);
		sub.unsubscribe();
	});

	it("the first value waits for every connected wallet's answer", () => {
		const { emit, emissions, sub } = collect(of([injected(A), injected(B)]));

		emit(B, [account(B, "b1")]);
		expect(emissions).toEqual([]);

		emit(A, [account(A, "a1")]);
		expect(emissions).toEqual([["a1", "b1"]]);
		sub.unsubscribe();
	});

	it("a wallet whose stream has not emitted contributes nothing and does not hold back the others", () => {
		const wallets$ = new BehaviorSubject([injected(A), injected(B, false)]);
		const { emit, emissions, sub } = collect(wallets$);
		emit(A, [account(A, "a1")]);

		wallets$.next([injected(A), injected(B)]);
		emit(A, [account(A, "a1"), account(A, "a2")]);
		expect(emissions).toEqual([["a1"], ["a1", "a2"]]);

		emit(B, [account(B, "b1")]);
		expect(emissions).toEqual([["a1"], ["a1", "a2"], ["a1", "a2", "b1"]]);
		sub.unsubscribe();
	});

	it("a reconnect restarts the wallet's accounts empty and resubscribes its stream", () => {
		const wallets$ = new BehaviorSubject([injected(A), injected(B)]);
		const { emit, emissions, subscribedTimes, unsubscribedTimes, sub } =
			collect(wallets$);
		emit(A, [account(A, "a1")]);
		emit(B, [account(B, "b-old")]);

		wallets$.next([injected(A), injected(B, false)]);
		expect(emissions.at(-1)).toEqual(["a1"]);
		expect(unsubscribedTimes(B)).toBe(1);

		wallets$.next([injected(A), injected(B)]);
		expect(subscribedTimes(B)).toBe(2);
		expect(emissions.at(-1)).toEqual(["a1"]);

		emit(B, [account(B, "b-new")]);
		expect(emissions).toEqual([["a1", "b-old"], ["a1"], ["a1", "b-new"]]);
		sub.unsubscribe();
	});

	it("a sibling connecting or disconnecting leaves a connected wallet's stream and accounts alone", () => {
		const wallets$ = new BehaviorSubject([injected(A), injected(B, false)]);
		const { emit, emissions, subscribedTimes, unsubscribedTimes, sub } =
			collect(wallets$);
		emit(A, [account(A, "a1")]);

		wallets$.next([injected(A), injected(B)]);
		emit(B, [account(B, "b1")]);
		wallets$.next([injected(A), injected(B, false)]);
		wallets$.next([injected(A), injected(B)]);

		expect(subscribedTimes(A)).toBe(1);
		expect(unsubscribedTimes(A)).toBe(0);
		expect(subscribedTimes(B)).toBe(2);
		expect(emissions).toEqual([["a1"], ["a1", "b1"], ["a1"]]);
		sub.unsubscribe();
	});

	it("unsubscribing tears down every connected wallet's stream", () => {
		const { unsubscribedTimes, sub } = collect(
			of([injected(A), injected(B), walletConnect(["polkadot"])]),
		);

		sub.unsubscribe();
		expect(unsubscribedTimes(A)).toBe(1);
		expect(unsubscribedTimes(B)).toBe(1);
		expect(unsubscribedTimes(WALLET_CONNECT_WALLET_ID)).toBe(1);
	});

	it("lists accounts in the wallets' order, the WalletConnect connector included", () => {
		const { emit, emissions, sub } = collect(
			of([injected(B), walletConnect(["polkadot"]), injected(A)]),
		);

		emit(A, [account(A, "a1")]);
		emit(WALLET_CONNECT_WALLET_ID, [account(WALLET_CONNECT_WALLET_ID, "wc1")]);
		emit(B, [account(B, "b1"), account(B, "b2")]);
		expect(emissions.at(-1)).toEqual(["b1", "b2", "wc1", "a1"]);
		sub.unsubscribe();
	});

	it("frames$ lists a connected wallet as answered once its stream has emitted, an empty list included, while the account list stays deduped", () => {
		const wallets$ = new BehaviorSubject([injected(A, false)]);
		const { emit, emissions, frames, sub } = collectFrames(wallets$);

		wallets$.next([injected(A)]);
		expect(frames).toEqual([{ accounts: [], answered: [] }]);

		emit(A, []);
		expect(frames).toEqual([
			{ accounts: [], answered: [] },
			{ accounts: [], answered: [A] },
		]);
		expect(emissions).toEqual([[]]);

		emit(A, [account(A, "a1")]);
		expect(frames.at(-1)).toEqual({ accounts: ["a1"], answered: [A] });
		expect(emissions).toEqual([[], ["a1"]]);
		sub.unsubscribe();
	});

	it("frames$ drops a wallet from answered on disconnect and on reconnect until its new stream answers", () => {
		const wallets$ = new BehaviorSubject([injected(A), injected(B)]);
		const { emit, frames, subscribedTimes, sub } = collectFrames(wallets$);
		emit(A, [account(A, "a1")]);
		emit(B, []);
		expect(frames.at(-1)).toEqual({ accounts: ["a1"], answered: [A, B] });

		wallets$.next([injected(A), injected(B, false)]);
		expect(frames.at(-1)).toEqual({ accounts: ["a1"], answered: [A] });

		wallets$.next([injected(A), injected(B)]);
		expect(subscribedTimes(B)).toBe(2);
		expect(frames.at(-1)).toEqual({ accounts: ["a1"], answered: [A] });

		emit(B, [account(B, "b1")]);
		expect(frames.at(-1)).toEqual({ accounts: ["a1", "b1"], answered: [A, B] });
		sub.unsubscribe();
	});

	it("a wallet whose stream errors lists no accounts and leaves the other wallets' accounts flowing", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const wallets$ = new BehaviorSubject([injected(A), injected(B)]);
		const sources = createSources();
		const emissions: string[][] = [];
		let failed: unknown;
		const sub = createPlatformAccounts$<BaseWallet, BaseWalletAccount>({
			wallets$,
			getInjectedAccounts$: (wallet) =>
				wallet.id === B
					? throwError(() => new Error("bridge stopped"))
					: sources.accountsOf(wallet),
			getWalletConnectAccounts$: sources.accountsOf,
		}).subscribe({
			next: (accounts) => emissions.push(accounts.map((a) => a.address)),
			error: (error) => {
				failed = error;
			},
		});

		sources.emit(A, [account(A, "a1")]);
		sources.emit(A, [account(A, "a1"), account(A, "a2")]);

		expect(failed).toBeUndefined();
		expect(emissions).toEqual([["a1"], ["a1", "a2"]]);
		expect(warn).toHaveBeenCalledWith(
			`[kheopskit] Could not list the accounts of ${B}`,
			expect.any(Error),
		);
		sub.unsubscribe();
		warn.mockRestore();
	});

	it("restarts the WalletConnect connector's stream when its session's platforms change", () => {
		const wallets$ = new BehaviorSubject([walletConnect(["ethereum"])]);
		const { emissions, subscribedTimes, sub } = collect(wallets$);

		wallets$.next([walletConnect(["ethereum", "polkadot"])]);
		expect(subscribedTimes(WALLET_CONNECT_WALLET_ID)).toBe(2);

		wallets$.next([walletConnect([])]);
		expect(emissions.at(-1)).toEqual([]);
		sub.unsubscribe();
	});
});
