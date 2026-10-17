import {
	createKheopskitStore,
	type KheopskitError,
	type KheopskitStore,
} from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import {
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
} from "@kheopskit/core/testing";
import { act } from "@testing-library/react";
import {
	Activity,
	type ReactNode,
	startTransition,
	useEffect,
	useLayoutEffect,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { firstValueFrom } from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKheopskit } from "./createKheopskit";
import { useConnect } from "./useConnect";
import { useWallets } from "./useWallets";

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

type Mode = "visible" | "hidden";
type Reveal = "under act" | "in a transition outside act";
const reveals: Reveal[] = ["under act", "in a transition outside act"];

describe("actions reach the live pipeline after an Activity hide stops it and a reveal restarts it", () => {
	let fake: FakePolkadotExtension;
	let storage: ReturnType<typeof createMemoryStorage>;
	let store: KheopskitStore;
	let root: Root | undefined;
	let container: HTMLElement | undefined;

	beforeEach(() => {
		vi.useFakeTimers();
		fake = createFakePolkadotExtension({
			name: "talisman",
			accounts: [{ address: ALICE, name: "Alice" }],
		});
		storage = createMemoryStorage();
		store = createKheopskitStore({ storage });
	});

	afterEach(() => {
		if (root) act(() => root?.unmount());
		root = undefined;
		container?.remove();
		fake.uninstall();
		store.destroy();
		vi.useRealTimers();
	});

	const record = (outcomes: string[]) => (action: Promise<unknown>) =>
		action.then(
			() => outcomes.push("resolved"),
			(error: KheopskitError) => outcomes.push(`rejected:${error.code}`),
		);

	const setup = () => {
		const instance = createKheopskit({ platforms: [polkadot()] }, { store });
		const outcomes: string[] = [];
		const armed = { current: false };
		const mount = (app: ReactNode) => {
			container = document.body.appendChild(document.createElement("div"));
			root = createRoot(container);
			act(() => root?.render(app));
		};
		const settle = () => act(() => vi.advanceTimersByTimeAsync(5000));
		const revealOutsideAct = async (render: () => void) => {
			vi.useRealTimers();
			const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
			const actEnvironment = env.IS_REACT_ACT_ENVIRONMENT;
			env.IS_REACT_ACT_ENVIRONMENT = false;
			startTransition(render);
			for (let i = 0; i < 10; i++)
				await new Promise((resolve) => setTimeout(resolve, 30));
			env.IS_REACT_ACT_ENVIRONMENT = actEnvironment;
			vi.useFakeTimers();
		};
		const hideThenReveal = async (
			app: (mode: Mode) => ReactNode,
			reveal: Reveal,
		) => {
			act(() => root?.render(app("hidden")));
			await settle();
			armed.current = true;
			if (reveal === "under act") act(() => root?.render(app("visible")));
			else await revealOutsideAct(() => root?.render(app("visible")));
			await settle();
		};
		const status = async () =>
			(await firstValueFrom(instance.kheopskit$)).wallets.find(
				(wallet) => wallet.id === fake.walletId,
			)?.status;
		const remembered = async () =>
			(await firstValueFrom(store.observable)).remembered ?? [];
		const result = async () => ({
			outcomes,
			status: await status(),
			remembered: await remembered(),
			enableCalls: fake.enableCalls().length,
		});
		const connected = async () => ({
			outcomes: ["resolved"],
			status: "connected",
			remembered: [fake.walletId],
			enableCalls: 1,
		});
		return {
			instance,
			outcomes,
			armed,
			mount,
			settle,
			hideThenReveal,
			result,
			connected,
			remembered,
		};
	};

	const providerUnderActivity =
		(instance: ReturnType<typeof setup>["instance"], children: ReactNode) =>
		(mode: Mode) => (
			<Activity mode={mode}>
				<instance.KheopskitProvider>{children}</instance.KheopskitProvider>
			</Activity>
		);

	describe.each(reveals)("revealed %s", (reveal) => {
		it("useWallet's connect from a layout effect", async () => {
			const t = setup();
			const Caller = () => {
				const wallet = t.instance.useWallet(fake.walletId);
				useLayoutEffect(() => {
					if (t.armed.current)
						record(t.outcomes)(
							wallet?.connect() ?? Promise.reject("no wallet"),
						);
					t.armed.current = false;
				});
				return null;
			};
			const app = providerUnderActivity(t.instance, <Caller />);
			t.mount(app("visible"));
			await t.settle();
			await t.hideThenReveal(app, reveal);

			expect(await t.result()).toEqual(await t.connected());
		});

		it("useConnect's connect from a layout effect", async () => {
			const t = setup();
			const Caller = () => {
				const { connect } = useConnect(fake.walletId);
				useLayoutEffect(() => {
					if (t.armed.current) record(t.outcomes)(connect());
					t.armed.current = false;
				});
				return null;
			};
			const app = providerUnderActivity(t.instance, <Caller />);
			t.mount(app("visible"));
			await t.settle();
			await t.hideThenReveal(app, reveal);

			expect(await t.result()).toEqual(await t.connected());
		});

		it("useWallets' wallet connect from a layout effect", async () => {
			const t = setup();
			const Caller = () => {
				const wallet = useWallets().wallets.find(
					(candidate) => candidate.id === fake.walletId,
				);
				useLayoutEffect(() => {
					if (t.armed.current)
						record(t.outcomes)(
							wallet?.connect() ?? Promise.reject("no wallet"),
						);
					t.armed.current = false;
				});
				return null;
			};
			const app = providerUnderActivity(t.instance, <Caller />);
			t.mount(app("visible"));
			await t.settle();
			await t.hideThenReveal(app, reveal);

			expect(await t.result()).toEqual(await t.connected());
		});
	});

	it("useConnect's connect-on-mount effect, re-run by the reveal", async () => {
		const t = setup();
		const Caller = () => {
			const { connect } = useConnect(fake.walletId);
			useEffect(() => {
				if (t.armed.current) record(t.outcomes)(connect());
				t.armed.current = false;
			}, [connect]);
			return null;
		};
		const app = providerUnderActivity(t.instance, <Caller />);
		t.mount(app("visible"));
		await t.settle();
		await t.hideThenReveal(app, "under act");

		expect(await t.result()).toEqual(await t.connected());
	});

	it("useWallet's disconnect from a layout effect", async () => {
		const t = setup();
		const api: { connect?: () => Promise<void> } = {};
		const Caller = () => {
			const wallet = t.instance.useWallet(fake.walletId);
			api.connect = wallet?.connect;
			useLayoutEffect(() => {
				if (t.armed.current)
					record(t.outcomes)(
						wallet?.disconnect() ?? Promise.reject("no wallet"),
					);
				t.armed.current = false;
			});
			return null;
		};
		const app = providerUnderActivity(t.instance, <Caller />);
		t.mount(app("visible"));
		await t.settle();
		await act(() => api.connect?.());
		await t.settle();
		await t.hideThenReveal(app, "under act");

		expect(await t.result()).toEqual({
			outcomes: ["resolved"],
			status: "disconnected",
			remembered: [],
			enableCalls: 2,
		});
	});

	it("useAccount's signRaw from a layout effect reaches the extension", async () => {
		const t = setup();
		const api: { connect?: () => Promise<void> } = {};
		const Caller = () => {
			const wallet = t.instance.useWallet(fake.walletId);
			const account = t.instance.useAccount(`${fake.walletId}::${ALICE}`);
			api.connect = wallet?.connect;
			useLayoutEffect(() => {
				if (t.armed.current && account && !account.isPlaceholder)
					record(t.outcomes)(account.signRaw("hello"));
				t.armed.current = false;
			});
			return null;
		};
		const app = providerUnderActivity(t.instance, <Caller />);
		t.mount(app("visible"));
		await t.settle();
		await act(() => api.connect?.());
		await t.settle();
		await t.hideThenReveal(app, "under act");

		expect({ outcomes: t.outcomes, signRawCalls: fake.signRawCalls() }).toEqual(
			{
				outcomes: ["resolved"],
				signRawCalls: [{ address: ALICE, data: "hello", type: "payload" }],
			},
		);
	});

	it.each([
		[
			"useConnect",
			(t: ReturnType<typeof setup>, api: { connect?: () => Promise<void> }) => {
				const Caller = () => {
					api.connect = useConnect(fake.walletId).connect;
					return null;
				};
				return providerUnderActivity(t.instance, <Caller />);
			},
		],
		[
			"useWallet",
			(t: ReturnType<typeof setup>, api: { connect?: () => Promise<void> }) => {
				const Caller = () => {
					api.connect = t.instance.useWallet(fake.walletId)?.connect;
					return null;
				};
				return providerUnderActivity(t.instance, <Caller />);
			},
		],
	])(
		"a click right after the reveal commit, before the restarted pipeline's first emission (%s)",
		async (_, build) => {
			const t = setup();
			const api: { connect?: () => Promise<void> } = {};
			const app = build(t, api);
			t.mount(app("visible"));
			await t.settle();
			act(() => root?.render(app("hidden")));
			await t.settle();
			act(() => root?.render(app("visible")));
			record(t.outcomes)(api.connect?.() ?? Promise.reject("no wallet"));
			await t.settle();

			expect(await t.result()).toEqual(await t.connected());
		},
	);

	it("useConnect's connect during the gap resolves without connecting when the component is hidden again first", async () => {
		const t = setup();
		const api: { connect?: () => Promise<void> } = {};
		const Caller = () => {
			api.connect = useConnect(fake.walletId).connect;
			return null;
		};
		const app = providerUnderActivity(t.instance, <Caller />);
		t.mount(app("visible"));
		await t.settle();
		act(() => root?.render(app("hidden")));
		await t.settle();
		act(() => root?.render(app("visible")));
		record(t.outcomes)(api.connect?.() ?? Promise.reject("no wallet"));
		act(() => root?.render(app("hidden")));
		await t.settle();
		act(() => root?.render(app("visible")));
		await t.settle();

		expect(await t.result()).toEqual({
			outcomes: ["resolved"],
			status: "disconnected",
			remembered: [],
			enableCalls: 0,
		});
	});

	it("a call after a real provider unmount rejects ABORTED and restarts no pipeline", async () => {
		const t = setup();
		const api: { connect?: () => Promise<void> } = {};
		const Caller = () => {
			api.connect = t.instance.useWallet(fake.walletId)?.connect;
			return null;
		};
		t.mount(
			<t.instance.KheopskitProvider>
				<Caller />
			</t.instance.KheopskitProvider>,
		);
		await t.settle();
		act(() => root?.unmount());
		root = undefined;
		await t.settle();
		const writes = vi.spyOn(storage, "setItem");
		const messages: string[] = [];
		await api.connect?.().catch((error: KheopskitError) => {
			messages.push(`${error.code}: ${error.message}`);
		});
		await t.settle();

		expect({
			messages,
			enableCalls: fake.enableCalls().length,
			writes: writes.mock.calls.length,
			remembered: await t.remembered(),
		}).toEqual({
			messages: [
				"ABORTED: [kheopskit] connect of wallet polkadot:talisman was called while no KheopskitProvider holds the pipeline (unmounted or hidden)",
			],
			enableCalls: 0,
			writes: 0,
			remembered: [],
		});
	});

	it("keeps the wallet's identity across a reveal while another provider keeps the pipeline alive", async () => {
		const t = setup();
		const seen: object[] = [];
		const api: { connect?: () => Promise<void> } = {};
		const Caller = () => {
			const wallet = t.instance.useWallet(fake.walletId);
			if (wallet && !seen.includes(wallet)) seen.push(wallet);
			api.connect = wallet?.connect;
			return null;
		};
		const app = (mode: Mode) => (
			<>
				<t.instance.KheopskitProvider>
					<span />
				</t.instance.KheopskitProvider>
				<Activity mode={mode}>
					<t.instance.KheopskitProvider>
						<Caller />
					</t.instance.KheopskitProvider>
				</Activity>
			</>
		);
		t.mount(app("visible"));
		await t.settle();
		const objectsBeforeHide = seen.length;
		await t.hideThenReveal(app, "under act");
		const objectsAfterReveal = seen.length;
		record(t.outcomes)(api.connect?.() ?? Promise.reject("no wallet"));
		await t.settle();

		expect({ objectsAfterReveal, ...(await t.result()) }).toEqual({
			objectsAfterReveal: objectsBeforeHide,
			...(await t.connected()),
		});
	});
});
