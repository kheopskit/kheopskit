import { createSignableMessage } from "@solana/kit";
import { firstValueFrom, of, take, toArray } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import type { WalletId } from "../../utils/WalletId";
import type { SolanaAppKitWallet } from "../types";
import type { SolanaInjectedWallet } from "./types";

const ADDRESS_1 = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const ADDRESS_2 = "So11111111111111111111111111111111111111112";

type ChangeListener = (props: unknown) => void;

const createMockStandardWallet = () => {
	const changeListeners = new Set<ChangeListener>();

	const wallet = {
		version: "1.0.0",
		name: "Phantom",
		icon: "data:image/svg+xml;base64,AAAA",
		chains: ["solana:mainnet", "solana:devnet"],
		accounts: [
			{
				address: ADDRESS_1,
				publicKey: new Uint8Array(32),
				chains: ["solana:mainnet"],
				features: [],
			},
		] as Array<Record<string, unknown>>,
		features: {
			"solana:signMessage": {
				version: "1.0.0",
				signMessage: vi.fn(async (...inputs: Array<{ message: Uint8Array }>) =>
					inputs.map((input) => ({
						signedMessage: input.message,
						signature: new Uint8Array(64),
					})),
				),
			},
			"standard:events": {
				version: "1.0.0",
				on: vi.fn((event: string, listener: ChangeListener) => {
					if (event !== "change") return () => {};
					changeListeners.add(listener);
					return () => changeListeners.delete(listener);
				}),
			},
		} as Record<string, unknown>,
		// test helpers
		_emitChange: (props: unknown) => {
			for (const listener of changeListeners) listener(props);
		},
		_changeListenerCount: () => changeListeners.size,
	};

	return wallet;
};

const createMockInjectedWallet = (
	standardWallet: ReturnType<typeof createMockStandardWallet>,
	overrides: Partial<SolanaInjectedWallet> = {},
): SolanaInjectedWallet => ({
	platform: "solana",
	type: "injected",
	id: "solana:Phantom" as WalletId,
	walletStandardId: "Phantom",
	wallet: standardWallet as unknown as SolanaInjectedWallet["wallet"],
	chains: ["solana:mainnet", "solana:devnet"],
	name: "Phantom",
	icon: "data:image/svg+xml;base64,AAAA",
	isConnected: true,
	connect: vi.fn(),
	disconnect: vi.fn(),
	...overrides,
});

const createMockAppKitWallet = (
	namespaces: Record<string, { accounts: string[] }>,
	overrides: Partial<SolanaAppKitWallet> = {},
): SolanaAppKitWallet => {
	const listeners = new Map<string, Set<ChangeListener>>();
	const provider = {
		session: { topic: "test-topic", namespaces },
		client: { request: vi.fn() },
		on: vi.fn((event: string, cb: ChangeListener) => {
			let set = listeners.get(event);
			if (!set) {
				set = new Set();
				listeners.set(event, set);
			}
			set.add(cb);
		}),
		off: vi.fn((event: string, cb: ChangeListener) => {
			listeners.get(event)?.delete(cb);
		}),
		// test helper
		_emit: (event: string, props?: unknown) => {
			for (const cb of listeners.get(event) ?? []) cb(props);
		},
	};

	return {
		platform: "solana",
		type: "appKit",
		id: "solana:walletconnect" as WalletId,
		name: "WalletConnect",
		icon: "data:image/svg+xml;base64,AAAA",
		isConnected: true,
		connect: vi.fn(),
		disconnect: vi.fn(),
		appKit: {
			getProvider: vi.fn(() => provider),
		} as unknown as SolanaAppKitWallet["appKit"],
		...overrides,
	};
};

describe("getSolanaAccounts$", () => {
	// Clear cached account observables between tests
	const importAccounts = async () => {
		const { clearAllCachedObservables } = await import(
			"../../utils/getCachedObservable"
		);
		clearAllCachedObservables();
		return import("./accounts");
	};

	describe("injected wallets", () => {
		it("yields one account per Wallet Standard account", async () => {
			const standardWallet = createMockStandardWallet();
			const wallet = createMockInjectedWallet(standardWallet);
			const { getSolanaAccounts$ } = await importAccounts();

			const accounts = await firstValueFrom(
				getSolanaAccounts$(of([wallet]), "solana:mainnet"),
			);

			expect(accounts).toHaveLength(1);
			expect(accounts[0]?.platform).toBe("solana");
			expect(accounts[0]?.address).toBe(ADDRESS_1);
			expect(accounts[0]?.isWalletDefault).toBe(true);
			expect(typeof accounts[0]?.signer.modifyAndSignMessages).toBe("function");
			expect(typeof accounts[0]?.getSigner).toBe("function");
		});

		it("returns no accounts (and attaches no listener) when disconnected", async () => {
			const standardWallet = createMockStandardWallet();
			const wallet = createMockInjectedWallet(standardWallet, {
				isConnected: false,
			});
			const { getSolanaAccounts$ } = await importAccounts();

			const accounts = await firstValueFrom(
				getSolanaAccounts$(of([wallet]), "solana:mainnet"),
			);

			expect(accounts).toHaveLength(0);
			expect(standardWallet._changeListenerCount()).toBe(0);
		});

		it("re-emits accounts on a standard:events change", async () => {
			const standardWallet = createMockStandardWallet();
			const wallet = createMockInjectedWallet(standardWallet);
			const { getSolanaAccounts$ } = await importAccounts();

			const accounts$ = getSolanaAccounts$(of([wallet]), "solana:mainnet");
			const resultsPromise = firstValueFrom(accounts$.pipe(take(2), toArray()));

			await new Promise((r) => setTimeout(r, 10));

			standardWallet.accounts = [
				...standardWallet.accounts,
				{
					address: ADDRESS_2,
					publicKey: new Uint8Array(32),
					chains: ["solana:mainnet"],
					features: [],
				},
			];
			standardWallet._emitChange({ accounts: standardWallet.accounts });

			const results = await resultsPromise;
			expect(results[0]).toHaveLength(1);
			expect(results[1]).toHaveLength(2);
		});

		it("removes the change listener on teardown", async () => {
			const standardWallet = createMockStandardWallet();
			const wallet = createMockInjectedWallet(standardWallet);
			const { getSolanaAccounts$ } = await importAccounts();

			const sub = getSolanaAccounts$(
				of([wallet]),
				"solana:mainnet",
			).subscribe();
			await new Promise((r) => setTimeout(r, 10));

			expect(standardWallet._changeListenerCount()).toBe(1);

			sub.unsubscribe();

			expect(standardWallet._changeListenerCount()).toBe(0);
		});

		it("exposes a signer that delegates to the wallet's signMessage feature", async () => {
			const standardWallet = createMockStandardWallet();
			const wallet = createMockInjectedWallet(standardWallet);
			const { getSolanaAccounts$ } = await importAccounts();

			const accounts = await firstValueFrom(
				getSolanaAccounts$(of([wallet]), "solana:mainnet"),
			);
			const account = accounts[0];
			if (!account) throw new Error("expected an account");

			const [signed] = await account.signer.modifyAndSignMessages([
				createSignableMessage(new Uint8Array([1, 2, 3])),
			]);

			const signMessage = (
				standardWallet.features["solana:signMessage"] as {
					signMessage: ReturnType<typeof vi.fn>;
				}
			).signMessage;
			expect(signMessage).toHaveBeenCalled();
			const [signatureBytes] = Object.values(signed?.signatures ?? {});
			expect(signatureBytes).toBeInstanceOf(Uint8Array);
		});

		it("throws a descriptive error for an unsupported feature", async () => {
			const standardWallet = createMockStandardWallet();
			delete standardWallet.features["solana:signMessage"];
			const wallet = createMockInjectedWallet(standardWallet);
			const { getSolanaAccounts$ } = await importAccounts();

			const accounts = await firstValueFrom(
				getSolanaAccounts$(of([wallet]), "solana:mainnet"),
			);
			const account = accounts[0];
			if (!account) throw new Error("expected an account");

			await expect(
				account.signer.modifyAndSignMessages([
					createSignableMessage(new Uint8Array([1])),
				]),
			).rejects.toThrow(/does not support solana:signMessage/);
		});
	});

	describe("appKit (WalletConnect) wallets", () => {
		it("derives accounts from session namespaces, deduped across chains", async () => {
			const namespaces = {
				solana: {
					accounts: [
						`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${ADDRESS_1}`,
						// same address on another chain - should dedupe
						`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1:${ADDRESS_1}`,
						`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${ADDRESS_2}`,
					],
				},
			};
			const wallet = createMockAppKitWallet(namespaces);
			const { getSolanaAccounts$ } = await importAccounts();

			const accounts = await firstValueFrom(
				getSolanaAccounts$(of([wallet]), "solana:mainnet"),
			);

			expect(accounts.map((a) => a.address).sort()).toEqual(
				[ADDRESS_1, ADDRESS_2].sort(),
			);
			expect(accounts.every((a) => a.platform === "solana")).toBe(true);
		});

		it("re-derives accounts when the WalletConnect session updates", async () => {
			const namespaces = {
				solana: {
					accounts: [`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${ADDRESS_1}`],
				},
			};
			const wallet = createMockAppKitWallet(namespaces);
			const { getSolanaAccounts$ } = await importAccounts();

			const accounts$ = getSolanaAccounts$(of([wallet]), "solana:mainnet");
			const resultsPromise = firstValueFrom(accounts$.pipe(take(2), toArray()));

			await new Promise((r) => setTimeout(r, 10));

			const provider = (
				wallet.appKit.getProvider as unknown as () => {
					session: { namespaces: { solana: { accounts: string[] } } };
					_emit: (event: string, props?: unknown) => void;
				}
			)();
			provider.session.namespaces.solana.accounts.push(
				`solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp:${ADDRESS_2}`,
			);
			provider._emit("session_update");

			const results = await resultsPromise;
			expect(results[0]).toHaveLength(1);
			expect(results[1]).toHaveLength(2);
		});

		it("returns no accounts when the provider has no session", async () => {
			const wallet = createMockAppKitWallet({ solana: { accounts: [] } });
			(
				wallet.appKit.getProvider as unknown as ReturnType<typeof vi.fn>
			).mockReturnValue({ session: undefined });
			const { getSolanaAccounts$ } = await importAccounts();

			const accounts = await firstValueFrom(
				getSolanaAccounts$(of([wallet]), "solana:mainnet"),
			);

			expect(accounts).toHaveLength(0);
		});
	});
});
