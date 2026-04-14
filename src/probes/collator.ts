import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const collatorProbe: BalanceProbe = {
  id: "collator",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;
    try {
      // CollatorSelection.CandidateList is a Vec on newer runtimes,
      // CollatorSelection.Candidates on older ones. Try both.
      let candidates: any[] | undefined;
      try {
        candidates = await api.query.CollatorSelection.CandidateList.getValue(...atOpt(ctx));
      } catch {
        try {
          candidates = await api.query.CollatorSelection.Candidates.getValue(...atOpt(ctx));
        } catch {
          // Neither exists on this chain
          return 0;
        }
      }
      if (candidates) {
        for (const candidate of candidates) {
          const who = candidate.who?.toString() ?? candidate[0]?.toString() ?? candidate?.toString();
          const deposit = candidate.deposit ?? candidate[1] ?? 0n;
          if (who === address && deposit > 0n) {
            const bal = new Balance(deposit, decimals, symbol);
            console.log(`  Collator candidate deposit: ${bal.toString()}`);
            store([symbol, chain, "reservedReason", "collator", address], bal);
            accounted += bal.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching collator selection info:", e.toString());
    }
    return accounted;
  },
};
