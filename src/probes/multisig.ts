import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const multisigProbe: BalanceProbe = {
  id: "multisig",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;
    try {
      const multisigs = await api.query.Multisig.Multisigs.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of multisigs) {
        if (!value) continue;
        if (value.depositor?.toString() === address) {
          const deposit = new Balance(value.deposit, decimals, symbol);
          console.log(`  Multisig ${keyArgs.toString()} depositor with deposit: ${deposit.toString()}`);
          store([symbol, chain, "reservedReason", `multisig(${keyArgs[0]})`, address], deposit);
          accounted += deposit.decimalValue();
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching multisig info:", e.toString());
    }
    return accounted;
  },
};
