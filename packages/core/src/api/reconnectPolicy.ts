/**
 * Bookkeeping for wallet auto-reconnect attempts.
 *
 * Tracks wallets currently reconnecting (to avoid duplicate concurrent
 * attempts) and those already reconnected (so we don't fight a later manual
 * disconnect). A failed attempt is retried when the wallet next re-emits
 * (e.g. a late-injecting extension that isn't ready on first sight), but only
 * up to `maxAttempts`: a wallet whose connect() keeps rejecting (a permission
 * permanently denied, a buggy provider) must not be re-attempted on every
 * wallets$ emission — the stream re-emits frequently (polkadot polling,
 * mipd/wallet-standard register events).
 */
export type ReconnectPolicyOptions = {
	/** @default 3 */
	maxAttempts?: number;
};

export const createReconnectPolicy = ({
	maxAttempts = 3,
}: ReconnectPolicyOptions = {}) => {
	const reconnecting = new Set<string>();
	const reconnected = new Set<string>();
	const failedAttempts = new Map<string, number>();

	const shouldAttempt = (walletId: string): boolean =>
		!reconnecting.has(walletId) &&
		!reconnected.has(walletId) &&
		(failedAttempts.get(walletId) ?? 0) < maxAttempts;

	/**
	 * Runs `connect` under the policy. Resolves `false` without connecting when
	 * an attempt is already in flight, the wallet already reconnected, or it
	 * exhausted its attempts; resolves `true` on success. A rejection from
	 * `connect` is recorded as a failed attempt and rethrown for the caller to
	 * report.
	 */
	const attempt = async (
		walletId: string,
		connect: () => Promise<unknown>,
	): Promise<boolean> => {
		if (!shouldAttempt(walletId)) return false;

		reconnecting.add(walletId);
		try {
			await connect();
			reconnected.add(walletId);
			failedAttempts.delete(walletId);
			return true;
		} catch (err) {
			failedAttempts.set(walletId, (failedAttempts.get(walletId) ?? 0) + 1);
			throw err;
		} finally {
			reconnecting.delete(walletId);
		}
	};

	return { shouldAttempt, attempt };
};
