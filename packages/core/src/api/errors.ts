import type { WalletId } from "../utils/WalletId";

/**
 * Stable error codes thrown by kheopskit. Catch a {@link KheopskitError} and
 * branch on `error.code` instead of matching message strings.
 */
export type KheopskitErrorCode =
	/**
	 * This `connect()` call was abandoned: its `signal` fired before the
	 * platform answered, `disconnect()` was called while it pended, the last
	 * `kheopskit$` subscriber unsubscribed, or the wallet object came from a
	 * subscription that had already ended.
	 */
	| "ABORTED"
	/** The user refused the wallet's connect prompt. `cause` holds the platform error. */
	| "USER_REJECTED"
	/** The wallet's connect call failed for another reason. `cause` holds the platform error. */
	| "CONNECT_FAILED"
	/** The wallet does not advertise a capability kheopskit needs to proceed. */
	| "FEATURE_NOT_SUPPORTED"
	/** No active WalletConnect session for the requested operation. */
	| "NO_SESSION"
	/** No provider available for the requested namespace. */
	| "NO_PROVIDER"
	/** The installed polkadot-api version exposes neither `getTxCreatorFromPjs` (v3) nor `getPolkadotSignerFromPjs` (v2). */
	| "UNSUPPORTED_VERSION"
	/** The requested chain cannot be used for this operation (e.g. a Solana cluster with no CAIP-2 id over WalletConnect). */
	| "UNSUPPORTED_CHAIN";

/**
 * Error thrown by kheopskit wallet/account operations. Carries a stable
 * {@link KheopskitErrorCode} and, when relevant, the offending wallet id.
 *
 * @example
 * ```ts
 * try {
 *   await wallet.connect();
 * } catch (error) {
 *   if (error instanceof KheopskitError && error.code === "USER_REJECTED") {
 *     // the user closed or refused the wallet prompt
 *   } else throw error;
 * }
 * ```
 */
export class KheopskitError extends Error {
	readonly code: KheopskitErrorCode;
	/** The wallet id this error relates to, when applicable. */
	readonly walletId?: WalletId;

	constructor(
		code: KheopskitErrorCode,
		message: string,
		options?: { walletId?: WalletId; cause?: unknown },
	) {
		super(`[kheopskit] ${message}`, { cause: options?.cause });
		this.name = "KheopskitError";
		this.code = code;
		this.walletId = options?.walletId;
	}
}

export const abortedError = (walletId: WalletId): KheopskitError =>
	new KheopskitError("ABORTED", `connect to wallet ${walletId} was aborted`, {
		walletId,
	});

export const toConnectError = (
	error: unknown,
	walletId: WalletId,
	isUserRejection: (error: unknown) => boolean,
): KheopskitError => {
	if (error instanceof KheopskitError) return error;
	return isUserRejection(error)
		? new KheopskitError(
				"USER_REJECTED",
				`the user rejected the connect request of wallet ${walletId}`,
				{ walletId, cause: error },
			)
		: new KheopskitError(
				"CONNECT_FAILED",
				`wallet ${walletId} failed to connect`,
				{ walletId, cause: error },
			);
};

const EIP1193_USER_REJECTED_REQUEST = 4001;

export const isEip1193UserRejection = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	(error as { code?: unknown }).code === EIP1193_USER_REJECTED_REQUEST;

type RefusalMessage = {
	pattern: RegExp;
	wallet: string;
	evidence: "live" | "inferred";
};

/**
 * How Polkadot extensions and Wallet Standard wallets reject a refused connect
 * prompt. They send a plain `Error`, so the message is the only signal.
 * `evidence` records whether the row was observed live or inferred from the
 * wallet's source or documentation.
 */
const REFUSAL_MESSAGES: readonly RefusalMessage[] = [
	{
		pattern: /^Site .+ has not been authorised for Talisman yet$/,
		wallet: "Talisman 3.11.0, Reject button or prompt window closed",
		evidence: "live",
	},
	{
		pattern: /^Connection request was (rejected|cancelled) by the user\.$/,
		wallet: "polkadot-js extension (extension-base 0.64 State.ts)",
		evidence: "inferred",
	},
	{
		pattern: /^(Rejected|Cancelled)$/,
		wallet: "SubWallet (Extension.ts)",
		evidence: "inferred",
	},
	{
		pattern: /^User rejected the request\.$/,
		wallet: "Phantom (Wallet Standard)",
		evidence: "inferred",
	},
];

export const isRefusalMessage = (error: unknown): boolean => {
	const message = (error as { message?: unknown } | null | undefined)?.message;
	return (
		typeof message === "string" &&
		REFUSAL_MESSAGES.some((row) => row.pattern.test(message))
	);
};
