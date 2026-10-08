import { firstValueFrom } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveConfig } from "../config";
import { createKheopskitStore } from "../store";
import type { KheopskitConfig, WalletConnectConfig } from "../types";
import { polkadot } from "./plugin";

const { connectInjectedExtension } = vi.hoisted(() => ({
	connectInjectedExtension: vi.fn().mockResolvedValue({}),
}));

vi.mock("polkadot-api/pjs-signer", () => ({
	getInjectedExtensions: () => ["test-extension"],
	connectInjectedExtension,
}));

const walletConnect = {
	projectId: "test",
	metadata: {
		name: "WalletConnect Dapp",
		description: "",
		url: "",
		icons: [],
	},
	networks: [{}],
} satisfies WalletConnectConfig;

const connectWith = async (config: Partial<KheopskitConfig>) => {
	const plugin = polkadot();
	const wallets$ = plugin.getWallets$({
		store: createKheopskitStore(),
		config: resolveConfig({ ...config, platforms: [plugin] }),
	});
	const [wallet] = await firstValueFrom(wallets$);
	await wallet?.connect();
};

describe("polkadot wallet connect", () => {
	beforeEach(() => {
		localStorage.clear();
		connectInjectedExtension.mockClear();
	});

	it("sends appName as the dapp name", async () => {
		await connectWith({ appName: "My Dapp", walletConnect });

		expect(connectInjectedExtension).toHaveBeenCalledWith(
			"test-extension",
			"My Dapp",
		);
	});

	it("falls back to the WalletConnect metadata name", async () => {
		await connectWith({ walletConnect });

		expect(connectInjectedExtension).toHaveBeenCalledWith(
			"test-extension",
			"WalletConnect Dapp",
		);
	});

	it("falls back to the page hostname", async () => {
		await connectWith({ appName: "" });

		expect(connectInjectedExtension).toHaveBeenCalledWith(
			"test-extension",
			"localhost",
		);
	});
});
