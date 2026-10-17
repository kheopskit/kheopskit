import {
	createKheopskitStore,
	type KheopskitState,
	type KheopskitStore,
} from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import {
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
} from "@kheopskit/core/testing";
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKheopskit } from "./createKheopskit";

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const BOB = "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty";

describe("useWallet and useAccount", () => {
	let a: FakePolkadotExtension;
	let b: FakePolkadotExtension;
	let store: KheopskitStore;

	beforeEach(() => {
		vi.useFakeTimers();
		a = createFakePolkadotExtension({
			name: "a",
			enable: "hold",
			accounts: [{ address: ALICE, name: "Alice" }],
		});
		b = createFakePolkadotExtension({
			name: "b",
			accounts: [{ address: BOB, name: "Bob" }],
		});
		store = createKheopskitStore({ storage: createMemoryStorage() });
	});

	afterEach(() => {
		a.uninstall();
		b.uninstall();
		store.destroy();
		vi.useRealTimers();
	});

	const runScenario = async () => {
		const instance = createKheopskit({ platforms: [polkadot()] }, { store });
		const renders = {
			walletA: [] as (string | undefined)[],
			accountA: [] as (string | undefined)[],
			allWallets: [] as string[],
		};
		const WalletA = () => {
			renders.walletA.push(instance.useWallet("polkadot:a")?.status);
			return null;
		};
		const AccountA = () => {
			renders.accountA.push(instance.useAccount(`polkadot:a::${ALICE}`)?.name);
			return null;
		};
		const AllWallets = () => {
			renders.allWallets.push(
				instance
					.useWallets()
					.wallets.map((wallet) => `${wallet.name}:${wallet.status}`)
					.join(),
			);
			return null;
		};
		render(
			<instance.KheopskitProvider>
				<WalletA />
				<AccountA />
				<AllWallets />
			</instance.KheopskitProvider>,
		);
		const settle = () => act(() => vi.advanceTimersByTimeAsync(5000));
		const walletOf = (walletId: string) => {
			const wallet = latest?.wallets.find(({ id }) => id === walletId);
			if (!wallet) throw new Error(`no ${walletId}`);
			return wallet;
		};
		let latest: KheopskitState | undefined;
		const subscription = instance.kheopskit$.subscribe((state) => {
			latest = state;
		});
		const phases: Record<string, typeof renders> = {};
		const record = (phase: string) => {
			phases[phase] = structuredClone(renders);
		};

		await settle();
		record("discovered");
		await act(() => walletOf("polkadot:b").connect());
		await settle();
		record("b connected");
		let connectingA: Promise<void> | undefined;
		act(() => {
			connectingA = walletOf("polkadot:a").connect();
		});
		await settle();
		record("a connecting");
		a.resolveEnable();
		await act(async () => connectingA);
		await settle();
		record("a connected");
		b.setAccounts([{ address: BOB, name: "Bob 2" }]);
		await settle();
		record("b account renamed");
		a.setAccounts([{ address: ALICE, name: "Alice 2" }]);
		await settle();
		record("a account renamed");

		subscription.unsubscribe();
		return phases;
	};

	it("useWallet re-renders only when its wallet changes", async () => {
		const phases = await runScenario();

		expect(
			Object.fromEntries(
				Object.entries(phases).map(([phase, renders]) => [
					phase,
					renders.walletA,
				]),
			),
		).toEqual({
			discovered: [undefined, "disconnected"],
			"b connected": [undefined, "disconnected"],
			"a connecting": [undefined, "disconnected", "connecting"],
			"a connected": [undefined, "disconnected", "connecting", "connected"],
			"b account renamed": [
				undefined,
				"disconnected",
				"connecting",
				"connected",
			],
			"a account renamed": [
				undefined,
				"disconnected",
				"connecting",
				"connected",
			],
		});
	});

	it("useAccount re-renders only when its account changes", async () => {
		const phases = await runScenario();

		expect(phases["a connected"]?.accountA).toEqual([undefined, "Alice"]);
		expect(phases["b account renamed"]?.accountA).toEqual([undefined, "Alice"]);
		expect(phases["a account renamed"]?.accountA).toEqual([
			undefined,
			"Alice",
			"Alice 2",
		]);
	});

	it("useWallets re-renders on every change", async () => {
		const phases = await runScenario();

		expect(phases["a account renamed"]?.allWallets).toEqual([
			"",
			"a:disconnected,b:disconnected",
			"a:disconnected,b:connecting",
			"a:disconnected,b:connected",
			"a:connecting,b:connected",
			"a:connected,b:connected",
			"a:connected,b:connected",
			"a:connected,b:connected",
		]);
	});
});
