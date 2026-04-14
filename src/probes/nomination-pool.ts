import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const nominationPoolProbe: BalanceProbe = {
  id: "nomination-pool",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;
    try {
      const poolMember = await api.query.NominationPools.PoolMembers.getValue(address, ...atOpt(ctx));
      if (poolMember && poolMember.points) {
        const poolId = Number(poolMember.pool_id);
        const points = new Balance(poolMember.points, decimals, symbol);
        console.log(`  In Nomination Pool ${poolId}: ${points.toString()}`);

        // Check if pool bond is backed by a DelegatedStaking hold (Asset Hubs).
        // If so, the holds probe will account for it — don't double-count.
        let coveredByHold = false;
        try {
          const holds = await api.query.Balances.Holds.getValue(address, ...atOpt(ctx));
          if (holds) {
            for (const hold of holds) {
              if ((hold.id?.type ?? "") === "DelegatedStaking") {
                coveredByHold = true;
                break;
              }
            }
          }
        } catch {}

        if (coveredByHold) {
          // Informational only — hold probe will account for the reserved amount
          store([symbol, chain, "nominationPool", `pool(${poolId})`, address], points);
        } else {
          // Unnamed reserve on relay chains — count towards reserved
          store([symbol, chain, "reservedReason", `nominationPool(${poolId})`, address], points);
          accounted += points.decimalValue();
        }

        // Claimable rewards — runtime API may not support `at`, skip on historical
        if (!ctx.at) {
          try {
            const claimable = await api.apis.NominationPoolsApi.pending_rewards(address);
            if (claimable > 0n) {
              const claimableBalance = new Balance(claimable, decimals, symbol);
              console.log(`    Pending claimable rewards: ${claimableBalance.toString()}`);
              store([symbol, chain, "nominationPool", `pendingRewards(${poolId})`, address], claimableBalance);
            }
          } catch (e: any) {
            console.warn("    Error fetching nomination pool pending rewards:", e.toString());
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching nomination pool info:", e.toString());
    }
    return accounted;
  },
};
