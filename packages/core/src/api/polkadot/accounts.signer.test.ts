import * as pjs from "polkadot-api/pjs-signer";
import { firstValueFrom, of } from "rxjs";
import { expect, it, onTestFinished, vi } from "vitest";
import { createFakePolkadotExtension } from "../../testing/fakePolkadotExtension";
import { WALLET_CONNECT_WALLET_ID, type WalletId } from "../../utils/WalletId";
import type { WalletConnectWallet } from "../types";
import { getPolkadotAccounts$ } from "./accounts";
import type {
	PolkadotInjected,
	PolkadotInjectedAccount,
	PolkadotInjectedWallet,
} from "./types";
import { latestAccounts } from "./wallets";

vi.mock("polkadot-api/pjs-signer", async (importOriginal) => {
	const real = await importOriginal<typeof import("polkadot-api/pjs-signer")>();
	return {
		...real,
		getTxCreatorFromPjs: vi.fn(real.getTxCreatorFromPjs),
		getPolkadotSignerFromPjs: undefined,
		getAccountTxCreator: vi.fn(
			(
				address: string,
				createTransaction: (payload: object) => Promise<string>,
			) =>
				(payload: object) =>
					createTransaction({ ...payload, signer: address }),
		),
	};
});

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const ETH = "0x8ba1f109551bd432803012645ac136ddd64dba72";
const GENESIS = "91b171bb158e2d3848fa23a9f1c25182";

const silentExtensionListing = (listed: PolkadotInjectedAccount[]) => {
	const extension: PolkadotInjected = {
		accounts: {
			get: vi.fn(async () => listed),
			subscribe: vi.fn(() => vi.fn()),
		},
		signer: {
			signRaw: vi.fn(async () => ({ id: 1, signature: "0xabcd" as const })),
			signPayload: vi.fn(async () => ({ signature: "0x" })),
		},
	};
	latestAccounts.set(extension, listed);
	return extension;
};

const injectedWalletOf = (
	extension: PolkadotInjected,
): PolkadotInjectedWallet => ({
	id: "polkadot:test-wallet" as WalletId,
	platform: "polkadot",
	type: "injected",
	sourceId: "test-wallet",
	extension,
	name: "Test Wallet",
	icon: "data:image/svg+xml,...",
	status: "connected",
	isConnected: true,
	connect: vi.fn(),
	disconnect: vi.fn(),
});

const walletConnectWalletListing = (address: string) =>
	({
		id: WALLET_CONNECT_WALLET_ID,
		type: "walletconnect",
		platforms: ["polkadot"],
		name: "WalletConnect",
		icon: "data:image/svg+xml;base64,AAAA",
		status: "connected",
		isConnected: true,
		connect: vi.fn(),
		disconnect: vi.fn(),
		appKit: {
			getProvider: vi.fn(() => ({
				session: {
					topic: "t",
					namespaces: {
						polkadot: { accounts: [`polkadot:${GENESIS}:${address}`] },
					},
				},
				client: { request: vi.fn() },
				on: vi.fn(),
				off: vi.fn(),
			})),
			getCaipNetworks: vi.fn(() => [{ caipNetworkId: `polkadot:${GENESIS}` }]),
		} as unknown as WalletConnectWallet["appKit"],
	}) as WalletConnectWallet;

it("builds the signer with the detected factory and passes ecdsa for ethereum accounts", async () => {
	const factory = vi.mocked(pjs.getTxCreatorFromPjs);
	factory.mockClear();
	const wallet = injectedWalletOf(
		silentExtensionListing([
			{ address: ALICE, name: "Alice", type: "sr25519", genesisHash: null },
			{ address: ETH, name: "Eth Key", type: "ethereum", genesisHash: null },
		]),
	);

	const accounts = await firstValueFrom(
		getPolkadotAccounts$(of([wallet]), ["sr25519", "ethereum"]),
	);

	expect(factory).toHaveBeenCalledTimes(2);
	expect(factory).toHaveBeenCalledWith(
		ALICE,
		expect.any(Function),
		expect.any(Function),
		"sr25519",
	);
	expect(factory).toHaveBeenCalledWith(
		ETH,
		expect.any(Function),
		expect.any(Function),
		"ecdsa",
	);
	expect(accounts.map((account) => account.txCreator)).toEqual([
		expect.any(Function),
		expect.any(Function),
	]);
});

const accountTxCreatorOf = (pjsModule: typeof pjs) =>
	vi.mocked(
		(
			pjsModule as typeof pjs & {
				getAccountTxCreator: (
					address: string,
					createTransaction: (payload: object) => Promise<string>,
				) => (payload: object) => Promise<string>;
			}
		).getAccountTxCreator,
	);

it("lets the wallet build the transaction when it implements createTransaction", async () => {
	const extension = silentExtensionListing([
		{ address: ALICE, name: "Alice", type: "sr25519", genesisHash: null },
	]);
	const createTransaction = vi.fn(async () => "0x1234");
	extension.signer.createTransaction = createTransaction;

	const [account] = await firstValueFrom(
		getPolkadotAccounts$(of([injectedWalletOf(extension)]), ["sr25519"]),
	);
	const txCreator = account?.txCreator as unknown as (
		payload: object,
	) => Promise<string>;
	const payload = { version: 1, signer: null, callData: "0x0000" };

	await expect(txCreator(payload)).resolves.toBe("0x1234");
	expect(createTransaction).toHaveBeenCalledWith({
		...payload,
		signer: ALICE,
	});
	expect(extension.signer.signPayload).not.toHaveBeenCalled();
});

it("signs the payload when the wallet does not implement createTransaction", async () => {
	const getTxCreatorFromPjs = vi.mocked(pjs.getTxCreatorFromPjs);
	getTxCreatorFromPjs.mockClear();
	const getAccountTxCreator = accountTxCreatorOf(pjs);
	getAccountTxCreator.mockClear();
	const extension = silentExtensionListing([
		{ address: ALICE, name: "Alice", type: "sr25519", genesisHash: null },
	]);

	await firstValueFrom(
		getPolkadotAccounts$(of([injectedWalletOf(extension)]), ["sr25519"]),
	);
	const signPayload = getTxCreatorFromPjs.mock.calls[0]?.[1];
	await signPayload?.({} as Parameters<pjs.SignPayload>[0]);

	expect(getAccountTxCreator).not.toHaveBeenCalled();
	expect(extension.signer.signPayload).toHaveBeenCalledOnce();
});

it("falls back to polkadotSigner with polkadot-api v2", async () => {
	vi.resetModules();
	const getPolkadotSignerFromPjs = vi.fn(() => ({
		publicKey: new Uint8Array(),
	}));
	vi.doMock("polkadot-api/pjs-signer", () => ({
		getTxCreatorFromPjs: undefined,
		getPolkadotSignerFromPjs,
		getAccountTxCreator: undefined,
	}));
	const { clearAllCachedObservables } = await import(
		"../../utils/getCachedObservable"
	);
	clearAllCachedObservables();
	const { getPolkadotAccounts$: getV2PolkadotAccounts$ } = await import(
		"./accounts"
	);

	const wallet = walletConnectWalletListing(ALICE);
	const fake = createFakePolkadotExtension({
		name: "test-wallet",
		accounts: [
			{ address: ALICE, name: "Alice", type: "sr25519", genesisHash: null },
		],
	});
	onTestFinished(fake.uninstall);
	const extension = (await window.injectedWeb3?.[fake.name]?.enable(
		"test",
	)) as unknown as PolkadotInjected;
	latestAccounts.set(extension, await extension.accounts.get());
	const injected = injectedWalletOf(extension);

	const accounts = await firstValueFrom(
		getV2PolkadotAccounts$(of([injected, wallet]), ["sr25519"]),
	);

	expect(accounts).toHaveLength(2);
	for (const account of accounts) {
		expect(account).toHaveProperty("polkadotSigner");
		expect(account).not.toHaveProperty("txCreator");
	}
	expect(getPolkadotSignerFromPjs).toHaveBeenCalledWith(
		ALICE,
		expect.any(Function),
		expect.any(Function),
		"sr25519",
	);

	vi.doUnmock("polkadot-api/pjs-signer");
	vi.resetModules();
});
