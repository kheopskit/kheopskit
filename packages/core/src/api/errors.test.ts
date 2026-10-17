import { describe, expect, it } from "vitest";
import type { WalletId } from "../utils/WalletId";
import {
	abortedError,
	isEip1193UserRejection,
	isRefusalMessage,
	KheopskitError,
	toConnectError,
} from "./errors";

const walletId = "polkadot:talisman" as WalletId;

describe("connect rejection classification", () => {
	it("maps an EIP-1193 code 4001 rejection to USER_REJECTED", () => {
		const cause = { code: 4001, message: "User rejected the request." };
		const error = toConnectError(cause, walletId, isEip1193UserRejection);
		expect(error).toBeInstanceOf(KheopskitError);
		expect(error).toMatchObject({ code: "USER_REJECTED", walletId, cause });
	});

	it("maps Talisman's live refusal message to USER_REJECTED", () => {
		const cause = new Error(
			"Site http://localhost:3002/ has not been authorised for Talisman yet",
		);
		const error = toConnectError(cause, walletId, isRefusalMessage);
		expect(error).toMatchObject({ code: "USER_REJECTED", walletId, cause });
	});

	it("maps polkadot-js's and SubWallet's refusal messages to USER_REJECTED", () => {
		for (const message of [
			"Connection request was rejected by the user.",
			"Connection request was cancelled by the user.",
			"Rejected",
			"Cancelled",
		]) {
			const cause = new Error(message);
			expect(toConnectError(cause, walletId, isRefusalMessage)).toMatchObject({
				code: "USER_REJECTED",
				cause,
			});
		}
	});

	it("maps any other error to CONNECT_FAILED with the original as cause", () => {
		const cause = new Error("boom");
		const error = toConnectError(cause, walletId, isRefusalMessage);
		expect(error).toMatchObject({ code: "CONNECT_FAILED", walletId, cause });
		expect(error.message).toContain(walletId);
	});

	it("does not read other extension failures as a user rejection", () => {
		for (const message of [
			"Pending authorisation request already exists",
			"No Talisman wallet accounts are authorised to connect to http://localhost:3002/",
			"Rejected by someone else",
		]) {
			expect(
				toConnectError(new Error(message), walletId, isRefusalMessage).code,
			).toBe("CONNECT_FAILED");
		}
	});

	it("does not read a 4001 message without the code as an EIP-1193 rejection", () => {
		expect(isEip1193UserRejection(new Error("User rejected"))).toBe(false);
		expect(isEip1193UserRejection({ code: "4001" })).toBe(false);
	});

	it("keeps a KheopskitError as is", () => {
		const original = new KheopskitError(
			"FEATURE_NOT_SUPPORTED",
			"no standard:connect",
			{ walletId },
		);
		expect(toConnectError(original, walletId, isRefusalMessage)).toBe(original);
	});

	it("abortedError carries the code and names the wallet", () => {
		const error = abortedError(walletId);
		expect(error).toMatchObject({ code: "ABORTED", walletId });
		expect(error.message).toContain(walletId);
	});
});
