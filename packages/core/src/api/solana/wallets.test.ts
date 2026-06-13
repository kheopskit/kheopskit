import { firstValueFrom } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KheopskitStore } from "../store";
import type { KheopskitConfig } from "../types";
import type { SolanaWallet } from "./types";

type Listener = (...args: unknown[]) => void;

const { mockState, emitEvent } = vi.hoisted(() => {
	const state = {
		wallets: [] as unknown[],
		listeners: new Map<string, Set<Listener>>(),
	};
	return {
		mockState: state,
		emitEvent: (event: string, ...args: unknown[]) => {
			for (const cb of state.listeners.get(event) ?? []) cb(...args);
		},
	};
});

vi.mock("@wallet-standard/app", () => ({
	getWallets: () => ({
		get: () => mockState.wallets,
		on: (event: string, cb: Listener) => {
			let set = mockState.listeners.get(event);
			if (!set) {
				set = new Set();
				mockState.listeners.set(event, set);
			}
			set.add(cb);
			return () => set?.delete(cb);
		},
		register: () => () => {},
	}),
}));

const createMockStandardWallet = (name: string, solana = true) => ({
	version: "1.0.0",
	name,
	icon: "data:image/svg+xml;base64,AAAA",
	chains: solana ? ["solana:mainnet", "solana:devnet"] : ["eip155:1"],
	accounts: [],
	features: {
		"standard:connect": {
			version: "1.0.0",
			connect: vi.fn(async () => ({ accounts: [] })),
		},
		...(solana
			? { "solana:signMessage": { version: "1.0.0", signMessage: vi.fn() } }
			: {}),
	},
});

const config = { platforms: ["solana"] } as unknown as KheopskitConfig;
const mockStore = {
	addEnabledWalletId: vi.fn(),
	removeEnabledWalletId: vi.fn(),
} as unknown as KheopskitStore;

const importWallets = async () => import("./wallets");

beforeEach(() => {
	mockState.wallets = [];
	mockState.listeners = new Map();
	vi.clearAllMocks();
	vi.resetModules();
});

describe("getSolanaWallets$", () => {
	it("surfaces registered Solana wallets", async () => {
		mockState.wallets = [createMockStandardWallet("Phantom")];
		const { getSolanaWallets$ } = await importWallets();

		const wallets = await firstValueFrom(getSolanaWallets$(config, mockStore));

		expect(wallets).toHaveLength(1);
		expect(wallets[0]?.name).toBe("Phantom");
		expect(wallets[0]?.id).toBe("solana:Phantom");
		expect(wallets[0]?.platform).toBe("solana");
		expect(wallets[0]?.isConnected).toBe(false);
	});

	it("filters out non-Solana Wallet Standard wallets", async () => {
		mockState.wallets = [
			createMockStandardWallet("Phantom"),
			createMockStandardWallet("MetaMask", false),
		];
		const { getSolanaWallets$ } = await importWallets();

		const wallets = await firstValueFrom(getSolanaWallets$(config, mockStore));

		expect(wallets).toHaveLength(1);
		expect(wallets[0]?.name).toBe("Phantom");
	});

	it("re-emits when a wallet registers", async () => {
		const { getSolanaWallets$ } = await importWallets();

		const seen: number[] = [];
		const sub = getSolanaWallets$(config, mockStore).subscribe((w) =>
			seen.push(w.length),
		);

		await new Promise((r) => setTimeout(r, 10));

		mockState.wallets = [createMockStandardWallet("Phantom")];
		emitEvent("register", mockState.wallets[0]);

		await new Promise((r) => setTimeout(r, 10));
		sub.unsubscribe();

		expect(seen[0]).toBe(0);
		expect(seen.at(-1)).toBe(1);
	});

	it("connects a wallet via standard:connect and flips isConnected", async () => {
		const standardWallet = createMockStandardWallet("Phantom");
		mockState.wallets = [standardWallet];
		const { getSolanaWallets$ } = await importWallets();

		let latest: SolanaWallet[] = [];
		const sub = getSolanaWallets$(config, mockStore).subscribe((w) => {
			latest = w;
		});

		await new Promise((r) => setTimeout(r, 10));
		expect(latest[0]?.isConnected).toBe(false);

		await latest[0]?.connect();
		await new Promise((r) => setTimeout(r, 10));

		expect(
			standardWallet.features["standard:connect"].connect,
		).toHaveBeenCalled();
		expect(latest[0]?.isConnected).toBe(true);
		expect(mockStore.addEnabledWalletId).toHaveBeenCalledWith("solana:Phantom");

		sub.unsubscribe();
	});
});
