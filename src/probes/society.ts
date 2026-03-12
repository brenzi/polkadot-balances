import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const societyProbe: BalanceProbe = {
  id: "society",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;
    try {
      const bids = await api.query.Society.Bids.getValue(...atOpt(ctx));
      if (bids) {
        for (const bid of bids) {
          if (bid.who?.toString() === address && bid.value > 0n) {
            const deposit = new Balance(bid.value, decimals, symbol);
            console.log(`  Society bid deposit: ${deposit.toString()}`);
            store([symbol, chain, "reservedReason", "societyBid", address], deposit);
            accounted += deposit.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching society info:", e.toString());
    }
    return accounted;
  },
};
