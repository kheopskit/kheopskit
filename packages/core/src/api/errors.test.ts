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

	it("maps Talisman's Reject button message to USER_REJECTED", () => {
		const cause = new Error("Rejected");
		const error = toConnectError(cause, walletId, isRefusalMessage);
		expect(error).toMatchObject({ code: "USER_REJECTED", walletId, cause });
	});

	it("maps Talisman's closed popup message to USER_REJECTED", () => {
		const cause = new Error("Cancelled");
		expect(toConnectError(cause, walletId, isRefusalMessage)).toMatchObject({
			code: "USER_REJECTED",
			cause,
		});
	});

	it("maps any other error to CONNECT_FAILED with the original as cause", () => {
		const cause = new Error("boom");
		const error = toConnectError(cause, walletId, isRefusalMessage);
		expect(error).toMatchObject({ code: "CONNECT_FAILED", walletId, cause });
		expect(error.message).toContain(walletId);
	});

	it("does not read polkadot-js's pending-request refusal as a user rejection", () => {
		const cause = new Error("Pending authorisation request already exists");
		expect(toConnectError(cause, walletId, isRefusalMessage).code).toBe(
			"CONNECT_FAILED",
		);
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
