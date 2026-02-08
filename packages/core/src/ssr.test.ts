/**
 * @vitest-environment node
 *
 * SSR Safety Tests
 *
 * These tests verify that @kheopskit/core can be imported in server-side
 * environments (like Cloudflare Workers) where browser globals like
 * `document`, `window`, and `localStorage` don't exist.
 *
 * If these tests fail, it means someone introduced code that accesses
 * browser globals at module load time, which breaks SSR/edge runtimes.
 */
import { beforeAll, describe, expect, it } from "vitest";

describe("SSR safety", () => {
	beforeAll(() => {
		// Verify we're in a Node environment without browser globals
		// These should NOT exist in the node environment
		expect(typeof document).toBe("undefined");
		expect(typeof localStorage).toBe("undefined");
	});

	it("can import @kheopskit/core without browser globals", async () => {
		// This will throw if any import accesses document/window/localStorage
		// at module load time
		const core = await import("./index");

		// Verify we got the exports we expect
		expect(core.createKheopskitStore).toBeDefined();
		expect(typeof core.createKheopskitStore).toBe("function");
	});

	it("can import storage utilities without browser globals", async () => {
		const { getSafeLocalStorage, cookieStorage } = await import(
			"./utils/storage"
		);

		// These should return the storage objects (with guards)
		expect(getSafeLocalStorage).toBeDefined();
		expect(cookieStorage).toBeDefined();
		expect(typeof getSafeLocalStorage).toBe("function");
		expect(typeof cookieStorage).toBe("function");
	});

	it("can import store without browser globals", async () => {
		const { createKheopskitStore, getDefaultStore } = await import(
			"./api/store"
		);

		expect(createKheopskitStore).toBeDefined();
		expect(getDefaultStore).toBeDefined();
		expect(typeof createKheopskitStore).toBe("function");
		expect(typeof getDefaultStore).toBe("function");
	});

	it("can import appKit without browser globals", async () => {
		const { getAppKitWallets$ } = await import("./api/appKit");

		expect(getAppKitWallets$).toBeDefined();
		expect(typeof getAppKitWallets$).toBe("function");
	});

	it("can import wallets API without browser globals", async () => {
		const { getWallets$ } = await import("./api/wallets");

		expect(getWallets$).toBeDefined();
		expect(typeof getWallets$).toBe("function");
	});

	it("can import accounts API without browser globals", async () => {
		const { getAccounts$ } = await import("./api/accounts");

		expect(getAccounts$).toBeDefined();
		expect(typeof getAccounts$).toBe("function");
	});
});
