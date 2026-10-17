import type { BaseWallet, KheopskitConfig } from "./types";

// `maxAttempts` caps retries: wallets$ re-emits on every discovery change, so a
// connect that always rejects would otherwise be re-attempted on each one.
export type ReconnectPolicyOptions = {
	/** @default 3 */
	maxAttempts?: number;
};

type ReconnectAttemptState =
	| { kind: "pending" }
	| { kind: "reconnected" }
	| { kind: "settled" }
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

	const settle = (walletId: string) => {
		states.set(walletId, { kind: "settled" });
	};

	return { shouldAttempt, attempt, settle };
};

// Shared by the first-frame snapshot and the live attempt: both must evaluate
// `autoReconnect` identically or the server and client markup diverge.
export const reconnectAccepts = (
	autoReconnect: KheopskitConfig["autoReconnect"],
	wallet: BaseWallet,
): boolean =>
	typeof autoReconnect === "function" ? autoReconnect(wallet) : autoReconnect;
