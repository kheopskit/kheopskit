import type {
	KheopskitPlatform,
	KheopskitState,
	WalletId,
} from "@kheopskit/core";
import { useStateItem } from "./useStateItem";

const selectWallet = (state: KheopskitState, walletId: WalletId) =>
	state.wallets.find((wallet) => wallet.id === walletId);

/**
 * Returns the wallet with this id, or `undefined` while the state lists none.
 * Re-renders only when that wallet changes: its status, connection, error,
 * name or any other field.
 *
 * Pass the platform tuple as a type argument for the SDK-precise wallet type,
 * or use the pre-typed hook from {@link createKheopskit}.
 */
export const useWallet = <
	P extends readonly KheopskitPlatform[] = readonly KheopskitPlatform[],
>(
	walletId: WalletId,
) =>
	useStateItem("useWallet", walletId, selectWallet) as
		| KheopskitState<P>["wallets"][number]
		| undefined;
