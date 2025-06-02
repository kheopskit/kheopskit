import {
  type KheopskitConfig,
  type KheopskitState,
  getKheopskit$,
  resolveConfig,
} from "@kheopskit/core";
import {
  type FC,
  type PropsWithChildren,
  useMemo,
  useSyncExternalStore,
} from "react";
import { KheopskitContext } from "./context";
import { createStore } from "./createStore";

export const KheopskitProvider: FC<
  PropsWithChildren & { config?: Partial<KheopskitConfig> }
> = ({ children, config }) => {
  const defaultValue = useMemo<KheopskitState>(
    () => ({
      wallets: [],
      accounts: [],
      config: resolveConfig(config),
    }),
    [config],
  );

  const store = useMemo(
    () => createStore(getKheopskit$(config), defaultValue),
    [config, defaultValue],
  );

  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);

  const value = useMemo(() => ({ state }), [state]);

  return (
    <KheopskitContext.Provider value={value}>
      {children}
    </KheopskitContext.Provider>
  );
};
