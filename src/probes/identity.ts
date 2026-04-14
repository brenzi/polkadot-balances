import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const identityProbe: BalanceProbe = {
  id: "identity",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;

    // Identity.IdentityOf deposit
    try {
      const identity = await api.query.Identity.IdentityOf.getValue(address, ...atOpt(ctx));
      if (identity) {
        const [registration] = Array.isArray(identity) ? identity : [identity];
        if (registration?.deposit > 0n) {
          const deposit = new Balance(registration.deposit, decimals, symbol);
          console.log(`  Identity deposit: ${deposit.toString()}`);
          store([symbol, chain, "reservedReason", "identity", address], deposit);
          accounted += deposit.decimalValue();
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching identity info:", e.toString());
    }

    // Identity.SubsOf deposit
    try {
      const subs = await api.query.Identity.SubsOf.getValue(address, ...atOpt(ctx));
      if (subs) {
        const deposit = Array.isArray(subs) ? subs[0] : subs.deposit ?? subs;
        if (typeof deposit === "bigint" && deposit > 0n) {
          const bal = new Balance(deposit, decimals, symbol);
          console.log(`  Identity subs deposit: ${bal.toString()}`);
          store([symbol, chain, "reservedReason", "identitySubs", address], bal);
          accounted += bal.decimalValue();
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching identity subs info:", e.toString());
    }

    return accounted;
  },
};
