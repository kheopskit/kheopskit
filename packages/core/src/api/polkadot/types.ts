import type {
	InjectedPolkadotAccount,
	SignPayload,
} from "polkadot-api/pjs-signer";
import type { WalletAccountId } from "../../utils/WalletAccountId";
import type { WalletId } from "../../utils/WalletId";
import type { PolkadotAccountType } from "../types";

export type PolkadotSignRawType = "bytes" | "payload";

/** An account as the extension lists it through `accounts.get()` and `accounts.subscribe()`. */
export type PolkadotInjectedAccount = {
	address: string;
	genesisHash?: string | null;
	name?: string;
	type?: PolkadotAccountType;
	/**
	 * Talisman adds this for its own dapp origins only: `true` for a watch-only
	 * account, which cannot sign. Absent for other origins and other wallets.
	 */
	readonly?: boolean;
	/**
	 * Talisman adds this for its own dapp origins only: `true` for a watch-only
	 * account that is part of the user's portfolio. Absent for other origins
	 * and other wallets.
	 */
	partOfPortfolio?: boolean;
};

/**
 * The object `window.injectedWeb3[id].enable(appName)` resolved to, typed
 * structurally (pjs-signer does not export its type). `metadata` and
 * `provider` are the optional members of `@polkadot/extension-inject`'s
 * `Injected`, left untyped here.
 */
export type PolkadotInjected = {
	accounts: {
		get(): Promise<PolkadotInjectedAccount[]>;
		subscribe(cb: (accounts: PolkadotInjectedAccount[]) => void): () => void;
	};
	signer: {
		signPayload: SignPayload;
		/**
		 * The extension's raw signing call, as the dapp sends it. Prefer
		 * {@link PolkadotAccount.signRaw}, which encodes `data` and documents
		 * what each wallet does with `type`.
		 */
		signRaw: (payload: {
			address: string;
			data: string;
			type: PolkadotSignRawType;
		}) => Promise<{ id: number; signature: `0x${string}` }>;
	};
	metadata?: unknown;
	provider?: unknown;
};

export type PolkadotInjectedWallet = {
	id: WalletId;
	platform: "polkadot";
	type: "injected";
	/**
	 * Stable identifier of the underlying wallet source. For Polkadot this is the
	 * injected extension identifier. Named consistently across platforms
	 * (Ethereum: EIP-6963 rdns; Solana: Wallet Standard name).
	 */
	sourceId: string;
	/**
	 * The raw object `enable(appName)` returned. Use it for extension calls
	 * kheopskit does not wrap. `undefined` while the wallet is disconnected and
	 * while `state.isHydrating` is `true`.
	 */
	extension: PolkadotInjected | undefined;
	name: string;
	icon: string;
	isConnected: boolean;
	connect: () => Promise<void>;
	disconnect: () => Promise<void>;
};

export type PolkadotWallet = PolkadotInjectedWallet;

/**
 * A Polkadot account. Inherits the fields of polkadot-api's
 * `InjectedPolkadotAccount` and narrows `type` to {@link PolkadotAccountType}.
 *
 * The signing surface follows the installed polkadot-api version:
 * **`txCreator`** (a `TxCreator`) on v3+, **`polkadotSigner`** (a
 * `PolkadotSigner`) on v2. For `ethereum` accounts the signer is built with the
 * `ecdsa` signature type, so fee estimation and dry runs use a 65-byte mock
 * signature.
 *
 * Per-platform signing surfaces differ: Ethereum exposes `client` (viem),
 * Solana `signer`/`getSigner(chain)`. The Polkadot signing surface, `signRaw`
 * included, is absent while `state.isHydrating` is `true`.
 */
export type PolkadotAccount = Omit<InjectedPolkadotAccount, "type"> & {
	type: PolkadotAccountType;
	id: WalletAccountId;
	platform: "polkadot";
	walletName: string;
	walletId: WalletId;
	/** See {@link PolkadotInjectedAccount.readonly}. */
	readonly?: boolean;
	/** See {@link PolkadotInjectedAccount.partOfPortfolio}. */
	partOfPortfolio?: boolean;
	/**
	 * Signs arbitrary data with the wallet's raw signing call (`signer.signRaw`
	 * for an extension, `polkadot_signMessage` over WalletConnect) and resolves
	 * the signature as hex.
	 *
	 * A string is sent as text with `type: "payload"` and a `Uint8Array` as
	 * `0x` hex with `type: "bytes"`. An explicit `options.type` is sent as given
	 * for either input. A hex-looking string is sent as text; pass a
	 * `Uint8Array` for bytes, because Talisman, polkadot.js, SubWallet and Nova
	 * decode a `0x`-shaped string as bytes (Talisman observed live, the others
	 * read from their sources).
	 *
	 * Pass a string for a Sign-In With Substrate message. Talisman 3.11.0 opens
	 * its Sign In screen when the text parses as SIWS (the `Version` line must
	 * read `1.0.0`) and its generic Sign Request screen for anything else, hex
	 * included; the screen follows the text `data`, not `type` (observed live
	 * with both values). From their sources: Talisman, polkadot.js, SubWallet
	 * and Nova ignore `type`; Enkrypt reads it as the encoding of `data`,
	 * `"payload"` for UTF-8 text and `"bytes"` for hex, so it needs the value
	 * the derived default sends. WalletConnect has no such field.
	 */
	signRaw: (
		data: string | Uint8Array,
		options?: { type?: PolkadotSignRawType },
	) => Promise<`0x${string}`>;
};
