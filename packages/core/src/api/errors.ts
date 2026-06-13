/**
 * Stable error codes thrown by kheopskit. Catch a {@link KheopskitError} and
 * branch on `error.code` instead of matching message strings.
 */
export type KheopskitErrorCode =
	/** `connect()` called on a wallet that is already connected. */
	| "WALLET_ALREADY_CONNECTED"
	/** `disconnect()` called on a wallet that is not connected. */
	| "WALLET_NOT_CONNECTED"
	/** The wallet does not advertise a capability kheopskit needs to proceed. */
	| "FEATURE_NOT_SUPPORTED"
	/** No active WalletConnect session for the requested operation. */
	| "NO_SESSION"
	/** No provider available for the requested namespace. */
	| "NO_PROVIDER";

/**
 * Error thrown by kheopskit wallet/account operations. Carries a stable
 * {@link KheopskitErrorCode} and, when relevant, the offending wallet id.
 *
 * @example
 * ```ts
 * try {
 *   await wallet.connect();
 * } catch (error) {
 *   if (error instanceof KheopskitError && error.code === "WALLET_ALREADY_CONNECTED") {
 *     // ignore
 *   } else throw error;
 * }
 * ```
 */
export class KheopskitError extends Error {
	readonly code: KheopskitErrorCode;
	/** The wallet id this error relates to, when applicable. */
	readonly walletId?: string;

	constructor(
		code: KheopskitErrorCode,
		message: string,
		options?: { walletId?: string; cause?: unknown },
	) {
		super(`[kheopskit] ${message}`, { cause: options?.cause });
		this.name = "KheopskitError";
		this.code = code;
		this.walletId = options?.walletId;
	}
}
