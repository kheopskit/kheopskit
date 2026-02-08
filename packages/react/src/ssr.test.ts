/**
 * @vitest-environment node
 *
 * SSR Safety Tests
 *
 * These tests verify that @kheopskit/react can be imported in server-side
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

	it("can import @kheopskit/react without browser globals", async () => {
		// This will throw if any import accesses document/window/localStorage
		// at module load time
		const react = await import("./index");

		// Verify we got the exports we expect
		expect(react.KheopskitProvider).toBeDefined();
		expect(react.useWallets).toBeDefined();
		expect(typeof react.useWallets).toBe("function");
	});

	it("can import KheopskitProvider without browser globals", async () => {
		const { KheopskitProvider } = await import("./KheopskitProvider");

		expect(KheopskitProvider).toBeDefined();
		expect(typeof KheopskitProvider).toBe("function");
	});

	it("can import hooks without browser globals", async () => {
		const { useWallets } = await import("./useWallets");
		const { createStore } = await import("./createStore");

		expect(useWallets).toBeDefined();
		expect(createStore).toBeDefined();
		expect(typeof useWallets).toBe("function");
		expect(typeof createStore).toBe("function");
	});
});
