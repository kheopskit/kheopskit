import { describe, expect, it, vi } from "vitest";
import { createReconnectPolicy } from "./reconnectPolicy";

describe("createReconnectPolicy", () => {
	it("connects once and skips further attempts after success", async () => {
		const policy = createReconnectPolicy();
		const connect = vi.fn().mockResolvedValue(undefined);

		await expect(policy.attempt("w1", connect)).resolves.toBe(true);
		await expect(policy.attempt("w1", connect)).resolves.toBe(false);
		expect(connect).toHaveBeenCalledTimes(1);
	});

	it("dedupes concurrent attempts for the same wallet", async () => {
		const policy = createReconnectPolicy();
		let release = () => {};
		const connect = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);

		const first = policy.attempt("w1", connect);
		// While the first attempt is in flight, a second one must not start.
		await expect(policy.attempt("w1", connect)).resolves.toBe(false);
		expect(connect).toHaveBeenCalledTimes(1);

		release();
		await expect(first).resolves.toBe(true);
	});

	it("tracks wallets independently", async () => {
		const policy = createReconnectPolicy();
		const connect = vi.fn().mockResolvedValue(undefined);

		await expect(policy.attempt("w1", connect)).resolves.toBe(true);
		await expect(policy.attempt("w2", connect)).resolves.toBe(true);
		expect(connect).toHaveBeenCalledTimes(2);
	});

	it("rethrows failures, allows retries, then gives up after maxAttempts", async () => {
		const policy = createReconnectPolicy({ maxAttempts: 3 });
		const connect = vi.fn().mockRejectedValue(new Error("denied"));

		for (let i = 0; i < 3; i++) {
			expect(policy.shouldAttempt("w1")).toBe(true);
			await expect(policy.attempt("w1", connect)).rejects.toThrow("denied");
		}

		expect(policy.shouldAttempt("w1")).toBe(false);
		await expect(policy.attempt("w1", connect)).resolves.toBe(false);
		expect(connect).toHaveBeenCalledTimes(3);
	});

	it("clears the failure count on success", async () => {
		const policy = createReconnectPolicy({ maxAttempts: 2 });
		const connect = vi
			.fn()
			.mockRejectedValueOnce(new Error("not ready"))
			.mockResolvedValueOnce(undefined);

		await expect(policy.attempt("w1", connect)).rejects.toThrow("not ready");
		// Late-injecting extension: retry on next emission succeeds.
		await expect(policy.attempt("w1", connect)).resolves.toBe(true);
		// Success is remembered — no further attempts even though maxAttempts not reached.
		await expect(policy.attempt("w1", connect)).resolves.toBe(false);
		expect(connect).toHaveBeenCalledTimes(2);
	});
});
