import {
	address,
	getBase58Decoder,
	getBase58Encoder,
	getBase64Decoder,
	getBase64Encoder,
	getTransactionDecoder,
	getTransactionEncoder,
	type SignableMessage,
	type SignatureBytes,
	type TransactionModifyingSigner,
} from "@solana/kit";
import type {
	SolanaSignAndSendTransactionFeature,
	SolanaSignMessageFeature,
	SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import type {
	WalletAccount,
	Wallet as WalletStandardWallet,
} from "@wallet-standard/base";
import { KheopskitError } from "../errors";
import type { WalletConnectProvider } from "../types";
import { getSolanaCaip2, type SolanaChainId } from "./chains";
import type { SolanaSigner } from "./types";

const SOLANA_SIGN_MESSAGE = "solana:signMessage";
const SOLANA_SIGN_TRANSACTION = "solana:signTransaction";
const SOLANA_SIGN_AND_SEND_TRANSACTION = "solana:signAndSendTransaction";

type SignMessageApi = SolanaSignMessageFeature[typeof SOLANA_SIGN_MESSAGE];
type SignTransactionApi =
	SolanaSignTransactionFeature[typeof SOLANA_SIGN_TRANSACTION];
type SignAndSendApi =
	SolanaSignAndSendTransactionFeature[typeof SOLANA_SIGN_AND_SEND_TRANSACTION];

/** The branded array type expected back from a transaction-modifying signer. */
type SignedTransactions = Awaited<
	ReturnType<TransactionModifyingSigner["modifyAndSignTransactions"]>
>;

const requireFeature = <T>(wallet: WalletStandardWallet, name: string): T => {
	const feature = (wallet.features as Record<string, unknown>)[name];
	if (!feature)
		throw new KheopskitError(
			"FEATURE_NOT_SUPPORTED",
			`wallet "${wallet.name}" does not support ${name}`,
		);
	return feature as T;
};

/**
 * Builds a {@link SolanaSigner} backed by a Wallet Standard wallet's
 * `solana:*` features (injected wallets).
 *
 * Transactions are exchanged as wire bytes; messages and signatures as raw
 * bytes. Calling a method whose feature the wallet does not advertise throws.
 */
export const createInjectedSolanaSigner = (
	wallet: WalletStandardWallet,
	account: WalletAccount,
	chain: SolanaChainId,
): SolanaSigner => {
	const signerAddress = address(account.address);

	return {
		address: signerAddress,
		modifyAndSignMessages: async (messages) => {
			const feature = requireFeature<SignMessageApi>(
				wallet,
				SOLANA_SIGN_MESSAGE,
			);
			const outputs = await feature.signMessage(
				...messages.map((m) => ({ account, message: m.content })),
			);
			return messages.map((m, i) => {
				const output = outputs[i];
				if (!output) throw new Error("[kheopskit] missing signMessage output");
				return {
					content: output.signedMessage,
					signatures: {
						...m.signatures,
						[signerAddress]: output.signature as SignatureBytes,
					},
				} satisfies SignableMessage;
			});
		},
		modifyAndSignTransactions: async (transactions) => {
			const feature = requireFeature<SignTransactionApi>(
				wallet,
				SOLANA_SIGN_TRANSACTION,
			);
			const encoder = getTransactionEncoder();
			const decoder = getTransactionDecoder();
			const outputs = await feature.signTransaction(
				...transactions.map((tx) => ({
					account,
					transaction: new Uint8Array(encoder.encode(tx)),
					chain,
				})),
			);
			return outputs.map((output) =>
				decoder.decode(output.signedTransaction),
			) as unknown as SignedTransactions;
		},
		signAndSendTransactions: async (transactions) => {
			const feature = requireFeature<SignAndSendApi>(
				wallet,
				SOLANA_SIGN_AND_SEND_TRANSACTION,
			);
			const encoder = getTransactionEncoder();
			const outputs = await feature.signAndSendTransaction(
				...transactions.map((tx) => ({
					account,
					transaction: new Uint8Array(encoder.encode(tx)),
					chain,
				})),
			);
			return outputs.map((output) => output.signature as SignatureBytes);
		},
	};
};

/**
 * Builds a {@link SolanaSigner} backed by a WalletConnect session, adapting the
 * `solana_*` RPC methods to the same interface as the injected signer.
 *
 * The CAIP-2 chain id is derived from {@link SolanaChainId}; transactions are
 * base64-encoded and messages/signatures base58-encoded, per the WalletConnect
 * Solana spec.
 */
export const createWalletConnectSolanaSigner = (
	provider: WalletConnectProvider,
	accountAddress: string,
	chain: SolanaChainId,
): SolanaSigner => {
	const signerAddress = address(accountAddress);

	const request = <T>(method: string, params: unknown): Promise<T> => {
		if (!provider.session)
			throw new KheopskitError("NO_SESSION", "No session found");
		// Resolved lazily (not at signer construction) so building a signer for a
		// cluster without a CAIP-2 id (e.g. localnet) doesn't throw until a request
		// is actually attempted.
		return provider.client.request<T>({
			topic: provider.session.topic,
			chainId: getSolanaCaip2(chain),
			request: { method, params },
		});
	};

	return {
		address: signerAddress,
		modifyAndSignMessages: async (messages) => {
			// @solana/kit naming is the inverse of the value direction here: a
			// Decoder turns bytes -> string (so `toBase58` produces a base58 string),
			// an Encoder turns string -> bytes (so `fromBase58` parses one).
			const toBase58 = getBase58Decoder();
			const fromBase58 = getBase58Encoder();
			return Promise.all(
				messages.map(async (m) => {
					const { signature } = await request<{ signature: string }>(
						"solana_signMessage",
						{ pubkey: accountAddress, message: toBase58.decode(m.content) },
					);
					return {
						content: m.content,
						signatures: {
							...m.signatures,
							[signerAddress]: fromBase58.encode(signature) as SignatureBytes,
						},
					} satisfies SignableMessage;
				}),
			);
		},
		modifyAndSignTransactions: async (transactions) => {
			const encoder = getTransactionEncoder();
			const decoder = getTransactionDecoder();
			const toBase64 = getBase64Decoder();
			const fromBase64 = getBase64Encoder();
			const fromBase58 = getBase58Encoder();
			const signed = await Promise.all(
				transactions.map(async (tx) => {
					const result = await request<{
						transaction?: string;
						signature?: string;
					}>("solana_signTransaction", {
						transaction: toBase64.decode(encoder.encode(tx)),
					});
					// Wallets may return either the full signed transaction (base64)
					// or just the signature (base58) to merge into the original.
					if (result.transaction)
						return decoder.decode(fromBase64.encode(result.transaction));
					if (result.signature)
						return {
							...tx,
							signatures: {
								...tx.signatures,
								[signerAddress]: fromBase58.encode(
									result.signature,
								) as SignatureBytes,
							},
						};
					throw new Error(
						"[kheopskit] solana_signTransaction returned no transaction or signature",
					);
				}),
			);
			return signed as unknown as SignedTransactions;
		},
		signAndSendTransactions: async (transactions) => {
			const encoder = getTransactionEncoder();
			const toBase64 = getBase64Decoder();
			const fromBase58 = getBase58Encoder();
			return Promise.all(
				transactions.map(async (tx) => {
					const { signature } = await request<{ signature: string }>(
						"solana_signAndSendTransaction",
						{ transaction: toBase64.decode(encoder.encode(tx)) },
					);
					return fromBase58.encode(signature) as SignatureBytes;
				}),
			);
		},
	};
};
