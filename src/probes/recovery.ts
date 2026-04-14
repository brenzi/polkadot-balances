import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const recoveryProbe: BalanceProbe = {
  id: "recovery",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;
    try {
      // Recovery config deposit — this is the deposit held by the recoverable account
      const config = await api.query.Recovery.Recoverable.getValue(address, ...atOpt(ctx));
      if (config && config.deposit > 0n) {
        const deposit = new Balance(config.deposit, decimals, symbol);
        console.log(`  Recovery config deposit: ${deposit.toString()}`);
        store([symbol, chain, "reservedReason", "recovery", address], deposit);
        accounted += deposit.decimalValue();
      }
    } catch (e: any) {
      console.warn("  Error fetching recovery info:", e.toString());
    }
    return accounted;
  },
};
