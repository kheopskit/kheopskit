import {
	createKheopskitStore,
	type KheopskitError,
	type KheopskitState,
	type KheopskitStore,
} from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import {
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
} from "@kheopskit/core/testing";
import { act, render, screen } from "@testing-library/react";
import { Activity } from "react";
import { firstValueFrom } from "rxjs";
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

describe("after an Activity hide stops the pipeline and a reveal restarts it", () => {
	let fake: FakePolkadotExtension;
	let store: KheopskitStore;

	beforeEach(() => {
		vi.useFakeTimers();
		fake = createFakePolkadotExtension({
			name: "talisman",
			accounts: [{ address: ALICE, name: "Alice" }],
		});
		store = createKheopskitStore({ storage: createMemoryStorage() });
	});

	afterEach(() => {
		fake.uninstall();
		store.destroy();
		vi.useRealTimers();
	});

	const setup = () => {
		const instance = createKheopskit({ platforms: [polkadot()] }, { store });
		const rendered: {
			wallet?: ReturnType<typeof instance.useWallet>;
			account?: ReturnType<typeof instance.useAccount>;
		} = {};
		const Consumer = () => {
			rendered.wallet = instance.useWallet(fake.walletId);
			rendered.account = instance.useAccount(`${fake.walletId}::${ALICE}`);
			return <span data-testid="status">{rendered.wallet?.status}</span>;
		};
		const app = (mode: "visible" | "hidden") => (
			<Activity mode={mode}>
				<instance.KheopskitProvider>
					<Consumer />
				</instance.KheopskitProvider>
			</Activity>
		);
		const view = render(app("visible"));
		const settle = () => act(() => vi.advanceTimersByTimeAsync(5000));
		const hideThenReveal = async () => {
			view.rerender(app("hidden"));
			await settle();
			view.rerender(app("visible"));
			await settle();
		};
		const remembered = async () =>
			(await firstValueFrom(store.observable)).remembered ?? [];
		return { rendered, settle, hideThenReveal, remembered };
	};

	it("useWallet's connect connects the wallet", async () => {
		const { rendered, settle, hideThenReveal, remembered } = setup();
		await settle();
		await hideThenReveal();
		const outcomes: string[] = [];
		await act(() =>
			rendered.wallet?.connect().then(
				() => outcomes.push("resolved"),
				(error: KheopskitError) => outcomes.push(`rejected:${error.code}`),
			),
		);
		await settle();

		expect(outcomes).toEqual(["resolved"]);
		expect(screen.getByTestId("status").textContent).toBe("connected");
		expect(await remembered()).toEqual([fake.walletId]);
	});

	it("useAccount's signRaw signs with the live extension handle", async () => {
		const { rendered, settle, hideThenReveal } = setup();
		await settle();
		await act(() => rendered.wallet?.connect());
		await settle();
		await hideThenReveal();
		const { account } = rendered;
		if (!account || account.isPlaceholder) throw new Error("no live account");
		await act(() => account.signRaw("hello"));

		expect(fake.signRawCalls()).toEqual([
			{ address: ALICE, data: "hello", type: "payload" },
		]);
	});
});
