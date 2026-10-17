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
	type PropsWithChildren,
	type ReactNode,
	StrictMode,
	useLayoutEffect,
	useRef,
} from "react";
import { firstValueFrom, type Subscription } from "rxjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createKheopskit } from "./createKheopskit";
import { useConnect } from "./useConnect";

describe("useConnect", () => {
	let fake: FakePolkadotExtension;
	let store: KheopskitStore;
	let subscription: Subscription;

	afterEach(() => {
		subscription.unsubscribe();
		fake.uninstall();
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
		const walletStatus = () =>
			latest?.wallets.find((wallet) => wallet.id === fake.walletId)?.status;
		const remembered = async () =>
			(await firstValueFrom(store.observable)).remembered ?? [];
		return { view, outcomes, settle, walletStatus, remembered, renderInside };
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

	const ConnectOnMount = ({ outcomes }: { outcomes: string[] }) => {
		const { connect } = useConnect(fake.walletId);
		useLayoutEffect(() => {
			connect().then(
				() => outcomes.push("resolved"),
				(error: KheopskitError) => outcomes.push(`rejected:${error.code}`),
			);
		}, [connect, outcomes]);
		return null;
	};

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

			renderInside(<ConnectOnMount outcomes={outcomes} />);
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

	it("connects from a layout effect under StrictMode", async () => {
		const { settle, walletStatus, remembered, renderInside } = await setup(
			"resolve",
			StrictMode,
		);
		const outcomes: string[] = [];

		renderInside(<ConnectOnMount outcomes={outcomes} />);
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
						onClick={() =>
							resumed.then(connect).then(
								() => outcomes.push("resolved"),
								(error: KheopskitError) =>
									outcomes.push(`rejected:${error.code}`),
							)
						}
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
