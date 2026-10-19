import type { KheopskitState, WalletId } from "@kheopskit/core";
import type { WalletActions } from "@kheopskit/core/internal";
import { createContext, useContext } from "react";

export type KheopskitExternalStore = {
	subscribe: (onChange: () => void) => () => void;
	getSnapshot: () => KheopskitState;
	getServerSnapshot: () => KheopskitState;
	walletActions: (walletId: WalletId) => WalletActions;
};

export const KheopskitContext = createContext<KheopskitExternalStore | null>(
	null,
);

export const useKheopskitExternalStore = (hookName: string) => {
	const store = useContext(KheopskitContext);
	if (!store)
		throw new Error(`${hookName} can't be used without a KheopskitProvider`);
	return store;
};
