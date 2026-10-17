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
	JSON.parse(localStorage.getItem("kheopskit") || "{}").remembered ?? [];

const capReentries = (disconnecting: Promise<void>, limit: number) => {
	const then = disconnecting.then.bind(disconnecting);
	const waits = vi
		.spyOn(disconnecting, "then")
		.mockImplementation((...args) => {
			if (waits.mock.calls.length > limit)
				throw new Error(
					`connect re-entered the settled disconnect ${limit} times`,
				);
			return then(...args);
		});
};

const setup = (
	overrides: Partial<
		InjectedWalletsAdapter<FakeSource, BaseWallet, string>
	> = {},
	store = createKheopskitStore(),
) => {
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
		const releaseAbandonedHandle = vi.fn();
		const { sub, wallet } = setup({
			connect: () => deferred.promise,
			releaseAbandonedHandle,
		});

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
		expect(releaseAbandonedHandle).toHaveBeenCalledWith(
			"late-handle",
			walletId,
		);

		sub.unsubscribe();
	});

	it("an already aborted signal rejects without calling the platform or disturbing a pending connect", async () => {
		const deferred = createDeferred<string>();
		const connect = vi.fn(() => deferred.promise);
		const { sub, wallet } = setup({ connect });

		const controller = new AbortController();
		controller.abort();
		await expect(
			wallet().connect({ signal: controller.signal }),
		).rejects.toMatchObject({ code: "ABORTED" });
		expect(connect).not.toHaveBeenCalled();

		const pending = wallet().connect();
		await expect(
			wallet().connect({ signal: controller.signal }),
		).rejects.toMatchObject({ code: "ABORTED" });
		expect(connect).toHaveBeenCalledTimes(1);
		deferred.resolve("handle");
		await expect(pending).resolves.toBeUndefined();
		expect(wallet().isConnected).toBe(true);

		sub.unsubscribe();
	});

	it("a sharer's abort rejects only its own promise; the attempt survives while another sharer remains", async () => {
		const deferred = createDeferred<string>();
		const connect = vi.fn(() => deferred.promise);
		const releaseAbandonedHandle = vi.fn();
		const { sub, wallet } = setup({ connect, releaseAbandonedHandle });

		const controller = new AbortController();
		const leaving = wallet().connect({ signal: controller.signal });
		const staying = wallet().connect();
		controller.abort();

		expect(await settlementOf(leaving)).toBe("rejected");
		await expect(leaving).rejects.toMatchObject({ code: "ABORTED", walletId });
		expect(await settlementOf(staying)).toBe("pending");
		expect(connect).toHaveBeenCalledTimes(1);

		deferred.resolve("handle");
		await expect(staying).resolves.toBeUndefined();
		expect(wallet().isConnected).toBe(true);
		expect(wallet().name).toBe("Fake handle");
		expect(rememberedWalletIds()).toEqual([walletId]);
		expect(releaseAbandonedHandle).not.toHaveBeenCalled();

		sub.unsubscribe();
	});

	it("the attempt is abandoned once every signalled sharer has aborted, and a fresh connect asks the platform again", async () => {
		const first = createDeferred<string>();
		const second = createDeferred<string>();
		const connect = vi
			.fn<() => Promise<string>>()
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		const releaseAbandonedHandle = vi.fn();
		const { sub, wallet } = setup({ connect, releaseAbandonedHandle });

		const controllerA = new AbortController();
		const controllerB = new AbortController();
		const sharerA = wallet().connect({ signal: controllerA.signal });
		const sharerB = wallet().connect({ signal: controllerB.signal });

		controllerA.abort();
		expect(await settlementOf(sharerA)).toBe("rejected");
		expect(await settlementOf(sharerB)).toBe("pending");

		controllerB.abort();
		expect(await settlementOf(sharerB)).toBe("rejected");
		await expect(sharerB).rejects.toMatchObject({ code: "ABORTED", walletId });

		first.resolve("late-handle");
		await settleMicrotasks();
		expect(wallet().isConnected).toBe(false);
		expect(rememberedWalletIds()).toEqual([]);
		expect(releaseAbandonedHandle).toHaveBeenCalledWith(
			"late-handle",
			walletId,
		);

		const retry = wallet().connect();
		expect(connect).toHaveBeenCalledTimes(2);
		second.resolve("handle-2");
		await expect(retry).resolves.toBeUndefined();
		expect(wallet().name).toBe("Fake handle-2");

		sub.unsubscribe();
	});

	it("disconnect during a pending connect aborts it", async () => {
		const deferred = createDeferred<string>();
		const releaseAbandonedHandle = vi.fn();
		const disconnect = vi.fn(async () => {});
		const { sub, wallet } = setup({
			connect: () => deferred.promise,
			disconnect,
			releaseAbandonedHandle,
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
		expect(releaseAbandonedHandle).toHaveBeenCalledWith(
			"late-handle",
			walletId,
		);

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

	it("a source that leaves while its connect is pending aborts the attempt, releases the late handle and never remembers the wallet", async () => {
		const grant = createDeferred<string>();
		const releaseAbandonedHandle = vi.fn();
		const { sources$, emissions, sub, wallet } = setup({
			connect: () => grant.promise,
			releaseAbandonedHandle,
		});
		const connecting = wallet().connect();
		expect(await settlementOf(connecting)).toBe("pending");
		const before = emissions.length;

		sources$.next([]);
		expect(await settlementOf(connecting)).toBe("rejected");
		await expect(connecting).rejects.toMatchObject({
			code: "ABORTED",
			walletId,
		});
		expect(emissions.slice(before)).toEqual([[]]);

		grant.resolve("handle");
		await settleMicrotasks();
		expect(releaseAbandonedHandle).toHaveBeenCalledWith("handle", walletId);
		expect(rememberedWalletIds()).toEqual([]);
		expect(emissions.slice(before)).toEqual([[]]);

		sub.unsubscribe();
	});

	it("connect on a wallet whose source has left rejects ABORTED without asking the platform", async () => {
		const connect = vi.fn().mockResolvedValue("handle");
		const { sources$, sub, wallet } = setup({ connect });
		const stale = wallet();

		sources$.next([]);
		const connecting = stale.connect();
		expect(await settlementOf(connecting)).toBe("rejected");
		await expect(connecting).rejects.toMatchObject({
			code: "ABORTED",
			walletId,
		});
		expect(connect).not.toHaveBeenCalled();
		expect(rememberedWalletIds()).toEqual([]);

		sub.unsubscribe();
	});

	it("a connect queued behind a pending disconnect rejects ABORTED when the source leaves, without asking the platform again", async () => {
		const platformDisconnect = createDeferred<void>();
		const connect = vi.fn().mockResolvedValue("handle");
		const { sources$, sub, wallet } = setup({
			connect,
			disconnect: () => platformDisconnect.promise,
		});
		await wallet().connect();
		const disconnecting = wallet().disconnect();
		const queued = wallet().connect();
		expect(await settlementOf(queued)).toBe("pending");

		sources$.next([]);
		platformDisconnect.resolve();
		expect(await settlementOf(disconnecting)).toBe("resolved");
		expect(await settlementOf(queued)).toBe("rejected");
		await expect(queued).rejects.toMatchObject({ code: "ABORTED", walletId });
		expect(connect).toHaveBeenCalledTimes(1);
		expect(rememberedWalletIds()).toEqual([]);

		sub.unsubscribe();
	});

	it("tearing down the stream rejects a pending connect with ABORTED and releases the late handle", async () => {
		const deferred = createDeferred<string>();
		const releaseAbandonedHandle = vi.fn();
		const { sub, wallet, emissions } = setup({
			connect: () => deferred.promise,
			releaseAbandonedHandle,
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
		expect(releaseAbandonedHandle).toHaveBeenCalledWith(
			"late-handle",
			walletId,
		);
	});

	it("a connect queued behind a pending disconnect rejects ABORTED after teardown and never asks the platform again", async () => {
		const platformDisconnect = createDeferred<void>();
		const connect = vi.fn().mockResolvedValue("handle");
		const { sub, wallet } = setup({
			connect,
			disconnect: () => platformDisconnect.promise,
		});

		await wallet().connect();
		const disconnecting = wallet().disconnect();
		capReentries(disconnecting, 50);
		const queued = wallet().connect();
		sub.unsubscribe();
		platformDisconnect.resolve();

		expect(await settlementOf(disconnecting)).toBe("resolved");
		expect(await settlementOf(queued)).toBe("rejected");
		await expect(queued).rejects.toMatchObject({ code: "ABORTED", walletId });
		expect(connect).toHaveBeenCalledTimes(1);
		expect(rememberedWalletIds()).toEqual([]);
	});

	it("a connect queued behind a pending disconnect rejects ABORTED when its signal aborts, even if the platform never answers", async () => {
		const platformDisconnect = createDeferred<void>();
		const connect = vi.fn().mockResolvedValue("handle");
		const { sub, wallet } = setup({
			connect,
			disconnect: () => platformDisconnect.promise,
		});

		await wallet().connect();
		const disconnecting = wallet().disconnect();
		const controller = new AbortController();
		const queued = wallet().connect({ signal: controller.signal });
		expect(await settlementOf(queued)).toBe("pending");

		controller.abort();
		expect(await settlementOf(queued)).toBe("rejected");
		await expect(queued).rejects.toMatchObject({ code: "ABORTED", walletId });
		expect(await settlementOf(disconnecting)).toBe("pending");
		expect(connect).toHaveBeenCalledTimes(1);

		sub.unsubscribe();
	}, 1000);

	it("a connect queued behind a pending disconnect rejects ABORTED on teardown, even if the platform never answers", async () => {
		const platformDisconnect = createDeferred<void>();
		const connect = vi.fn().mockResolvedValue("handle");
		const { sub, wallet } = setup({
			connect,
			disconnect: () => platformDisconnect.promise,
		});

		await wallet().connect();
		const disconnecting = wallet().disconnect();
		const queued = wallet().connect();
		expect(await settlementOf(queued)).toBe("pending");

		sub.unsubscribe();
		expect(await settlementOf(queued)).toBe("rejected");
		await expect(queued).rejects.toMatchObject({ code: "ABORTED", walletId });
		expect(await settlementOf(disconnecting)).toBe("pending");
		expect(connect).toHaveBeenCalledTimes(1);
	}, 1000);

	it("a teardown in the microtask after the pending disconnect settles still rejects the queued connect ABORTED", async () => {
		const platformDisconnect = createDeferred<void>();
		const connect = vi.fn().mockResolvedValue("handle");
		const { sub, wallet } = setup({
			connect,
			disconnect: () => platformDisconnect.promise,
		});

		await wallet().connect();
		const disconnecting = wallet().disconnect();
		capReentries(disconnecting, 50);
		const queued = wallet().connect();
		disconnecting.then(() => sub.unsubscribe());
		platformDisconnect.resolve();

		expect(await settlementOf(queued)).toBe("rejected");
		await expect(queued).rejects.toMatchObject({ code: "ABORTED", walletId });
		expect(connect).toHaveBeenCalledTimes(1);
		expect(rememberedWalletIds()).toEqual([]);
	});

	it("a platform disconnect that rejects after teardown leaves the wallet forgotten and a stale connect rejects ABORTED", async () => {
		const platformDisconnect = createDeferred<void>();
		const connect = vi.fn().mockResolvedValue("handle");
		const { sub, wallet, emissions } = setup({
			connect,
			disconnect: () => platformDisconnect.promise,
		});

		await wallet().connect();
		const disconnecting = wallet().disconnect();
		const stale = wallet();
		sub.unsubscribe();
		const emitted = emissions.length;
		const failure = new Error("extension busy");
		platformDisconnect.reject(failure);

		await expect(disconnecting).rejects.toBe(failure);
		expect(rememberedWalletIds()).toEqual([]);
		const reconnect = stale.connect();
		expect(await settlementOf(reconnect)).toBe("rejected");
		await expect(reconnect).rejects.toMatchObject({
			code: "ABORTED",
			walletId,
		});
		expect(connect).toHaveBeenCalledTimes(1);
		expect(emissions.length).toBe(emitted);
	});

	it("a platform disconnect that resolves after teardown forgets the wallet without touching the stream's state", async () => {
		const platformDisconnect = createDeferred<void>();
		const onDisconnected = vi.fn();
		const { sub, wallet, emissions } = setup({
			disconnect: () => platformDisconnect.promise,
			onDisconnected,
		});

		await wallet().connect();
		expect(rememberedWalletIds()).toEqual([walletId]);
		const disconnecting = wallet().disconnect();
		sub.unsubscribe();
		expect(rememberedWalletIds()).toEqual([]);
		const emitted = emissions.length;
		platformDisconnect.resolve();

		expect(await settlementOf(disconnecting)).toBe("resolved");
		expect(rememberedWalletIds()).toEqual([]);
		expect(emissions.length).toBe(emitted);
		expect(onDisconnected).not.toHaveBeenCalled();
	});

	it("a platform disconnect released after a new subscription reconnected the wallet leaves it remembered", async () => {
		const platformDisconnect = createDeferred<void>();
		const { store, sub, wallet } = setup({
			disconnect: () => platformDisconnect.promise,
		});

		await wallet().connect();
		const disconnecting = wallet().disconnect();
		sub.unsubscribe();

		const next = setup({}, store);
		await next.wallet().connect();
		expect(rememberedWalletIds()).toEqual([walletId]);

		platformDisconnect.resolve();
		expect(await settlementOf(disconnecting)).toBe("resolved");
		expect(rememberedWalletIds()).toEqual([walletId]);
		expect(next.wallet().isConnected).toBe(true);

		next.sub.unsubscribe();
	});

	it("a storage write that fails on the forget leaves the disconnect complete and the next connect asks the platform again", async () => {
		let writesFail = false;
		const store = createKheopskitStore({
			storage: {
				getItem: () => null,
				setItem: () => {
					if (writesFail) throw new DOMException("full", "QuotaExceededError");
				},
				removeItem: () => {},
			},
		});
		const connect = vi.fn().mockResolvedValue("handle");
		const { sub, wallet } = setup(
			{ connect, disconnect: async () => {} },
			store,
		);

		await wallet().connect();
		writesFail = true;
		const disconnecting = wallet().disconnect();
		capReentries(disconnecting, 50);
		expect(await settlementOf(disconnecting)).toBe("resolved");

		const reconnect = wallet().connect();
		expect(await settlementOf(reconnect)).toBe("resolved");
		expect(wallet().isConnected).toBe(true);
		expect(connect).toHaveBeenCalledTimes(2);

		sub.unsubscribe();
	}, 1000);

	it("connect resolves and the wallet is connected when every storage write throws", async () => {
		const store = createKheopskitStore({
			storage: {
				getItem: () => null,
				setItem: () => {
					throw new DOMException("full", "QuotaExceededError");
				},
				removeItem: () => {},
			},
		});
		const { sub, wallet } = setup({}, store);

		const connecting = wallet().connect();
		expect(await settlementOf(connecting)).toBe("resolved");
		expect(wallet().isConnected).toBe(true);

		sub.unsubscribe();
	}, 1000);

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

	it("disconnect forgets the wallet before asking the platform and remembers it again when the platform refuses", async () => {
		const platformDisconnect = createDeferred<void>();
		const { sub, wallet } = setup({
			disconnect: () => platformDisconnect.promise,
		});

		await wallet().connect();
		const disconnecting = wallet().disconnect();
		capReentries(disconnecting, 50);
		expect(rememberedWalletIds()).toEqual([]);

		const failure = new Error("extension busy");
		platformDisconnect.reject(failure);
		await expect(disconnecting).rejects.toBe(failure);
		expect(rememberedWalletIds()).toEqual([walletId]);
		expect(wallet().isConnected).toBe(true);
		await expect(wallet().connect()).resolves.toBeUndefined();

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
