// Injected into every page before app code runs (Playwright addInitScript).
// Provides deterministic stand-ins for the two wallet discovery channels
// kheopskit supports: EIP-6963 (ethereum) and window.injectedWeb3 (polkadot).
// No network, no extension binaries — signatures are fixed test vectors.

// ---------------------------------------------------------------------------
// Ethereum — EIP-6963 provider (discovered by mipd)
// ---------------------------------------------------------------------------

const ETH_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ETH_CHAIN_ID = "0x1";
const ETH_SIGNATURE = `0x${"11".repeat(65)}`;

const ethListeners = new Map();

const ethProvider = {
	isMockWallet: true,
	request: async ({ method }) => {
		switch (method) {
			case "eth_requestAccounts":
			case "eth_accounts":
				return [ETH_ADDRESS];
			case "eth_chainId":
				return ETH_CHAIN_ID;
			case "personal_sign":
				return ETH_SIGNATURE;
			default:
				throw new Error(`[mock-eth-wallet] unsupported method: ${method}`);
		}
	},
	on: (event, listener) => {
		if (!ethListeners.has(event)) ethListeners.set(event, new Set());
		ethListeners.get(event).add(listener);
	},
	removeListener: (event, listener) => {
		ethListeners.get(event)?.delete(listener);
	},
};

const ethProviderDetail = Object.freeze({
	info: Object.freeze({
		uuid: "c54d6cbb-1f3f-4a2c-8a8a-4e1f0e1a9b01",
		name: "Mock Ethereum Wallet",
		icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiM2MjdlZWEiLz48L3N2Zz4=",
		rdns: "xyz.kheopskit.mock",
	}),
	provider: ethProvider,
});

const announceEthProvider = () => {
	window.dispatchEvent(
		new CustomEvent("eip6963:announceProvider", { detail: ethProviderDetail }),
	);
};

window.addEventListener("eip6963:requestProvider", announceEthProvider);
announceEthProvider();

// ---------------------------------------------------------------------------
// Polkadot — window.injectedWeb3 (discovered by polkadot-api/pjs-signer)
// ---------------------------------------------------------------------------

// Alice (well-known sr25519 dev account) — must be valid SS58
const DOT_ADDRESS = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";
const DOT_SIGNATURE = `0x${"22".repeat(64)}`;

const dotAccounts = [
	{ address: DOT_ADDRESS, name: "Mock Account", type: "sr25519" },
];

window.injectedWeb3 = window.injectedWeb3 || {};
window.injectedWeb3["mock-polkadot-wallet"] = {
	version: "1.0.0",
	enable: async () => ({
		accounts: {
			get: async () => dotAccounts,
			subscribe: (cb) => {
				cb(dotAccounts);
				return () => {};
			},
		},
		signer: {
			signRaw: async () => ({ id: 1, signature: DOT_SIGNATURE }),
			signPayload: async () => ({ id: 1, signature: DOT_SIGNATURE }),
		},
	}),
};

// ---------------------------------------------------------------------------
// Solana — Wallet Standard wallet (discovered by @wallet-standard/app)
// ---------------------------------------------------------------------------

// Wrapped-SOL mint pubkey — a real, valid base58 32-byte address so
// @solana/kit's `address()` accepts it.
const SOL_ADDRESS = "So11111111111111111111111111111111111111112";
// 64 zero bytes -> base58 encodes to "1" x 64 (each leading zero byte is "1"),
// giving a deterministic "Signature: 111…" the e2e test can assert.
const SOL_SIGNATURE = new Uint8Array(64);
const SOL_ICON =
	"data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxIDEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiM5OTQ1ZmYiLz48L3N2Zz4=";

const solAccount = {
	address: SOL_ADDRESS,
	publicKey: new Uint8Array(32),
	chains: ["solana:mainnet"],
	features: ["solana:signMessage"],
};

const solanaWallet = {
	version: "1.0.0",
	name: "Mock Solana Wallet",
	icon: SOL_ICON,
	chains: ["solana:mainnet"],
	accounts: [solAccount],
	features: {
		"standard:connect": {
			version: "1.0.0",
			connect: async () => ({ accounts: solanaWallet.accounts }),
		},
		"standard:disconnect": {
			version: "1.0.0",
			disconnect: async () => {},
		},
		"standard:events": {
			version: "1.0.0",
			// No account changes in the mock; return a no-op unsubscribe.
			on: () => () => {},
		},
		"solana:signMessage": {
			version: "1.0.0",
			signMessage: async (...inputs) =>
				inputs.map((input) => ({
					signedMessage: input.message,
					signature: SOL_SIGNATURE,
				})),
		},
	},
};

// Wallet Standard registration handshake: announce now (for an app already
// listening) and register on the app-ready event (for the app loading later,
// which is the case under addInitScript).
const registerSolanaWallet = () => {
	const callback = ({ register }) => register(solanaWallet);
	try {
		window.dispatchEvent(
			new CustomEvent("wallet-standard:register-wallet", { detail: callback }),
		);
	} catch {}
	window.addEventListener("wallet-standard:app-ready", (event) => {
		try {
			callback(event.detail);
		} catch {}
	});
};

registerSolanaWallet();
