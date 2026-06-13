import { base58, base64 } from "@scure/base";
import {
	address,
	type Blockhash,
	compileTransaction,
	createSignableMessage,
	createTransactionMessage,
	getTransactionEncoder,
	setTransactionMessageFeePayer,
	setTransactionMessageLifetimeUsingBlockhash,
	type Transaction,
} from "@solana/kit";
import { describe, expect, it, vi } from "vitest";
import {
	createInjectedSolanaSigner,
	createWalletConnectSolanaSigner,
} from "./signer";

// A valid base58 ed25519 address (32 bytes).
const ADDRESS = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
const MAINNET = "solana:mainnet" as const;
const MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

const txEncoder = getTransactionEncoder();

// A real, decodable compiled transaction (fee payer + blockhash, no
// instructions). The wire decoder parses the compiled message to pair
// signatures with signer keys, so a hand-rolled message can't be used.
const buildTransaction = (): Transaction => {
	const base = createTransactionMessage({ version: 0 });
	const withPayer = setTransactionMessageFeePayer(address(ADDRESS), base);
	const withLifetime = setTransactionMessageLifetimeUsingBlockhash(
		{
			blockhash: "11111111111111111111111111111111" as Blockhash,
			lastValidBlockHeight: 0n,
		},
		withPayer,
	);
	return compileTransaction(withLifetime);
};

const TX = buildTransaction();

const wireBytes = (tx: Transaction): Uint8Array =>
	new Uint8Array(txEncoder.encode(tx));

describe("createWalletConnectSolanaSigner", () => {
	const makeProvider = (
		respond: (request: { method: string; params: unknown }) => unknown,
	) => {
		const calls: Array<{
			topic: string;
			chainId: string;
			method: string;
			params: unknown;
		}> = [];
		const provider = {
			session: { topic: "test-topic" },
			client: {
				request: vi.fn(
					async (arg: {
						topic: string;
						chainId: string;
						request: { method: string; params: unknown };
					}) => {
						calls.push({
							topic: arg.topic,
							chainId: arg.chainId,
							method: arg.request.method,
							params: arg.request.params,
						});
						return respond(arg.request);
					},
				),
			},
		};
		return { provider, calls };
	};

	it("signMessage: sends base58 message and decodes the base58 signature to bytes", async () => {
		const content = new Uint8Array([1, 2, 3, 4, 5]);
		const sigBytes = new Uint8Array(64).fill(7);
		const { provider, calls } = makeProvider(() => ({
			signature: base58.encode(sigBytes),
		}));

		const signer = createWalletConnectSolanaSigner(
			provider as never,
			ADDRESS,
			MAINNET,
		);
		const [signed] = await signer.modifyAndSignMessages([
			createSignableMessage(content),
		]);

		// Request side: bytes -> base58 string.
		expect(calls[0]?.method).toBe("solana_signMessage");
		expect(calls[0]?.chainId).toBe(MAINNET_CAIP2);
		expect((calls[0]?.params as { pubkey: string }).pubkey).toBe(ADDRESS);
		expect((calls[0]?.params as { message: string }).message).toBe(
			base58.encode(content),
		);

		// Response side: base58 string -> bytes (must equal the original sig bytes).
		const returned = signed?.signatures[address(ADDRESS)];
		expect(returned).toBeInstanceOf(Uint8Array);
		expect(new Uint8Array(returned as Uint8Array)).toEqual(sigBytes);
	});

	it("signTransaction: sends base64 wire bytes and decodes a returned base64 transaction", async () => {
		const { provider, calls } = makeProvider(() => ({
			transaction: base64.encode(wireBytes(TX)),
		}));

		const signer = createWalletConnectSolanaSigner(
			provider as never,
			ADDRESS,
			MAINNET,
		);
		const [result] = await signer.modifyAndSignTransactions([TX]);

		// Request side: wire bytes -> base64 string.
		expect(calls[0]?.method).toBe("solana_signTransaction");
		expect((calls[0]?.params as { transaction: string }).transaction).toBe(
			base64.encode(wireBytes(TX)),
		);

		// Response side: base64 string -> wire bytes -> decoded Transaction.
		expect(Array.from((result as Transaction).messageBytes)).toEqual(
			Array.from(TX.messageBytes),
		);
	});

	it("signTransaction: merges a base58 signature when no transaction is returned", async () => {
		const sigBytes = new Uint8Array(64).fill(3);
		const { provider } = makeProvider(() => ({
			signature: base58.encode(sigBytes),
		}));

		const signer = createWalletConnectSolanaSigner(
			provider as never,
			ADDRESS,
			MAINNET,
		);
		const [result] = await signer.modifyAndSignTransactions([TX]);

		const merged = (result as Transaction).signatures[address(ADDRESS)];
		expect(new Uint8Array(merged as Uint8Array)).toEqual(sigBytes);
	});

	it("signAndSendTransaction: sends base64 wire bytes and decodes the base58 signature", async () => {
		const sigBytes = new Uint8Array(64).fill(9);
		const { provider, calls } = makeProvider(() => ({
			signature: base58.encode(sigBytes),
		}));

		const signer = createWalletConnectSolanaSigner(
			provider as never,
			ADDRESS,
			MAINNET,
		);
		const [signature] = await signer.signAndSendTransactions([TX]);

		expect(calls[0]?.method).toBe("solana_signAndSendTransaction");
		expect((calls[0]?.params as { transaction: string }).transaction).toBe(
			base64.encode(wireBytes(TX)),
		);
		expect(new Uint8Array(signature as Uint8Array)).toEqual(sigBytes);
	});

	it("throws when there is no active session", async () => {
		const provider = { session: undefined, client: { request: vi.fn() } };
		const signer = createWalletConnectSolanaSigner(
			provider as never,
			ADDRESS,
			MAINNET,
		);
		await expect(
			signer.modifyAndSignMessages([
				createSignableMessage(new Uint8Array([1])),
			]),
		).rejects.toThrow(/No session found/);
	});
});

describe("createInjectedSolanaSigner", () => {
	const makeWalletAndAccount = (features: Record<string, unknown>) => {
		const account = {
			address: ADDRESS,
			publicKey: new Uint8Array(32),
			chains: [MAINNET],
			features: [],
		};
		const wallet = {
			version: "1.0.0",
			name: "Phantom",
			icon: "data:image/svg+xml;base64,AAAA",
			chains: [MAINNET],
			accounts: [account],
			features,
		};
		return { wallet, account };
	};

	it("signMessage: forwards raw bytes to the wallet feature", async () => {
		const content = new Uint8Array([1, 2, 3]);
		const sigBytes = new Uint8Array(64).fill(1);
		const signMessage = vi.fn(
			async (...inputs: Array<{ message: Uint8Array }>) =>
				inputs.map((input) => ({
					signedMessage: input.message,
					signature: sigBytes,
				})),
		);
		const { wallet, account } = makeWalletAndAccount({
			"solana:signMessage": { version: "1.0.0", signMessage },
		});

		const signer = createInjectedSolanaSigner(
			wallet as never,
			account as never,
			MAINNET,
		);
		const [signed] = await signer.modifyAndSignMessages([
			createSignableMessage(content),
		]);

		expect(signMessage).toHaveBeenCalledWith({ account, message: content });
		expect(
			new Uint8Array(signed?.signatures[address(ADDRESS)] as Uint8Array),
		).toEqual(sigBytes);
	});

	it("signTransaction: forwards wire bytes + chain and decodes the signed transaction", async () => {
		const signTransaction = vi.fn(
			async (...inputs: Array<{ transaction: Uint8Array; chain: string }>) =>
				inputs.map(() => ({ signedTransaction: wireBytes(TX) })),
		);
		const { wallet, account } = makeWalletAndAccount({
			"solana:signTransaction": { version: "1.0.0", signTransaction },
		});

		const signer = createInjectedSolanaSigner(
			wallet as never,
			account as never,
			MAINNET,
		);
		const [result] = await signer.modifyAndSignTransactions([TX]);

		const call = signTransaction.mock.calls[0];
		if (!call) throw new Error("expected signTransaction to be called");
		const input = call[0] as { transaction: Uint8Array; chain: string };
		expect(Array.from(input.transaction)).toEqual(Array.from(wireBytes(TX)));
		expect(input.chain).toBe(MAINNET);
		expect(Array.from((result as Transaction).messageBytes)).toEqual(
			Array.from(TX.messageBytes),
		);
	});

	it("throws a descriptive error when the feature is missing", async () => {
		const { wallet, account } = makeWalletAndAccount({});
		const signer = createInjectedSolanaSigner(
			wallet as never,
			account as never,
			MAINNET,
		);
		await expect(
			signer.modifyAndSignMessages([
				createSignableMessage(new Uint8Array([1])),
			]),
		).rejects.toThrow(/does not support solana:signMessage/);
	});
});
