/// <reference types="@testing-library/jest-dom/vitest" />
import {
	createKheopskitStore,
	type KheopskitError,
	type KheopskitState,
	type KheopskitStore,
	type WalletId,
} from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import {
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
	type FakePolkadotExtensionOptions,
} from "@kheopskit/core/testing";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
	type FC,
	Fragment,
	lazy,
	type PropsWithChildren,
	type ReactNode,
	StrictMode,
	Suspense,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import { firstValueFrom, type Subscription } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKheopskit } from "./createKheopskit";
import { useConnect } from "./useConnect";

describe("useConnect", () => {
	let fake: FakePolkadotExtension;
	let otherFake: FakePolkadotExtension | undefined;
	let store: KheopskitStore;
	let subscription: Subscription;

	afterEach(() => {
		subscription.unsubscribe();
		fake.uninstall();
		otherFake?.uninstall();
		otherFake = undefined;
		store.destroy();
		vi.useRealTimers();
	});

	const setup = async (
		enable: FakePolkadotExtensionOptions["enable"],
		Wrapper: FC<PropsWithChildren> = Fragment,
	) => {
		vi.useFakeTimers();
		fake = createFakePolkadotExtension({ name: "talisman", enable });
		store = createKheopskitStore({ storage: createMemoryStorage() });
		const instance = createKheopskit({ platforms: [polkadot()] }, { store });
		let latest: KheopskitState | undefined;
		subscription = instance.kheopskit$.subscribe((state) => {
			latest = state;
		});
		const outcomes: string[] = [];
		const ConnectButton = ({ walletId }: { walletId: WalletId }) => {
			const { connect, status, error } = useConnect(walletId);
			const renderedStatus = useRef(status);
			renderedStatus.current = status;
			return (
				<>
					<span data-testid="status">{status}</span>
					<span data-testid="error">{error?.code}</span>
					<button
						type="button"
						onClick={() =>
							connect().then(
								() => outcomes.push(`resolved:${renderedStatus.current}`),
								(error: KheopskitError) =>
									outcomes.push(`rejected:${error.code}`),
							)
						}
					>
						Connect
					</button>
				</>
			);
		};
		const app = (children?: ReactNode) => (
			<Wrapper>
				<instance.KheopskitProvider>
					<ConnectButton walletId={fake.walletId} />
					{children}
				</instance.KheopskitProvider>
			</Wrapper>
		);
		const view = render(app());
		const renderInside = (children?: ReactNode) => view.rerender(app(children));
		const settle = () => act(() => vi.advanceTimersByTimeAsync(5000));
		await settle();
		const walletStatus = (walletId: WalletId = fake.walletId) =>
			latest?.wallets.find((wallet) => wallet.id === walletId)?.status;
		const remembered = async () =>
			(await firstValueFrom(store.observable)).remembered ?? [];
		return { view, outcomes, settle, walletStatus, remembered, renderInside };
	};

	const record = (outcomes: string[]) => (connect: Promise<void>) =>
		connect.then(
			() => outcomes.push("resolved"),
			(error: KheopskitError) => outcomes.push(`rejected:${error.code}`),
		);

	const connectOnMount =
		(useMountEffect: typeof useEffect) =>
		({ outcomes }: { outcomes: string[] }) => {
			const { connect } = useConnect(fake.walletId);
			useMountEffect(() => {
				record(outcomes)(connect());
			}, [connect, outcomes]);
			return null;
		};
	const ConnectInLayoutEffect = connectOnMount(useLayoutEffect);
	const ConnectInEffect = connectOnMount(useEffect);

	const ChildConnectsInLayoutEffect = ({
		connect,
		outcomes,
	}: {
		connect: () => Promise<void>;
		outcomes: string[];
	}) => {
		useLayoutEffect(() => {
			record(outcomes)(connect());
		}, [connect, outcomes]);
		return null;
	};
	const ParentWithChild = ({ outcomes }: { outcomes: string[] }) => {
		const { connect } = useConnect(fake.walletId);
		return (
			<ChildConnectsInLayoutEffect connect={connect} outcomes={outcomes} />
		);
	};

	it("resolves a completed connect once the component renders it connected", async () => {
		const { outcomes, settle, remembered } = await setup("resolve");

		fireEvent.click(screen.getByText("Connect"));
		await settle();

		expect({
			outcomes,
			status: screen.getByTestId("status").textContent,
			remembered: await remembered(),
		}).toEqual({
			outcomes: ["resolved:connected"],
			status: "connected",
			remembered: ["polkadot:talisman"],
		});
	});

	it("connects under StrictMode, whose remount aborts nothing", async () => {
		const { outcomes, settle } = await setup("resolve", StrictMode);

		fireEvent.click(screen.getByText("Connect"));
		await settle();

		expect(outcomes).toEqual(["resolved:connected"]);
	});

	it("surfaces a refused connect as USER_REJECTED through error", async () => {
		const { outcomes, settle } = await setup("reject");

		fireEvent.click(screen.getByText("Connect"));
		await settle();

		expect({
			outcomes,
			status: screen.getByTestId("status").textContent,
			error: screen.getByTestId("error").textContent,
		}).toEqual({
			outcomes: ["rejected:USER_REJECTED"],
			status: "disconnected",
			error: "USER_REJECTED",
		});
	});

	it.each([
		["", Fragment, ["resolved"]],
		[" under StrictMode", StrictMode, ["resolved", "resolved"]],
	])(
		"connects from the component's own layout effect%s",
		async (_, Wrapper, expectedOutcomes) => {
			const { settle, walletStatus, remembered, renderInside } = await setup(
				"resolve",
				Wrapper,
			);
			const outcomes: string[] = [];

			renderInside(<ConnectInLayoutEffect outcomes={outcomes} />);
			await settle();

			expect({
				outcomes,
				status: walletStatus(),
				remembered: await remembered(),
			}).toEqual({
				outcomes: expectedOutcomes,
				status: "connected",
				remembered: ["polkadot:talisman"],
			});
		},
	);

	it.each([
		["", Fragment, ["resolved"]],
		[" under StrictMode", StrictMode, ["resolved", "resolved"]],
	])(
		"connects from a child's layout effect mounted in the same commit as the hook%s",
		async (_, Wrapper, expectedOutcomes) => {
			const { settle, walletStatus, remembered, renderInside } = await setup(
				"resolve",
				Wrapper,
			);
			const outcomes: string[] = [];

			renderInside(<ParentWithChild outcomes={outcomes} />);
			await settle();

			expect({
				outcomes,
				status: walletStatus(),
				remembered: await remembered(),
			}).toEqual({
				outcomes: expectedOutcomes,
				status: "connected",
				remembered: ["polkadot:talisman"],
			});
		},
	);

	it("connects from the component's passive effect under StrictMode", async () => {
		const { settle, walletStatus, remembered, renderInside } = await setup(
			"resolve",
			StrictMode,
		);
		const outcomes: string[] = [];

		renderInside(<ConnectInEffect outcomes={outcomes} />);
		await settle();

		expect({
			outcomes,
			status: walletStatus(),
			remembered: await remembered(),
		}).toEqual({
			outcomes: ["resolved", "resolved"],
			status: "connected",
			remembered: ["polkadot:talisman"],
		});
	});

	it("aborts a held connect when the component unmounts", async () => {
		const { view, outcomes, settle, walletStatus, remembered } =
			await setup("hold");

		fireEvent.click(screen.getByText("Connect"));
		await settle();
		const statusBeforeUnmount = screen.getByTestId("status").textContent;
		view.unmount();
		await settle();
		fake.resolveEnable();
		await settle();

		expect({
			statusBeforeUnmount,
			outcomes,
			status: walletStatus(),
			remembered: await remembered(),
		}).toEqual({
			statusBeforeUnmount: "connecting",
			outcomes: ["resolved:connecting"],
			status: "disconnected",
			remembered: [],
		});
	});

	it.each([
		["", Fragment, ["resolved"]],
		[" under StrictMode", StrictMode, ["resolved", "resolved"]],
	])(
		"aborts a connect started from a layout effect when the component unmounts%s",
		async (_, Wrapper, expectedOutcomes) => {
			const { settle, walletStatus, remembered, renderInside } = await setup(
				"hold",
				Wrapper,
			);
			const outcomes: string[] = [];

			renderInside(<ConnectInLayoutEffect outcomes={outcomes} />);
			await settle();
			const statusBeforeUnmount = walletStatus();
			renderInside();
			await settle();
			fake.resolveEnable();
			await settle();

			expect({
				statusBeforeUnmount,
				outcomes,
				status: walletStatus(),
				remembered: await remembered(),
			}).toEqual({
				statusBeforeUnmount: "connecting",
				outcomes: expectedOutcomes,
				status: "disconnected",
				remembered: [],
			});
		},
	);

	it.each([
		["", Fragment],
		[" under StrictMode", StrictMode],
	])(
		"rejects ABORTED a connect that starts after the component unmounts, without asking the wallet%s",
		async (_, Wrapper) => {
			const { settle, walletStatus, remembered, renderInside } = await setup(
				"resolve",
				Wrapper,
			);
			const outcomes: string[] = [];
			let resume = () => {};
			const resumed = new Promise<void>((resolve) => {
				resume = resolve;
			});
			const ResumingConnect = () => {
				const { connect } = useConnect(fake.walletId);
				return (
					<button
						type="button"
						onClick={() => record(outcomes)(resumed.then(connect))}
					>
						Connect later
					</button>
				);
			};

			renderInside(<ResumingConnect />);
			await settle();
			fireEvent.click(screen.getByText("Connect later"));
			renderInside();
			await settle();
			resume();
			await settle();

			expect({
				outcomes,
				enableCalls: fake.enableCalls().length,
				status: walletStatus(),
				remembered: await remembered(),
			}).toEqual({
				outcomes: ["rejected:ABORTED"],
				enableCalls: 0,
				status: "disconnected",
				remembered: [],
			});
		},
	);

	it("keeps a held connect while a lazy child shown on connecting suspends the boundary", async () => {
		const { settle, walletStatus, remembered, renderInside } =
			await setup("hold");
		const outcomes: string[] = [];
		let loadSpinner = () => {};
		const Spinner = lazy(
			() =>
				new Promise<{ default: FC }>((resolve) => {
					loadSpinner = () => resolve({ default: () => <span>spinner</span> });
				}),
		);
		const ConnectWithSpinner = () => {
			const { connect, status } = useConnect(fake.walletId);
			return (
				<>
					<button type="button" onClick={() => record(outcomes)(connect())}>
						Connect with spinner
					</button>
					{status === "connecting" ? <Spinner /> : null}
				</>
			);
		};

		renderInside(
			<Suspense fallback={<span>loading</span>}>
				<ConnectWithSpinner />
			</Suspense>,
		);
		await settle();
		fireEvent.click(screen.getByText("Connect with spinner"));
		await settle();
		const fallbackShown = screen.queryByText("loading") !== null;
		await act(async () => loadSpinner());
		await settle();
		fake.resolveEnable();
		await settle();

		expect({
			fallbackShown,
			outcomes,
			status: walletStatus(),
			remembered: await remembered(),
		}).toEqual({
			fallbackShown: true,
			outcomes: ["resolved"],
			status: "connected",
			remembered: ["polkadot:talisman"],
		});
	});

	it("aborts the pending connect when walletId changes and rejects ABORTED a connect captured before the change", async () => {
		otherFake = createFakePolkadotExtension({ name: "subwallet-js" });
		const { settle, walletStatus, remembered, renderInside } =
			await setup("hold");
		const outcomes: string[] = [];
		const staleErrors: string[] = [];
		const captured: { connect?: () => Promise<void> } = {};
		const Picker = ({ walletId }: { walletId: WalletId }) => {
			const { connect } = useConnect(walletId);
			captured.connect ??= connect;
			return (
				<button type="button" onClick={() => record(outcomes)(connect())}>
					Connect picked
				</button>
			);
		};

		renderInside(<Picker walletId={fake.walletId} />);
		await settle();
		fireEvent.click(screen.getByText("Connect picked"));
		await settle();
		const statusBeforeChange = walletStatus();
		renderInside(<Picker walletId={otherFake.walletId} />);
		await settle();
		fake.resolveEnable();
		await settle();
		await captured.connect?.().catch((error: KheopskitError) => {
			staleErrors.push(`${error.code}: ${error.message}`);
		});
		await settle();

		expect({
			statusBeforeChange,
			outcomes,
			staleErrors,
			enableCalls: fake.enableCalls().length,
			status: walletStatus(),
			otherStatus: walletStatus(otherFake.walletId),
			remembered: await remembered(),
		}).toEqual({
			statusBeforeChange: "connecting",
			outcomes: ["resolved"],
			staleErrors: [
				"ABORTED: [kheopskit] connect of wallet polkadot:talisman started after useConnect unmounted or switched wallet",
			],
			enableCalls: 1,
			status: "disconnected",
			otherStatus: "disconnected",
			remembered: [],
		});
	});

	it("rejects with an error naming an unknown wallet id", async () => {
		await setup("resolve");
		const outcomes: string[] = [];
		const Unknown = () => {
			const { connect } = useConnect("polkadot:missing");
			return (
				<button
					type="button"
					onClick={() =>
						connect().catch((error: Error) => outcomes.push(error.message))
					}
				>
					Connect missing
				</button>
			);
		};
		const instance = createKheopskit({ platforms: [polkadot()] }, { store });
		render(
			<instance.KheopskitProvider>
				<Unknown />
			</instance.KheopskitProvider>,
		);

		fireEvent.click(screen.getByText("Connect missing"));
		await act(() => vi.advanceTimersByTimeAsync(0));

		expect(outcomes).toEqual(["[kheopskit] no wallet polkadot:missing"]);
	});
});
