import { BehaviorSubject, map, of, Subject } from "rxjs";
import { describe, expect, it } from "vitest";
import type { WalletId } from "../utils/WalletId";
import { type AccountsFrame, getAccounts$ } from "./accounts";
import { resolveConfig } from "./config";
import { createPlatformAccounts$ } from "./platformAccounts";
import type {
	BaseWallet,
	BaseWalletAccount,
	KheopskitPlatform,
	WalletPlatform,
} from "./types";

const POLKADOT = "polkadot:a" as WalletId;
const ETHEREUM = "ethereum:b" as WalletId;

const wallet = (id: WalletId, platform: WalletPlatform): BaseWallet => ({
	id,
	platform,
	type: "injected",
	name: id,
	icon: "",
	status: "connected",
	isConnected: true,
	connect: async () => {},
	disconnect: async () => {},
});

const account = (
	walletId: WalletId,
	platform: WalletPlatform,
	address: string,
): BaseWalletAccount => ({
	id: `${walletId}::${address}`,
	platform,
	address,
	walletId,
	walletName: walletId,
});

describe("getAccounts$", () => {
	it("merges every platform's accounts and answered wallets, and a plugin not built on the engine answers for no wallet", () => {
		const polkadotAnswers = new Subject<BaseWalletAccount[]>();
		const engineBuilt: KheopskitPlatform = {
			platform: "polkadot",
			getWallets$: () => of([]),
			getAccounts$: (wallets$) =>
				createPlatformAccounts$({
					wallets$,
					getInjectedAccounts$: () => polkadotAnswers,
					getWalletConnectAccounts$: () => of([]),
				}),
		};
		const foreign: KheopskitPlatform = {
			platform: "ethereum",
			getWallets$: () => of([]),
			getAccounts$: (wallets$) =>
				wallets$.pipe(
					map((wallets) =>
						wallets.map((w) => account(w.id, "ethereum", "0xb1")),
					),
				),
		};
		const wallets$ = new BehaviorSubject([
			wallet(POLKADOT, "polkadot"),
			wallet(ETHEREUM, "ethereum"),
		]);
		const frames: { accounts: string[]; answered: WalletId[] }[] = [];
		const sub = getAccounts$(
			resolveConfig({ platforms: [engineBuilt, foreign] }),
			wallets$,
		).subscribe(({ accounts, answered }: AccountsFrame) =>
			frames.push({ accounts: accounts.map((a) => a.address), answered }),
		);

		expect(frames).toEqual([]);
		polkadotAnswers.next([]);
		expect(frames).toEqual([{ accounts: ["0xb1"], answered: [POLKADOT] }]);

		polkadotAnswers.next([account(POLKADOT, "polkadot", "a1")]);
		expect(frames.at(-1)).toEqual({
			accounts: ["a1", "0xb1"],
			answered: [POLKADOT],
		});
		sub.unsubscribe();
	});
});
