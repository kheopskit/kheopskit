import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createFakePolkadotExtension } from "../../testing/fakePolkadotExtension";
import { kheopskitRun$ } from "../kheopskit";
import { createKheopskitStore } from "../store";
import type { KheopskitState } from "../types";
import { polkadot } from "./plugin";

const ALICE = {
	address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
	name: "Alice",
	type: "sr25519" as const,
};

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const installBrokenExtension = () => {
	window.injectedWeb3 ??= {};
	window.injectedWeb3.broken = {
		enable: async () => ({
			accounts: {
				get: async () => [],
				subscribe: () => {
					throw new Error("bridge stopped");
				},
			},
			signer: {
				signPayload: async () => ({ id: 1, signature: "0x" as const }),
				signRaw: async () => ({ id: 1, signature: "0x" as const }),
			},
		}),
	};
};

beforeEach(() => {
	localStorage.clear();
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	delete window.injectedWeb3;
	vi.restoreAllMocks();
});

it("an extension whose account subscription throws leaves kheopskit$ running with the other wallets' accounts", async () => {
	const healthy = createFakePolkadotExtension({
		name: "healthy",
		accounts: [ALICE],
	});
	installBrokenExtension();
	const emissions: KheopskitState[] = [];
	let failed: unknown;
	const subscription = kheopskitRun$(
		{ platforms: [polkadot()], hydrationGracePeriod: 0 },
		{ store: createKheopskitStore() },
	).subscribe({
		next: (state) => emissions.push(state),
		error: (error) => {
			failed = error;
		},
	});
	const wallet = (id: string) => {
		const found = emissions.at(-1)?.wallets.find((w) => w.id === id);
		if (!found) throw new Error(`no wallet ${id}`);
		return found;
	};
	for (let i = 0; i < 300 && emissions.at(-1)?.isDiscovering !== false; i++)
		await tick(5);

	await wallet(healthy.walletId).connect();
	await wallet("polkadot:broken").connect();
	await tick(20);
	healthy.setAccounts([{ ...ALICE, name: "Alice renamed" }]);
	await tick(20);

	expect(failed).toBeUndefined();
	expect(emissions.at(-1)?.accounts.map((a) => [a.walletId, a.name])).toEqual([
		[healthy.walletId, "Alice renamed"],
	]);
	subscription.unsubscribe();
	healthy.uninstall();
});
