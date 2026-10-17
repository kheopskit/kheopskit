import type {
	KheopskitPlatform,
	KheopskitState,
	WalletAccountId,
} from "@kheopskit/core";
import { useStateItem } from "./useStateItem";

const selectAccount = (state: KheopskitState, accountId: WalletAccountId) =>
	state.accounts.find((account) => account.id === accountId);

/**
 * Returns the account with this id, or `undefined` while the state lists none.
 * Re-renders only when that account changes: its name, its placeholder flag,
 * a platform field such as an Ethereum `chainId`, or an SDK handle.
 *
 * Pass the platform tuple as a type argument for the SDK-precise account type,
 * or use the pre-typed hook from {@link createKheopskit}.
 */
export const useAccount = <
	P extends readonly KheopskitPlatform[] = readonly KheopskitPlatform[],
>(
	accountId: WalletAccountId,
) =>
	useStateItem("useAccount", accountId, selectAccount) as
		| KheopskitState<P>["accounts"][number]
		| undefined;
