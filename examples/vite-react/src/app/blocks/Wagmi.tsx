import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { usePlaygroundConfig } from "@/lib/config/playgroundConfig";
import { useWallets } from "@kheopskit/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAccount, useConnect } from "wagmi";
import { AppBlock } from "./AppBlock";

export const Wagmi = () => {
  const { demoConfig } = usePlaygroundConfig();

  if (!demoConfig.platforms?.includes("ethereum")) return null;

  return (
    <AppBlock
      title="Usage with Wagmi"
      description={
        <>
          Connecting a wallet with Kheopskit makes it available to Wagmi.
          <br />
          However, by default Wagmi considers only one ative connector and
          account at a time, which is the last one to be connected using the{" "}
          <strong>useConnect()</strong> hook. While it's a quite standard UX
          approach in the Ethereum ecosystem, this is not ideal when working
          with lists of multiple accounts and wallets.
          <br />
        </>
      }
      codeUrl="https://github.com/kheopskit/kheopskit/blob/main/examples/vite-react/src/app/blocks/Wagmi.tsx"
    >
      <div className="flex flex-col gap-8">
        <Connectors />
        <ActiveAccount />
      </div>
    </AppBlock>
  );
};

const Connectors = () => {
  const { connectors, connect } = useConnect();
  const { connector: current, address } = useAccount();

  return (
    <div>
      <h3>Connectors</h3>
      <div className="text-muted-foreground text-sm">
        Select active Wagmi connector:
      </div>
      <ul className="flex flex-wrap gap-2 py-1">
        {connectors.map((connector) => (
          <li key={connector.id}>
            <Button
              onClick={() => connect({ connector })}
              variant={"outline"}
              disabled={connector.id === current?.id}
              className="disabled:bg-green-500"
            >
              {connector.icon && (
                <img src={connector.icon} alt="" className="size-4" />
              )}{" "}
              {connector.name}
            </Button>
          </li>
        ))}
      </ul>
      <div className="text-sm text-muted-foreground">
        <div>Active connector: {current?.name ?? "N/A"}</div>
        <div>Active account: {address ?? "N/A"}</div>
      </div>
    </div>
  );
};

const ActiveAccount = () => {
  const { accounts } = useWallets(); // kheopskit
  const [accountId, setAccountId] = useState<string>();

  const account = useMemo(
    () => accounts.find((a) => a.id === accountId) ?? null,
    [accountId, accounts],
  );

  const handleClick = async () => {
    const account = accounts.find((a) => a.id === accountId);
    if (!account || account.platform !== "ethereum") return;

    try {
      const signature = await account.client.signMessage({
        message: "Hello Wagmi!",
        account: account.address,
      });

      toast.success(`Signature: ${signature}`);
    } catch (err) {
      console.error(err);
      toast.error(`Error: ${(err as Error).message}`);
    }
  };

  return (
    <div>
      <h3>Best practice with Kheopskit</h3>
      <p className="text-muted-foreground text-sm">
        It's bad UX to have to switch the active Wagmi connector prior to do an
        action with it, as it can trigger wallet prompts.
        <br />
        When doing an action using an account from the Kheopskit accounts list,
        it's best to lookup the associated wagmi connector and pass it as an
        argument to the hook or method call.
        <br />
        This example showcases this approach:
      </p>
      <div className="flex gap-4 mt-2">
        <Select onValueChange={setAccountId}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Account" />
          </SelectTrigger>
          <SelectContent>
            {accounts
              .filter((a) => a.platform === "ethereum")
              .map((account) => (
                <SelectItem key={account.id} value={account.id}>
                  {account.walletName} - {account.address}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Button onClick={handleClick} className="py-0" disabled={!account}>
          Sign
        </Button>
      </div>
    </div>
  );
};
