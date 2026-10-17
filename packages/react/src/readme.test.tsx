import { createKheopskitStore, type KheopskitStore } from "@kheopskit/core";
import { polkadot } from "@kheopskit/core/polkadot";
import {
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
} from "@kheopskit/core/testing";
import { createKheopskit, useConnect } from "@kheopskit/react";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let talisman: FakePolkadotExtension;
let store: KheopskitStore;

beforeEach(() => {
	vi.useFakeTimers();
	talisman = createFakePolkadotExtension({ name: "talisman" });
	store = createKheopskitStore({ storage: createMemoryStorage() });
});

afterEach(() => {
	cleanup();
	talisman.uninstall();
	store.destroy();
	vi.useRealTimers();
});

const ConnectButton = () => {
	const { connect, status } = useConnect("polkadot:talisman");
	return (
		<button type="button" onClick={connect}>
			{status}
		</button>
	);
};

it("connects the wallet the user picks", async () => {
	const { KheopskitProvider } = createKheopskit(
		{ platforms: [polkadot()] },
		{ store },
	);
	render(
		<KheopskitProvider>
			<ConnectButton />
		</KheopskitProvider>,
	);
	await act(() => vi.advanceTimersByTimeAsync(1000));

	fireEvent.click(screen.getByRole("button"));
	await act(() => vi.advanceTimersByTimeAsync(1000));

	expect(screen.getByRole("button").textContent).toBe("connected");
	expect(talisman.enableCalls()).toHaveLength(1);
});
