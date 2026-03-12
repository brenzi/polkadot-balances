import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const holdsProbe: BalanceProbe = {
  id: "holds",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;

    // Balances.Holds (newer FRAME API)
    try {
      const holds = await api.query.Balances.Holds.getValue(address, ...atOpt(ctx));
      if (holds && holds.length > 0) {
        for (const hold of holds) {
          const reason = hold.id?.type ?? hold.id?.toString?.() ?? "unknown";
          const amount = hold.amount ?? 0n;
          if (amount > 0n) {
            const bal = new Balance(amount, decimals, symbol);
            console.log(`  Hold (${reason}): ${bal.toString()}`);
            store([symbol, chain, "reservedReason", `hold(${reason})`, address], bal);
            accounted += bal.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching Balances.Holds:", e.toString());
    }

    // Balances.Reserves (legacy API, still used on some chains)
    try {
      const reserves = await api.query.Balances.Reserves.getValue(address, ...atOpt(ctx));
      if (reserves && reserves.length > 0) {
        console.log(`  Legacy reserves found: ${reserves.length} entries`);
        for (const reserve of reserves) {
          const id = reserve.id?.asText?.() ?? reserve.id?.asHex?.() ?? reserve.id?.toString?.() ?? "unknown";
          const amount = reserve.amount ?? 0n;
          if (amount > 0n) {
            const bal = new Balance(amount, decimals, symbol);
            console.log(`  Reserve (${id}): ${bal.toString()}`);
            store([symbol, chain, "reservedReason", `reserve(${id})`, address], bal);
            accounted += bal.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.log(`  Balances.Reserves not available: ${e.message ?? e.toString()}`);
    }

    return accounted;
  },
};
