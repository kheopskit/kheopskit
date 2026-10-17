import * as pjs from "polkadot-api/pjs-signer";
import { firstValueFrom, of } from "rxjs";
import { expect, it, vi } from "vitest";
import type { WalletId } from "../../utils/WalletId";
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
	};
});

const ALICE = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const ETH = "0x8ba1f109551bd432803012645ac136ddd64dba72";

it("builds the signer with the detected factory and passes ecdsa for ethereum accounts", async () => {
	const factory = vi.mocked(pjs.getTxCreatorFromPjs);
	factory.mockClear();
	const listed: PolkadotInjectedAccount[] = [
		{ address: ALICE, name: "Alice", type: "sr25519", genesisHash: null },
		{ address: ETH, name: "Eth Key", type: "ethereum", genesisHash: null },
	];
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
	const wallet: PolkadotInjectedWallet = {
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
	};

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
