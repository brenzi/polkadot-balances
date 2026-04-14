import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const stakingProbe: BalanceProbe = {
  id: "staking",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;
    try {
      const controller = await api.query.Staking.Bonded.getValue(address, ...atOpt(ctx));
      if (controller) {
        const stakingLedger = await api.query.Staking.Ledger.getValue(controller.toString(), ...atOpt(ctx));
        if (stakingLedger && stakingLedger.active) {
          const staked = new Balance(stakingLedger.active, decimals, symbol);
          const unbonding = new Balance(
            stakingLedger.unlocking.reduce((sum: bigint, entry: any) => sum + BigInt(entry.value), 0n),
            decimals,
            symbol,
          );
          staked.label = "bonded for staking";
          console.log(`  Staked: ${staked.toString()} (controller: ${controller.toString()})`);
          store([symbol, chain, "reservedReason", "staking", address], staked);
          accounted += staked.decimalValue();
          if (unbonding.decimalValue() > 0) {
            unbonding.label = "unbonding from staking";
            store([symbol, chain, "reservedReason", "unbonding", address], unbonding);
            console.log(`  Unbonding: ${unbonding.toString()}`);
            accounted += unbonding.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching staking info:", e.toString());
    }
    return accounted;
  },
};
