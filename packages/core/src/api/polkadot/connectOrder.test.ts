import type { Subscription } from "rxjs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	createFakePolkadotExtension,
	createMemoryStorage,
	type FakePolkadotExtension,
} from "../../testing";
import { getKheopskit$ } from "../kheopskit";
import { createKheopskitStore, type KheopskitStore } from "../store";
import type { KheopskitState } from "../types";
import { polkadot } from "./plugin";

const TALISMAN = "polkadot:talisman";

let store: KheopskitStore;
let subscription: Subscription | undefined;
let talisman: FakePolkadotExtension;
let log: string[];

beforeEach(() => {
	vi.useFakeTimers();
	log = [];
	store = createKheopskitStore({ storage: createMemoryStorage() });
	talisman = createFakePolkadotExtension({ name: "talisman", enable: "hold" });
});

afterEach(() => {
	subscription?.unsubscribe();
	subscription = undefined;
	talisman.uninstall();
	store.destroy();
	vi.useRealTimers();
});

const drive = (
	shouldConnect: (wallet: KheopskitState["wallets"][number]) => boolean,
) => {
	subscription = getKheopskit$(
		{ platforms: [polkadot()], autoReconnect: false, hydrationGracePeriod: 0 },
		{ store },
	).subscribe((state: KheopskitState) => {
		const wallet = state.wallets.find((w) => w.id === TALISMAN);
		if (!wallet) return;
		log.push(`emit ${wallet.status} ${wallet.error?.code ?? "-"}`);
		if (!shouldConnect(wallet)) return;
		log.push("connect()");
		wallet.connect().then(
			() => log.push("resolved"),
			(error) => log.push(`rejected ${error.code}`),
		);
	});
};

const declineOnce = async () => {
	await vi.advanceTimersByTimeAsync(0);
	talisman.rejectEnable();
	await vi.advanceTimersByTimeAsync(100);
};

it("emits the USER_REJECTED state before connect() rejects", async () => {
	let asked = false;
	drive(() => {
		if (asked) return false;
		asked = true;
		return true;
	});
	await declineOnce();

	expect(log).toEqual([
		"emit disconnected -",
		"connect()",
		"emit connecting -",
		"emit disconnected USER_REJECTED",
		"rejected USER_REJECTED",
	]);
});

it("asks the extension again when connect() runs from the USER_REJECTED emission", async () => {
	drive((wallet) => wallet.status === "disconnected");
	await declineOnce();

	expect(talisman.enableCalls()).toHaveLength(2);
});

it("asks once when the driver skips a wallet whose last connect was refused", async () => {
	drive(
		(wallet) =>
			wallet.status === "disconnected" &&
			wallet.error?.code !== "USER_REJECTED",
	);
	await declineOnce();

	expect(talisman.enableCalls()).toHaveLength(1);
	expect(log.at(-1)).toBe("rejected USER_REJECTED");
});
