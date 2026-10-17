import { firstValueFrom, type Subscription } from "rxjs";
import { afterEach, describe, expect, it } from "vitest";
import { resolveConfig } from "../api/config";
import { polkadot } from "../api/polkadot/plugin";
import { createKheopskitStore } from "../api/store";
import { getWalletId } from "../utils/WalletId";
import {
	createFakePolkadotExtension,
	FAKE_SIGNATURE,
	type FakePolkadotExtension,
} from "./fakePolkadotExtension";
import { createMemoryStorage } from "./memoryStorage";

const alice = {
	address: "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY",
	name: "Alice",
	type: "sr25519" as const,
};
const bob = {
	address: "5FHneW46xGXgs5mUiveU4sbTyGBzmstUspZC92UhjJM694ty",
	name: "Bob",
	type: "sr25519" as const,
};

const nextMacrotask = () => new Promise((resolve) => setTimeout(resolve, 0));

const fakes: FakePolkadotExtension[] = [];
const subscriptions: Subscription[] = [];

const install = (...args: Parameters<typeof createFakePolkadotExtension>) => {
	const fake = createFakePolkadotExtension(...args);
	fakes.push(fake);
	return fake;
};

const kheopskitFor = (fake: FakePolkadotExtension) => {
	const plugin = polkadot();
	const wallets$ = plugin.getWallets$({
		store: createKheopskitStore({ storage: createMemoryStorage() }),
		config: resolveConfig({ appName: "Kit Test", platforms: [plugin] }),
	});
	const names: string[][] = [];
	subscriptions.push(
		plugin
			.getAccounts$(wallets$)
			.subscribe((accounts) =>
				names.push(accounts.map((account) => account.name ?? "")),
			),
	);
	const wallet = async () => {
		const found = (await firstValueFrom(wallets$)).find(
			(w) => w.id === fake.walletId,
		);
		if (!found) throw new Error(`no wallet ${fake.walletId}`);
		return found;
	};
	return { wallet, names };
};

afterEach(() => {
	for (const subscription of subscriptions.splice(0))
		subscription.unsubscribe();
	for (const fake of fakes.splice(0)) fake.uninstall();
});

describe("createFakePolkadotExtension", () => {
	it("connects at once and lists its accounts", async () => {
		const fake = install({ name: "talisman", accounts: [alice] });
		const kheopskit = kheopskitFor(fake);

		await (await kheopskit.wallet()).connect();

		expect((await kheopskit.wallet()).isConnected).toBe(true);
		expect(kheopskit.names.at(-1)).toEqual(["Alice"]);
		expect(fake.enableCalls()).toEqual(["Kit Test"]);
	});

	it("holds enable() until resolveEnable", async () => {
		const fake = install({ accounts: [alice], enable: "hold" });
		const kheopskit = kheopskitFor(fake);
		let settled = false;

		const connecting = (await kheopskit.wallet()).connect().finally(() => {
			settled = true;
		});
		await nextMacrotask();
		expect(settled).toBe(false);

		fake.resolveEnable();
		await connecting;

		expect((await kheopskit.wallet()).isConnected).toBe(true);
		expect(kheopskit.names.at(-1)).toEqual(["Alice"]);
	});

	it("holds enable() until rejectEnable, which rejects with Rejected by default", async () => {
		const fake = install({ enable: "hold" });
		const kheopskit = kheopskitFor(fake);

		const connecting = (await kheopskit.wallet()).connect();
		await nextMacrotask();
		fake.rejectEnable();

		await expect(connecting).rejects.toThrow("Rejected");
		expect((await kheopskit.wallet()).isConnected).toBe(false);
	});

	it("rejects a held enable() with the error given to rejectEnable", async () => {
		const fake = install({ enable: "hold" });
		const kheopskit = kheopskitFor(fake);

		const connecting = (await kheopskit.wallet()).connect();
		await nextMacrotask();
		fake.rejectEnable(new Error("Pending authorisation request"));

		await expect(connecting).rejects.toThrow("Pending authorisation request");
	});

	it("rejects at once with Rejected", async () => {
		const fake = install({ enable: "reject" });
		const kheopskit = kheopskitFor(fake);

		await expect((await kheopskit.wallet()).connect()).rejects.toThrow(
			"Rejected",
		);
		expect(fake.enableCalls()).toEqual(["Kit Test"]);
	});

	it("pushes setAccounts to the account subscription", async () => {
		const fake = install({ accounts: [alice] });
		const kheopskit = kheopskitFor(fake);
		await (await kheopskit.wallet()).connect();

		fake.setAccounts([alice, bob]);

		expect(kheopskit.names.at(-1)).toEqual(["Alice", "Bob"]);
	});

	it("counts enable() calls and records signRaw calls", async () => {
		const fake = install({ accounts: [alice] });
		const injected = window.injectedWeb3?.[fake.name];
		await injected?.enable("first");
		const { signer } = (await injected?.enable("second")) ?? {};

		await expect(
			signer?.signRaw?.({
				address: alice.address,
				data: "hello",
				type: "bytes",
			}),
		).resolves.toMatchObject({ signature: FAKE_SIGNATURE });

		expect(fake.enableCalls()).toEqual(["first", "second"]);
		expect(fake.signRawCalls()).toEqual([
			{ address: alice.address, data: "hello", type: "bytes" },
		]);
	});

	it("records signRaw calls an account makes", async () => {
		const fake = install({ accounts: [alice] });
		const plugin = polkadot();
		const wallets$ = plugin.getWallets$({
			store: createKheopskitStore({ storage: createMemoryStorage() }),
			config: resolveConfig({ appName: "Kit Test", platforms: [plugin] }),
		});
		const accounts$ = plugin.getAccounts$(wallets$);
		subscriptions.push(accounts$.subscribe());
		const [wallet] = await firstValueFrom(wallets$);
		await wallet?.connect();
		const [account] = await firstValueFrom(accounts$);

		await expect(
			account?.signRaw(new Uint8Array([1, 255]), { type: "bytes" }),
		).resolves.toBe(FAKE_SIGNATURE);
		expect(fake.signRawCalls()).toEqual([
			{ address: alice.address, data: "0x01ff", type: "bytes" },
		]);
	});

	it("names its wallet the way kheopskit does", () => {
		const fake = install({ name: "polkadot-js" });

		expect(fake.walletId).toBe(getWalletId("polkadot", "polkadot-js"));
	});

	it("uninstall removes only its own entry and runs once", () => {
		const talisman = install({ name: "talisman" });
		const subwallet = install({ name: "subwallet-js" });

		talisman.uninstall();
		expect(Object.keys(window.injectedWeb3 ?? {})).toEqual(["subwallet-js"]);

		const reinstalled = install({ name: "talisman" });
		talisman.uninstall();
		expect(Object.keys(window.injectedWeb3 ?? {})).toEqual([
			"subwallet-js",
			"talisman",
		]);

		reinstalled.uninstall();
		subwallet.uninstall();
		expect(window.injectedWeb3).toBeUndefined();
	});
});
