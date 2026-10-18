import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getKheopskit$ } from "../kheopskit";
import { createKheopskitStore } from "../store";
import type { KheopskitState } from "../types";
import { polkadot } from "./plugin";

const account = (address: string, name: string) => ({
	address,
	name,
	type: "sr25519" as const,
	genesisHash: null,
});
type Listed = ReturnType<typeof account>;
const ALICE = account(
	"5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
	"Alice",
);
const BOB = account("5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty", "Bob");
const CHARLIE = account(
	"5FLSigC9HGRKVhB9FiEo4Y3koPsNmBmLJbpXg2mp1hXcS59Y",
	"Charlie",
);
const DAVE = account(
	"5DAAnrj7VHTznn2AWBemMuyBwZWs6FNFjdyVXUeYum3PTXFy",
	"Dave",
);

type Replay = "never" | "async";

const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const makeExtension = (initial: Listed[], replay: Replay) => {
	let current = initial;
	const listeners = new Set<(accounts: Listed[]) => void>();
	return {
		entry: {
			version: "1.0.0",
			enable: async () => ({
				accounts: {
					get: async () => current,
					subscribe: (cb: (accounts: Listed[]) => void) => {
						listeners.add(cb);
						if (replay === "async")
							setTimeout(() => {
								if (listeners.has(cb)) cb(current);
							}, 0);
						return () => {
							listeners.delete(cb);
						};
					},
				},
				signer: {
					signPayload: async () => ({ id: 1, signature: "0x" as const }),
					signRaw: async () => ({ id: 1, signature: "0x" as const }),
				},
			}),
		},
		change: (next: Listed[]) => {
			current = next;
			for (const cb of listeners) cb(next);
		},
	};
};

const namesOf = (state: KheopskitState, walletId: string) =>
	state.accounts
		.filter((a) => a.walletId === walletId)
		.map((a) => a.name)
		.sort()
		.join(",");

const frameOf = (state: KheopskitState) => ({
	a: namesOf(state, "polkadot:a"),
	b: namesOf(state, "polkadot:b"),
	bStatus: state.wallets.find((w) => w.id === "polkadot:b")?.status,
});

const start = () => {
	const store = createKheopskitStore();
	const emissions: KheopskitState[] = [];
	const subscription = getKheopskit$(
		{ platforms: [polkadot()], hydrationGracePeriod: 0 },
		{ store },
	).subscribe((state) => emissions.push(state));
	const wallet = (id: string) => {
		const found = emissions.at(-1)?.wallets.find((w) => w.id === id);
		if (!found) throw new Error(`no wallet ${id}`);
		return found;
	};
	return { store, emissions, subscription, wallet };
};

const untilDiscovered = async (emissions: KheopskitState[], count: number) => {
	for (let i = 0; i < 300; i++) {
		const last = emissions.at(-1);
		if (last && !last.isDiscovering && last.wallets.length >= count) return;
		await tick(5);
	}
	throw new Error("discovery never ended with the wallets listed");
};

const install = (a: Replay, b: Replay) => {
	const extensions = {
		a: makeExtension([ALICE, BOB], a),
		b: makeExtension([CHARLIE], b),
	};
	window.injectedWeb3 = { a: extensions.a.entry, b: extensions.b.entry };
	return extensions;
};

const cachedNamesOf = (store: ReturnType<typeof createKheopskitStore>) =>
	store
		.getCachedState()
		.accounts.filter((acc) => acc.walletId === "polkadot:a")
		.map((acc) => acc.name)
		.sort();

describe("a Polkadot account change after connect survives another wallet", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	afterEach(() => {
		delete window.injectedWeb3;
	});

	it.each<Replay>(["never", "async"])(
		"a removal stays removed across another wallet's connect and disconnect (extension replays on subscribe: %s)",
		async (replay) => {
			const { a } = install(replay, replay);
			const h = start();
			await untilDiscovered(h.emissions, 2);
			await h.wallet("polkadot:a").connect();
			await tick(20);
			a.change([ALICE]);
			await tick(20);

			const mark = h.emissions.length;
			await h.wallet("polkadot:b").connect();
			await tick(20);
			await h.wallet("polkadot:b").disconnect();
			await tick(1200);

			expect(h.emissions.slice(mark - 1).map(frameOf)).toEqual([
				{ a: "Alice", b: "", bStatus: "disconnected" },
				{ a: "Alice", b: "", bStatus: "connecting" },
				{ a: "Alice", b: "Charlie", bStatus: "connected" },
				{ a: "Alice", b: "", bStatus: "disconnected" },
			]);
			expect(cachedNamesOf(h.store)).toEqual(["Alice"]);
			h.subscription.unsubscribe();
		},
	);

	it.each<Replay>(["never", "async"])(
		"an addition stays added across another wallet's connect (extension replays on subscribe: %s)",
		async (replay) => {
			const { a } = install(replay, replay);
			const h = start();
			await untilDiscovered(h.emissions, 2);
			await h.wallet("polkadot:a").connect();
			await tick(20);
			a.change([ALICE, BOB, DAVE]);
			await tick(20);

			const mark = h.emissions.length;
			await h.wallet("polkadot:b").connect();
			await tick(20);

			expect(h.emissions.slice(mark - 1).map(frameOf)).toEqual([
				{ a: "Alice,Bob,Dave", b: "", bStatus: "disconnected" },
				{ a: "Alice,Bob,Dave", b: "", bStatus: "connecting" },
				{ a: "Alice,Bob,Dave", b: "Charlie", bStatus: "connected" },
			]);
			h.subscription.unsubscribe();
		},
	);
});
