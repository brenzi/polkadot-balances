import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const parachainProbe: BalanceProbe = {
  id: "parachain",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;

    // Registrar.Paras
    try {
      const paras = await api.query.Registrar.Paras.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of paras) {
        if (value.manager?.toString() === address) {
          const paraDeposit = new Balance(value.deposit, decimals, symbol);
          console.log(`  Para ${keyArgs.toString()} managed by this account with deposit: ${paraDeposit.toString()}`);
          store([symbol, chain, "reservedReason", `paras(${keyArgs.toString()})`, address], paraDeposit);
          accounted += paraDeposit.decimalValue();
        }
      }
    } catch (e: any) {
      if (!e.toString().includes("not found")) console.warn("  Error fetching parachain registrar info:", e.toString());
    }

    // Slots.Leases
    try {
      const leases = await api.query.Slots.Leases.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of leases) {
        const maxLocks = value
          .filter(([account]: any) => account.toString() === address)
          .reduce((max: bigint, [, deposit]: any) => (BigInt(deposit) > max ? BigInt(deposit) : max), 0n);
        if (maxLocks > 0n) {
          const leaseDeposit = new Balance(maxLocks, decimals, symbol);
          console.log(`  Slot lease for para ${keyArgs.toString()} with deposit: ${leaseDeposit.toString()}`);
          store([symbol, chain, "reservedReason", `leases(${keyArgs.toString()})`, address], leaseDeposit);
          accounted += leaseDeposit.decimalValue();
        }
      }
    } catch (e: any) {
      if (!e.toString().includes("not found")) console.warn("  Error fetching parachain slot lease info:", e.toString());
    }

    // AhOps.RcLeaseReserve (migrated lease reserves on Asset Hubs)
    try {
      const leases = await api.query.AhOps.RcLeaseReserve.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of leases) {
        const [_blocknr, _paraId, account] = keyArgs;
        if (account.toString() !== address) continue;
        if (value > 0n) {
          const leaseDeposit = new Balance(value, decimals, symbol);
          console.log(`  AhOps lease for ${keyArgs.toString()} with deposit: ${leaseDeposit.toString()}`);
          store([symbol, chain, "reservedReason", `leases(${keyArgs.toString()})`, address], leaseDeposit);
          accounted += leaseDeposit.decimalValue();
        }
      }
    } catch (e: any) {
      if (!e.toString().includes("not found")) console.warn("  Error fetching parachain ahOps lease info:", e.toString());
    }

    return accounted;
  },
};
