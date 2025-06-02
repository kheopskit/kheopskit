import { useContext } from "react";
import { KheopskitContext } from "./context";

export const useWallets = () => {
  const ctx = useContext(KheopskitContext);

  // useEffect(() => {
  //   console.debug(
  //     "useWallets wallets:%s accounts:%s",
  //     ctx?.state.wallets.length ?? 0,
  //     ctx?.state.accounts.length ?? 0,
  //   );
  // }, [ctx?.state]);

  if (!ctx)
    throw new Error("useWallets can't be used without a KheopskitProvider");

  return ctx.state;
};
