import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const bountiesProbe: BalanceProbe = {
  id: "bounties",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;

    // Bounties
    try {
      const bounties = await api.query.Bounties.Bounties.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of bounties) {
        if (!value) continue;
        // Check if this account is the curator with an active deposit
        if (value.status?.type === "Active" || value.status?.type === "PendingPayout") {
          const curator = value.status.value?.curator?.toString();
          if (curator === address && value.curator_deposit > 0n) {
            const deposit = new Balance(value.curator_deposit, decimals, symbol);
            console.log(`  Bounty ${keyArgs[0]} curator deposit: ${deposit.toString()}`);
            store([symbol, chain, "reservedReason", `bounty(${keyArgs[0]})`, address], deposit);
            accounted += deposit.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching bounties info:", e.toString());
    }

    // Child Bounties
    try {
      const childBounties = await api.query.ChildBounties.ChildBounties.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of childBounties) {
        if (!value) continue;
        if (value.status?.type === "Active" || value.status?.type === "PendingPayout") {
          const curator = value.status.value?.curator?.toString();
          if (curator === address && value.curator_deposit > 0n) {
            const deposit = new Balance(value.curator_deposit, decimals, symbol);
            console.log(`  Child bounty ${keyArgs[0]}/${keyArgs[1]} curator deposit: ${deposit.toString()}`);
            store(
              [symbol, chain, "reservedReason", `childBounty(${keyArgs[0]}/${keyArgs[1]})`, address],
              deposit,
            );
            accounted += deposit.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching child bounties info:", e.toString());
    }

    return accounted;
  },
};
