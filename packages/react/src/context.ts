import type { KheopskitState } from "@kheopskit/core";
import { createContext, useContext } from "react";
import type { Liveness } from "./livePipeline";

export type KheopskitExternalStore = {
	subscribe: (onChange: () => void) => () => void;
	getSnapshot: () => KheopskitState;
	getServerSnapshot: () => KheopskitState;
	whenLive: (signal?: AbortSignal) => Promise<Liveness<KheopskitState>>;
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
