import {
	type ConnectOptions,
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
import { act } from "@testing-library/react";
import {
	Activity,
	type ReactNode,
	startTransition,
	useEffect,
	useLayoutEffect,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import {
	firstValueFrom,
	config as rxjsConfig,
	Subject,
	type Subscription,
} from "rxjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKheopskit } from "./createKheopskit";
import { KheopskitSourceProvider } from "./KheopskitSourceProvider";
import { createLivePipeline } from "./livePipeline";
import { useConnect } from "./useConnect";
import { useWallet } from "./useWallet";
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
	let outside: Subscription | undefined;

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
		outside?.unsubscribe();
		outside = undefined;
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

	it("useWallet's connect during the gap rejects ABORTED when the provider is hidden again before the first emission", async () => {
		const t = setup();
		const api: { connect?: () => Promise<void> } = {};
		const Caller = () => {
			api.connect = t.instance.useWallet(fake.walletId)?.connect;
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

		expect({
			outcomes: t.outcomes,
			enableCalls: fake.enableCalls().length,
			remembered: await t.remembered(),
		}).toEqual({
			outcomes: ["rejected:ABORTED"],
			enableCalls: 0,
			remembered: [],
		});
	});

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
				"ABORTED: [kheopskit] connect of wallet polkadot:talisman was called while nothing holds the pipeline (no KheopskitProvider of this instance is mounted and visible, and nothing subscribes its kheopskit$)",
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

	type Api = {
		connect?: (options?: ConnectOptions) => Promise<void>;
		disconnect?: () => Promise<void>;
		listConnect?: () => Promise<void>;
		hookConnect?: () => Promise<void>;
		hookDisconnect?: () => Promise<void>;
	};

	const captureEveryAction = (t: ReturnType<typeof setup>, api: Api) => {
		const Consumer = () => {
			const wallet = t.instance.useWallet(fake.walletId);
			api.connect = wallet?.connect;
			api.disconnect = wallet?.disconnect;
			api.listConnect = useWallets().wallets.find(
				(candidate) => candidate.id === fake.walletId,
			)?.connect;
			const hook = useConnect(fake.walletId);
			api.hookConnect = hook.connect;
			api.hookDisconnect = hook.disconnect;
			return null;
		};
		return <Consumer />;
	};

	describe("while something else holds the shared instance's pipeline", () => {
		type Scene = (
			t: ReturnType<typeof setup>,
			consumer: ReactNode,
		) => { mount: () => void; leave: () => void };

		const scenes: [string, Scene][] = [
			[
				"a sibling provider, after the consumer's provider unmounts",
				(t, consumer) => {
					const app = (consumerMounted: boolean) => (
						<>
							{consumerMounted && (
								<t.instance.KheopskitProvider>
									{consumer}
								</t.instance.KheopskitProvider>
							)}
							<t.instance.KheopskitProvider>
								<span />
							</t.instance.KheopskitProvider>
						</>
					);
					return {
						mount: () => t.mount(app(true)),
						leave: () => act(() => root?.render(app(false))),
					};
				},
			],
			[
				"a visible sibling provider, while the consumer's provider is hidden",
				(t, consumer) => {
					const app = (mode: Mode) => (
						<>
							<t.instance.KheopskitProvider>
								<span />
							</t.instance.KheopskitProvider>
							<Activity mode={mode}>
								<t.instance.KheopskitProvider>
									{consumer}
								</t.instance.KheopskitProvider>
							</Activity>
						</>
					);
					return {
						mount: () => t.mount(app("visible")),
						leave: () => act(() => root?.render(app("hidden"))),
					};
				},
			],
			[
				"an outside kheopskit$ subscriber, while the only provider is hidden",
				(t, consumer) => {
					const app = providerUnderActivity(t.instance, consumer);
					return {
						mount: () => {
							outside = t.instance.kheopskit$.subscribe();
							t.mount(app("visible"));
						},
						leave: () => act(() => root?.render(app("hidden"))),
					};
				},
			],
		];

		describe.each(scenes)("held by %s", (_, scene) => {
			it.each([
				["useWallet's connect", (api: Api) => api.connect],
				["useWallets' wallet connect", (api: Api) => api.listConnect],
			])("%s connects through it", async (_, pick) => {
				const t = setup();
				const api: Api = {};
				const { mount, leave } = scene(t, captureEveryAction(t, api));
				mount();
				await t.settle();
				const action = pick(api);
				leave();
				await t.settle();
				record(t.outcomes)(action?.() ?? Promise.reject("no wallet"));
				await t.settle();

				expect(await t.result()).toEqual(await t.connected());
			});

			it.each([
				["useWallet's disconnect", (api: Api) => api.disconnect],
				["useConnect's disconnect", (api: Api) => api.hookDisconnect],
			])("%s disconnects through it", async (_, pick) => {
				const t = setup();
				const api: Api = {};
				const { mount, leave } = scene(t, captureEveryAction(t, api));
				mount();
				await t.settle();
				await act(() => api.connect?.());
				await t.settle();
				const action = pick(api);
				leave();
				await t.settle();
				record(t.outcomes)(action?.() ?? Promise.reject("no wallet"));
				await t.settle();

				expect(await t.result()).toEqual({
					outcomes: ["resolved"],
					status: "disconnected",
					remembered: [],
					enableCalls: 1,
				});
			});

			it("useConnect's connect stays scoped to its component and rejects ABORTED", async () => {
				const t = setup();
				const api: Api = {};
				const { mount, leave } = scene(t, captureEveryAction(t, api));
				mount();
				await t.settle();
				const { hookConnect } = api;
				leave();
				await t.settle();
				const messages: string[] = [];
				await hookConnect?.().catch((error: KheopskitError) => {
					messages.push(`${error.code}: ${error.message}`);
				});
				await t.settle();

				expect({ messages, enableCalls: fake.enableCalls().length }).toEqual({
					messages: [
						"ABORTED: [kheopskit] connect of wallet polkadot:talisman started after useConnect unmounted or switched wallet",
					],
					enableCalls: 0,
				});
			});
		});
	});

	describe("around the gap between a reveal and the restarted pipeline's first emission", () => {
		const pipelineRunning = (t: ReturnType<typeof setup>) => {
			let emittedOnSubscribe = false;
			t.instance.kheopskit$
				.subscribe(() => {
					emittedOnSubscribe = true;
				})
				.unsubscribe();
			return emittedOnSubscribe;
		};

		const revealWithoutSettling = async (app: (mode: Mode) => ReactNode) => {
			act(() => root?.render(app("hidden")));
			await act(() => vi.advanceTimersByTimeAsync(5000));
			act(() => root?.render(app("visible")));
		};

		it("a reveal, an immediate hide before the first emission, then a reveal with a layout-effect connect", async () => {
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
			await revealWithoutSettling(app);
			act(() => root?.render(app("hidden")));
			await t.settle();
			const runningWhileHidden = pipelineRunning(t);
			t.armed.current = true;
			act(() => root?.render(app("visible")));
			await t.settle();
			const result = await t.result();
			act(() => root?.unmount());
			root = undefined;
			await t.settle();

			expect({
				runningWhileHidden,
				...result,
				runningAfterUnmount: pipelineRunning(t),
			}).toEqual({
				runningWhileHidden: false,
				...(await t.connected()),
				runningAfterUnmount: false,
			});
		});

		it.each([
			["useWallet's disconnect", (api: Api) => api.disconnect],
			["useConnect's disconnect", (api: Api) => api.hookDisconnect],
		])(
			"%s in the gap disconnects once the restarted pipeline emits",
			async (_, pick) => {
				const t = setup();
				const api: Api = {};
				const app = providerUnderActivity(
					t.instance,
					captureEveryAction(t, api),
				);
				t.mount(app("visible"));
				await t.settle();
				await act(() => api.connect?.());
				await t.settle();
				await revealWithoutSettling(app);
				record(t.outcomes)(pick(api)?.() ?? Promise.reject("no wallet"));
				await t.settle();

				expect(await t.result()).toEqual({
					outcomes: ["resolved"],
					status: "disconnected",
					remembered: [],
					enableCalls: 2,
				});
			},
		);

		it("two item connects and a useConnect connect in the gap all resolve with one enable call", async () => {
			const t = setup();
			const api: Api = {};
			const app = providerUnderActivity(t.instance, captureEveryAction(t, api));
			t.mount(app("visible"));
			await t.settle();
			await revealWithoutSettling(app);
			record(t.outcomes)(api.connect?.() ?? Promise.reject("no wallet"));
			record(t.outcomes)(api.connect?.() ?? Promise.reject("no wallet"));
			record(t.outcomes)(api.hookConnect?.() ?? Promise.reject("no wallet"));
			await t.settle();

			expect(await t.result()).toEqual({
				...(await t.connected()),
				outcomes: ["resolved", "resolved", "resolved"],
			});
		});

		it("a hide during a pending wait rejects ABORTED even with an unaborted user signal", async () => {
			const t = setup();
			const api: Api = {};
			const app = providerUnderActivity(t.instance, captureEveryAction(t, api));
			t.mount(app("visible"));
			await t.settle();
			await revealWithoutSettling(app);
			const controller = new AbortController();
			record(t.outcomes)(
				api.connect?.({ signal: controller.signal }) ??
					Promise.reject("no wallet"),
			);
			act(() => root?.render(app("hidden")));
			await t.settle();

			expect({
				outcomes: t.outcomes,
				signalAborted: controller.signal.aborted,
				enableCalls: fake.enableCalls().length,
				remembered: await t.remembered(),
			}).toEqual({
				outcomes: ["rejected:ABORTED"],
				signalAborted: false,
				enableCalls: 0,
				remembered: [],
			});
		});

		it("a real unmount during a pending wait settles every call and leaves nothing running", async () => {
			const t = setup();
			const api: Api = {};
			const app = providerUnderActivity(t.instance, captureEveryAction(t, api));
			t.mount(app("visible"));
			await t.settle();
			await revealWithoutSettling(app);
			const item: string[] = [];
			const hook: string[] = [];
			const settled = Promise.all([
				record(item)(api.connect?.() ?? Promise.reject("no wallet")),
				record(hook)(api.hookConnect?.() ?? Promise.reject("no wallet")),
			]);
			act(() => root?.unmount());
			root = undefined;
			await t.settle();
			await settled;

			expect({
				item,
				hook,
				enableCalls: fake.enableCalls().length,
				remembered: await t.remembered(),
				runningAfterUnmount: pipelineRunning(t),
			}).toEqual({
				item: ["rejected:ABORTED"],
				hook: ["resolved"],
				enableCalls: 0,
				remembered: [],
				runningAfterUnmount: false,
			});
		});
	});
});

describe("an action pending on a pipeline that ends before its first emission", () => {
	const walletId = "polkadot:talisman" as const;
	const stateWithWallet = (connect: () => Promise<void>) =>
		({
			wallets: [{ id: walletId, status: "disconnected", connect }],
			accounts: [],
			isHydrating: false,
			isDiscovering: false,
		}) as unknown as KheopskitState;

	const providerConfig = { platforms: [polkadot()] };

	const mountOnSubject = () => {
		const subject = new Subject<KheopskitState>();
		const store = createKheopskitStore({ storage: createMemoryStorage() });
		const resolveClientSource = () => ({
			store,
			pipeline: createLivePipeline(subject),
		});
		const api: { connect?: () => Promise<void> } = {};
		const Consumer = () => {
			api.connect = useWallet(walletId)?.connect;
			return null;
		};
		const app = (mode: Mode) => (
			<Activity mode={mode}>
				<KheopskitSourceProvider
					config={providerConfig}
					ssrCookies={undefined}
					resolveClientSource={resolveClientSource}
				>
					<Consumer />
				</KheopskitSourceProvider>
			</Activity>
		);
		const root = createRoot(
			document.body.appendChild(document.createElement("div")),
		);
		return { subject, api, app, root, store };
	};

	const reported: unknown[] = [];
	beforeEach(() => {
		rxjsConfig.onUnhandledError = (error) => reported.push(error);
	});
	afterEach(() => {
		rxjsConfig.onUnhandledError = null;
		reported.length = 0;
	});

	it.each([
		[
			"errors",
			(subject: Subject<KheopskitState>) => subject.error(new Error("boom")),
			"did not run because the pipeline stopped with an error",
		],
		[
			"completes",
			(subject: Subject<KheopskitState>) => subject.complete(),
			"did not run because the pipeline completed",
		],
	])(
		"rejects ABORTED when the restarted pipeline %s, and so does a later call",
		async (ending, finish, reason) => {
			const { subject, api, app, root, store } = mountOnSubject();
			const platformConnect = vi.fn(async () => {});
			act(() => root.render(app("visible")));
			act(() => subject.next(stateWithWallet(platformConnect)));
			const { connect } = api;
			act(() => root.render(app("hidden")));
			await act(async () => {});
			act(() => root.render(app("visible")));
			const messages: string[] = [];
			const read = (error: KheopskitError) => {
				messages.push(`${error.code}: ${error.message}`);
			};
			connect?.().catch(read);
			await act(async () => {});
			const settledBeforeEnd = messages.length;
			act(() => finish(subject));
			await act(async () => {});
			connect?.().catch(read);
			await act(async () => {});
			await new Promise((resolve) => setTimeout(resolve, 0));
			act(() => root.unmount());
			store.destroy();

			expect({
				settledBeforeEnd,
				messages,
				platformConnectCalls: platformConnect.mock.calls.length,
				reportedErrors: reported.map((error) => String(error)),
			}).toEqual({
				settledBeforeEnd: 0,
				messages: [
					`ABORTED: [kheopskit] connect of wallet ${walletId} ${reason}`,
					`ABORTED: [kheopskit] connect of wallet ${walletId} ${reason}`,
				],
				platformConnectCalls: 0,
				reportedErrors: ending === "errors" ? ["Error: boom"] : [],
			});
		},
	);
});
