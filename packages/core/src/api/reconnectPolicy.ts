import type { BaseWallet, KheopskitConfig } from "./types";

/**
 * Bookkeeping for wallet auto-reconnect attempts.
 *
 * One attempt runs per wallet at a time, a wallet that reconnected is left
 * alone (so a later manual disconnect is not fought), a wallet the user refused
 * is never asked again in this subscription, and a wallet whose connect keeps
 * failing (a permission permanently denied, a buggy provider) is retried on
 * later emissions only up to `maxAttempts`.
 */
export type ReconnectPolicyOptions = {
	/** @default 3 */
	maxAttempts?: number;
};

type ReconnectAttemptState =
	| { kind: "pending" }
	| { kind: "reconnected" }
	| { kind: "refused" }
	| { kind: "failed"; attempts: number };

export const createReconnectPolicy = ({
	maxAttempts = 3,
}: ReconnectPolicyOptions = {}) => {
	const states = new Map<string, ReconnectAttemptState>();

	const shouldAttempt = (walletId: string): boolean => {
		const state = states.get(walletId);
		if (!state) return true;
		return state.kind === "failed" && state.attempts < maxAttempts;
	};

	/**
	 * Runs `connect` under the policy. Resolves `false` without connecting when
	 * an attempt is already in flight, the wallet already reconnected, the user
	 * refused it, or it exhausted its attempts; resolves `true` on success. A
	 * rejection from `connect` is recorded as a failed attempt and rethrown for
	 * the caller to report.
	 */
	const attempt = async (
		walletId: string,
		connect: () => Promise<unknown>,
	): Promise<boolean> => {
		if (!shouldAttempt(walletId)) return false;

		const before = states.get(walletId);
		states.set(walletId, { kind: "pending" });
		try {
			await connect();
			states.set(walletId, { kind: "reconnected" });
			return true;
		} catch (err) {
			const attempts = before?.kind === "failed" ? before.attempts + 1 : 1;
			states.set(walletId, { kind: "failed", attempts });
			throw err;
		}
	};

	/** Marks a wallet the user refused: no later emission re-attempts it. */
	const refuse = (walletId: string) => {
		states.set(walletId, { kind: "refused" });
	};

	return { shouldAttempt, attempt, refuse };
};

/**
 * The reconnect rule as one function, so the first-frame placeholder and the
 * live attempt evaluate the same `autoReconnect` the same way.
 */
export const reconnectAccepts = (
	autoReconnect: KheopskitConfig["autoReconnect"],
	wallet: BaseWallet,
): boolean =>
	typeof autoReconnect === "function" ? autoReconnect(wallet) : autoReconnect;
