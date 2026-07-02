import { isWalletPlatform } from "../utils/isWalletPlatform";
import { cookieStorage } from "../utils/storage";
import { getWalletAccountId } from "../utils/WalletAccountId";
import {
	isValidWalletId,
	parseWalletId,
	WALLET_CONNECT_WALLET_ID,
	type WalletId,
} from "../utils/WalletId";
import type {
	CachedAccount,
	CachedWallet,
	KheopskitStoreData,
	WalletPlatform,
} from "./types";

/**
 * Compact wire format for the cookie-persisted store (`CompactStoreV1`).
 *
 * Cookies are size-constrained (~4KB per cookie, sent on every request), so the
 * persisted {@link KheopskitStoreData} is encoded as terse tuples with
 * single-letter keys instead of raw JSON. This module owns that format: the
 * encoder, the defensive decoder, and the lazy migration from the legacy
 * verbose-JSON cookies written by older versions.
 *
 * Any change here is a compatibility question — new fields must be optional and
 * decoding must keep accepting everything older versions wrote (or degrade to
 * "start fresh", never throw).
 */

// wallet type: 0=injected, 1=walletconnect
type CompactWalletEntry = [WalletId, string, 0 | 1, 0 | 1];
type CompactPolkadotAccountType = 0 | 1 | 2 | 3;
// platform: 0=polkadot, 1=ethereum, 2=solana
type CompactPlatformCode = 0 | 1 | 2;
type CompactAccountEntry = [
	WalletId,
	string,
	string | null,
	number | null,
	CompactPolkadotAccountType | null,
	// Platform code. Newly written entries always include it (the WalletConnect
	// connector's walletId is platform-less, so platform can't be derived from
	// it); absent in entries written by older versions, where it's derived from
	// the walletId instead.
	(CompactPlatformCode | null)?,
];

type CompactStoreV1 = {
	v: 1;
	// autoReconnect
	r?: WalletId[];
	// wallets: [id, name, isConnected(0|1), type(0=injected,1=walletconnect)?]
	w?: CompactWalletEntry[];
	// accounts: [walletId, address, name?, chainId?, polkadotType?, platform?]
	a?: CompactAccountEntry[];
};

const EMPTY_STORE_DATA: KheopskitStoreData = {};

const toCompactPolkadotAccountType = (
	type: CachedAccount["polkadotAccountType"],
): CompactPolkadotAccountType | null => {
	switch (type) {
		case "sr25519":
			return 0;
		case "ed25519":
			return 1;
		case "ecdsa":
			return 2;
		case "ethereum":
			return 3;
		default:
			return null;
	}
};

const fromCompactPolkadotAccountType = (
	type: CompactPolkadotAccountType | null | undefined,
): CachedAccount["polkadotAccountType"] => {
	switch (type) {
		case 0:
			return "sr25519";
		case 1:
			return "ed25519";
		case 2:
			return "ecdsa";
		case 3:
			return "ethereum";
		default:
			return undefined;
	}
};

const toCompactPlatform = (platform: WalletPlatform): CompactPlatformCode => {
	switch (platform) {
		case "polkadot":
			return 0;
		case "ethereum":
			return 1;
		case "solana":
			return 2;
	}
};

const fromCompactPlatform = (
	code: CompactPlatformCode | null | undefined,
): WalletPlatform | undefined => {
	switch (code) {
		case 0:
			return "polkadot";
		case 1:
			return "ethereum";
		case 2:
			return "solana";
		default:
			return undefined;
	}
};

const isCompactStore = (value: unknown): value is CompactStoreV1 => {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	if ("cachedWallets" in value || "cachedAccounts" in value) return false;
	return "v" in value || "w" in value || "a" in value || "r" in value;
};

const toCompactStore = (data: KheopskitStoreData): CompactStoreV1 => {
	const wallets = data.cachedWallets?.map(
		(wallet): CompactWalletEntry => [
			wallet.id,
			wallet.name,
			wallet.isConnected ? 1 : 0,
			wallet.type === "walletconnect" ? 1 : 0,
		],
	);

	const accounts = data.cachedAccounts?.map(
		(account): CompactAccountEntry => [
			account.walletId,
			account.address,
			account.name ?? null,
			account.chainId ?? null,
			toCompactPolkadotAccountType(account.polkadotAccountType),
			toCompactPlatform(account.platform),
		],
	);

	return {
		v: 1,
		r: data.autoReconnect,
		w: wallets?.length ? wallets : undefined,
		a: accounts?.length ? accounts : undefined,
	};
};

const fromCompactStore = (data: CompactStoreV1): KheopskitStoreData => {
	const walletNameMap = new Map<WalletId, string>();

	// Decode defensively: a compact payload may be malformed (older/corrupt
	// cookie, hand-edited). Skip entries with an unparseable wallet id rather
	// than throwing, which would crash store initialisation.
	const wallets: CachedWallet[] = [];
	for (const item of Array.isArray(data.w) ? data.w : []) {
		if (!Array.isArray(item)) continue;
		const [id, name, isConnected, type] = item;
		if (!isValidWalletId(id)) continue;
		const isWalletConnect = id === WALLET_CONNECT_WALLET_ID;
		const walletType = type === 1 ? "walletconnect" : "injected";
		// Keep id/type consistent: the platform-less connector uses the fixed WC
		// id; everything else is a platform-prefixed injected wallet. Drop stale
		// mismatches (e.g. per-platform WC ids from older versions).
		if (isWalletConnect !== (walletType === "walletconnect")) continue;
		walletNameMap.set(id, name);
		wallets.push({
			id,
			platform: isWalletConnect ? undefined : parseWalletId(id).platform,
			type: walletType,
			name,
			isConnected: isConnected === 1,
		});
	}

	const accounts: CachedAccount[] = [];
	for (const item of Array.isArray(data.a) ? data.a : []) {
		if (!Array.isArray(item)) continue;
		const [
			walletId,
			address,
			name,
			chainId,
			polkadotAccountType,
			platformCode,
		] = item;
		if (!isValidWalletId(walletId) || typeof address !== "string" || !address)
			continue;
		// Prefer the explicit platform code; fall back to deriving it from the
		// walletId for entries written before the code existed (never WC ones).
		const platform =
			platformCode != null
				? fromCompactPlatform(platformCode)
				: walletId === WALLET_CONNECT_WALLET_ID
					? undefined
					: parseWalletId(walletId).platform;
		if (!isWalletPlatform(platform)) continue;
		accounts.push({
			id: getWalletAccountId(walletId, address),
			platform,
			address,
			name: name ?? undefined,
			chainId: chainId ?? undefined,
			polkadotAccountType:
				platform === "polkadot"
					? fromCompactPolkadotAccountType(polkadotAccountType)
					: undefined,
			walletId,
			walletName: walletNameMap.get(walletId) ?? walletId,
		});
	}

	return {
		autoReconnect: data.r,
		cachedWallets: wallets,
		cachedAccounts: accounts,
	};
};

const decodeStore = (raw: string, fallback: KheopskitStoreData) => {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (isCompactStore(parsed)) return fromCompactStore(parsed);
		return parsed as KheopskitStoreData;
	} catch {
		return fallback;
	}
};

const encodeStore = (data: KheopskitStoreData): string =>
	JSON.stringify(toCompactStore(data));

/**
 * Cookie storage that transparently encodes/decodes {@link CompactStoreV1},
 * migrating legacy verbose-JSON cookies to the compact format on first read.
 */
export const createCompactCookieStorage = (initialCookies?: string) => {
	const base = cookieStorage(initialCookies);

	return {
		getItem: (key: string) => {
			const raw = base.getItem(key);
			if (!raw) return null;
			const expanded = decodeStore(raw, EMPTY_STORE_DATA);
			if (typeof document !== "undefined") {
				try {
					const parsed = JSON.parse(raw) as unknown;
					if (!isCompactStore(parsed)) {
						base.setItem(key, encodeStore(expanded));
					}
				} catch {
					// Ignore malformed cookie during migration
				}
			}
			return JSON.stringify(expanded);
		},
		setItem: (key: string, value: string) => {
			const expanded = decodeStore(value, EMPTY_STORE_DATA);
			base.setItem(key, encodeStore(expanded));
		},
		removeItem: base.removeItem,
		subscribe: (key: string, callback: (value: string | null) => void) => {
			const unsubscribe = base.subscribe?.(key, (value) => {
				if (!value) {
					callback(null);
					return;
				}
				const expanded = decodeStore(value, EMPTY_STORE_DATA);
				callback(JSON.stringify(expanded));
			});
			return () => {
				unsubscribe?.();
			};
		},
	};
};
