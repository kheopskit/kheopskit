import { BehaviorSubject } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletId } from "../utils/WalletId";
import {
	createInjectedWallets$,
	type InjectedWalletsAdapter,
} from "./injectedWallets";
import { createKheopskitStore } from "./store";
import type { BaseWallet } from "./types";

type FakeSource = { name: string };

const walletId = "polkadot:fake" as WalletId;

const makeAdapter = (
	sources$: BehaviorSubject<FakeSource[]>,
	overrides: Partial<
		InjectedWalletsAdapter<FakeSource, BaseWallet, string>
	> = {},
): InjectedWalletsAdapter<FakeSource, BaseWallet, string> => ({
	sources$,
	getWalletId: () => walletId,
	connect: vi.fn().mockResolvedValue("handle"),
	buildWallet: ({ walletId, handle, isConnected, connect, disconnect }) => ({
		id: walletId,
		platform: "polkadot",
		type: "injected",
		name: `Fake ${handle ?? ""}`.trim(),
		icon: "",
		isConnected,
		connect,
		disconnect,
	}),
	...overrides,
});

const createDeferred = <T>() => {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
};

const settleMicrotasks = async () => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

type Settlement = "pending" | "resolved" | "rejected";

const settlementOf = async (promise: Promise<unknown>): Promise<Settlement> => {
	let state: Settlement = "pending";
	promise.then(
		() => {
			state = "resolved";
		},
		() => {
			state = "rejected";
		},
	);
	await settleMicrotasks();
	return state;
};

const rememberedWalletIds = (): string[] =>
	JSON.parse(localStorage.getItem("kheopskit") || "{}").autoReconnect ?? [];

const setup = (
	overrides: Partial<
		InjectedWalletsAdapter<FakeSource, BaseWallet, string>
	> = {},
) => {
	const store = createKheopskitStore();
	const sources$ = new BehaviorSubject<FakeSource[]>([{ name: "fake" }]);
	const adapter = makeAdapter(sources$, overrides);
	const wallets$ = createInjectedWallets$(store, adapter);
	const emissions: BaseWallet[][] = [];
	const sub = wallets$.subscribe((wallets) => emissions.push(wallets));
	const wallet = () => {
		const latest = emissions.at(-1)?.[0];
		if (!latest) throw new Error("no wallet emitted");
		return latest;
	};
	return { store, sources$, adapter, wallets$, emissions, sub, wallet };
};

describe("createInjectedWallets$", () => {
	beforeEach(() => {
		localStorage.clear();
	});

	it("emits disconnected wallets, then connected after connect()", async () => {
		const { emissions, sub, wallet } = setup();

		expect(emissions.at(-1)?.map((w) => w.isConnected)).toEqual([false]);

		await wallet().connect();

		expect(emissions.at(-1)?.map((w) => w.isConnected)).toEqual([true]);
		expect(rememberedWalletIds()).toContain(walletId);

		sub.unsubscribe();
	});

	it("concurrent connect calls share one platform connect", async () => {
		const deferred = createDeferred<string>();
		const connect = vi.fn(() => deferred.promise);
		const { sub, wallet } = setup({ connect });

		const first = wallet().connect();
		const second = wallet().connect();
		expect(connect).toHaveBeenCalledTimes(1);

		deferred.resolve("handle");
		await expect(Promise.all([first, second])).resolves.toEqual([
			undefined,
			undefined,
		]);
		expect(wallet().isConnected).toBe(true);
		expect(connect).toHaveBeenCalledTimes(1);

		sub.unsubscribe();
	});

	it("connect on a connected wallet and disconnect on a disconnected wallet resolve without calling the platform", async () => {
		const connect = vi.fn().mockResolvedValue("handle");
		const disconnect = vi.fn(async () => {});
		const { sub, wallet } = setup({ connect, disconnect });

		await wallet().connect();
		await expect(wallet().connect()).resolves.toBeUndefined();
		expect(connect).toHaveBeenCalledTimes(1);
		expect(wallet().isConnected).toBe(true);

		await wallet().disconnect();
		await expect(wallet().disconnect()).resolves.toBeUndefined();
		expect(disconnect).toHaveBeenCalledTimes(1);
		expect(wallet().isConnected).toBe(false);

		sub.unsubscribe();
	});

	it("abort rejects with ABORTED and a late handle never connects or remembers", async () => {
		const deferred = createDeferred<string>();
		const release = vi.fn();
		const { sub, wallet } = setup({ connect: () => deferred.promise, release });

		const controller = new AbortController();
		const pending = wallet().connect({ signal: controller.signal });
		controller.abort();
		deferred.resolve("late-handle");

		await expect(pending).rejects.toMatchObject({
			name: "KheopskitError",
			code: "ABORTED",
			walletId,
		});
		await settleMicrotasks();

		expect(wallet().isConnected).toBe(false);
		expect(rememberedWalletIds()).toEqual([]);
		expect(release).toHaveBeenCalledWith("late-handle", walletId);

		sub.unsubscribe();
	});

	it("an already aborted signal rejects without calling the platform", async () => {
		const connect = vi.fn().mockResolvedValue("handle");
		const { sub, wallet } = setup({ connect });

		const controller = new AbortController();
		controller.abort();
		await expect(
			wallet().connect({ signal: controller.signal }),
		).rejects.toMatchObject({ code: "ABORTED" });
		expect(connect).not.toHaveBeenCalled();

		sub.unsubscribe();
	});

	it("a connect aborted by one sharer rejects every sharer and a fresh connect asks the platform again", async () => {
		const first = createDeferred<string>();
		const second = createDeferred<string>();
		const connect = vi
			.fn<() => Promise<string>>()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const { sub, wallet } = setup({ connect });

		const controller = new AbortController();
		const sharerA = wallet().connect({ signal: controller.signal });
		const sharerB = wallet().connect();
		controller.abort();
		expect(await settlementOf(sharerA)).toBe("rejected");
		expect(await settlementOf(sharerB)).toBe("rejected");
		await expect(sharerA).rejects.toMatchObject({ code: "ABORTED" });
		await expect(sharerB).rejects.toMatchObject({ code: "ABORTED" });

		const retry = wallet().connect();
		expect(connect).toHaveBeenCalledTimes(2);
		second.resolve("handle-2");
		await expect(retry).resolves.toBeUndefined();
		expect(wallet().name).toBe("Fake handle-2");

		sub.unsubscribe();
	});

	it("disconnect during a pending connect aborts it", async () => {
		const deferred = createDeferred<string>();
		const release = vi.fn();
		const disconnect = vi.fn(async () => {});
		const { sub, wallet } = setup({
			connect: () => deferred.promise,
			disconnect,
			release,
		});

		const pending = wallet().connect();
		const disconnecting = wallet().disconnect();

		expect(await settlementOf(disconnecting)).toBe("resolved");
		await expect(pending).rejects.toMatchObject({ code: "ABORTED", walletId });
		expect(wallet().isConnected).toBe(false);

		deferred.resolve("late-handle");
		await settleMicrotasks();
		expect(wallet().isConnected).toBe(false);
		expect(rememberedWalletIds()).toEqual([]);
		expect(disconnect).not.toHaveBeenCalled();
		expect(release).toHaveBeenCalledWith("late-handle", walletId);

		sub.unsubscribe();
	});

	it("wraps platform rejections as USER_REJECTED or CONNECT_FAILED and lets a later connect retry", async () => {
		const refusal = new Error("Rejected");
		const failure = new Error("boom");
		const connect = vi
			.fn<() => Promise<string>>()
			.mockRejectedValueOnce(refusal)
			.mockRejectedValueOnce(failure)
			.mockResolvedValueOnce("handle");
		const { sub, wallet } = setup({
			connect,
			isUserRejection: (error) => error === refusal,
		});

		await expect(wallet().connect()).rejects.toMatchObject({
			name: "KheopskitError",
			code: "USER_REJECTED",
			walletId,
			cause: refusal,
		});
		await expect(wallet().connect()).rejects.toMatchObject({
			code: "CONNECT_FAILED",
			walletId,
			cause: failure,
		});
		expect(wallet().isConnected).toBe(false);
		expect(rememberedWalletIds()).toEqual([]);

		await expect(wallet().connect()).resolves.toBeUndefined();
		expect(wallet().isConnected).toBe(true);
		expect(connect).toHaveBeenCalledTimes(3);

		sub.unsubscribe();
	});

	it("tearing down the stream rejects a pending connect with ABORTED and releases the late handle", async () => {
		const deferred = createDeferred<string>();
		const release = vi.fn();
		const { sub, wallet, emissions } = setup({
			connect: () => deferred.promise,
			release,
		});

		const pending = wallet().connect();
		sub.unsubscribe();

		expect(await settlementOf(pending)).toBe("rejected");
		await expect(pending).rejects.toMatchObject({ code: "ABORTED", walletId });

		const emitted = emissions.length;
		deferred.resolve("late-handle");
		await settleMicrotasks();
		expect(emissions.length).toBe(emitted);
		expect(rememberedWalletIds()).toEqual([]);
		expect(release).toHaveBeenCalledWith("late-handle", walletId);
	});

	it("runs platform disconnect before clearing state and onDisconnected after", async () => {
		const calls: string[] = [];
		const { sub, wallet } = setup({
			disconnect: async () => {
				calls.push("platform-disconnect");
			},
			onDisconnected: () => calls.push("on-disconnected"),
		});

		await wallet().connect();
		await wallet().disconnect();

		expect(calls).toEqual(["platform-disconnect", "on-disconnected"]);
		expect(rememberedWalletIds()).not.toContain(walletId);

		sub.unsubscribe();
	});

	it("keeps the wallet connected when the platform disconnect fails", async () => {
		const failure = new Error("extension busy");
		const disconnect = vi.fn().mockRejectedValueOnce(failure);
		const { sub, wallet } = setup({ disconnect });

		await wallet().connect();
		await expect(wallet().disconnect()).rejects.toBe(failure);
		expect(wallet().isConnected).toBe(true);
		expect(rememberedWalletIds()).toContain(walletId);

		sub.unsubscribe();
	});

	it("exposes the connect handle to buildWallet while connected", async () => {
		const { sub, wallet } = setup();

		await wallet().connect();
		expect(wallet().name).toBe("Fake handle");

		sub.unsubscribe();
	});

	it("does not re-emit when the wallet list is unchanged", async () => {
		const { sub, sources$, emissions } = setup();

		sources$.next([{ name: "fake" }]);
		expect(emissions.length).toBe(1);

		sub.unsubscribe();
	});
});
