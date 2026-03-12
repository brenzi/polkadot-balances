import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const convictionProbe: BalanceProbe = {
  id: "conviction",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    try {
      const locks = await api.query.ConvictionVoting.ClassLocksFor.getValue(address, ...atOpt(ctx));
      if (locks && locks.length > 0) {
        const maxLock = locks.reduce(
          (max: any, lock: any) => (Number(lock[1]) > Number(max[1]) ? lock : max),
          locks[0],
        );
        const maxLockAmount = new Balance(maxLock[1], decimals, symbol);
        console.log(`  Max lock in Conviction Voting: ${maxLockAmount.toString()} (class: ${maxLock[0]})`);
        store([symbol, chain, "frozenReason", `convictionVoting(class ${maxLock[0]})`, address], maxLockAmount);
      }
    } catch (e: any) {
      console.warn("  Error fetching conviction voting info:", e.toString());
    }
    return 0;
  },
};
