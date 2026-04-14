import { Balance, type BalanceRecord, storeBalance } from "./balance.ts";
import type { ChainRuntime } from "./chains.ts";
import { probeRegistry, atOpt, type ProbeContext } from "./probes/index.ts";

export async function getBalancesForAddressOnChain(
  rt: ChainRuntime,
  address: string,
  balances: BalanceRecord,
  at?: string,
) {
  const { client, api, config } = rt;
  if (!rt._specCache) {
    const spec = await client.getChainSpecData();
    rt._specCache = {
      decimals: Number(spec.properties.tokenDecimals),
      chain: spec.name,
      symbol: spec.properties.tokenSymbol?.toString() || "UNIT",
      ed: await api.constants.Balances.ExistentialDeposit(),
    };
  }
  const { decimals, chain, symbol } = rt._specCache;
  const ed = new Balance(rt._specCache.ed, decimals, symbol);

  const store = (path: string[], balance: Balance) => storeBalance(balances, path, balance);

  const ctx: ProbeContext = { api, client, address, decimals, symbol, chain, ed, store, at };

  // Run core probe first (always present)
  const coreProbe = probeRegistry["core"];
  if (coreProbe) {
    await coreProbe.run(ctx);
  }

  // Check if there's reserved balance to investigate
  const accountInfo = await api.query.System.Account.getValue(address, ...atOpt(ctx));
  const reserved = accountInfo ? Number(accountInfo.data.reserved) / 10 ** decimals : 0;
  const frozen = accountInfo ? Number(accountInfo.data.frozen) / 10 ** decimals : 0;

  // Run frozen-reason probes if frozen > 0
  if (frozen > 0) {
    for (const probeId of config.probes) {
      if (probeId === "core" || probeId === "assets") continue;
      const probe = probeRegistry[probeId];
      if (!probe) continue;
      if (probeId === "conviction") {
        await probe.run(ctx);
      }
    }
  }

  // Run reserved-reason probes if reserved > 0
  let reservedAccounted = 0;
  if (reserved > 0) {
    for (const probeId of config.probes) {
      if (probeId === "core" || probeId === "conviction" || probeId === "assets") continue;
      const probe = probeRegistry[probeId];
      if (!probe) continue;
      reservedAccounted += await probe.run(ctx);
    }
  }

  // Always run assets probe (balance tracking + deposit accounting)
  if (config.probes.includes("assets")) {
    const assetsProbe = probeRegistry["assets"];
    if (assetsProbe) {
      reservedAccounted += await assetsProbe.run(ctx);
    }
  }

  // Report mismatch after all probes have run
  if (reserved > 0) {
    const mismatch = reserved - reservedAccounted;
    if (mismatch > ed.decimalValue()) {
      console.log(
        `  Reserved accounted: ${reservedAccounted} ${symbol}, total reserved: ${reserved} ${symbol}, unknown: ${mismatch} ${symbol}`,
      );
      store(
        [symbol, chain, "reservedReason", "unknown", address],
        new Balance(BigInt(Math.round(mismatch * 10 ** decimals)), decimals, symbol),
      );
    } else if (reservedAccounted > 0) {
      console.log(`  Reserved fully accounted: ${reservedAccounted} ${symbol} (total: ${reserved} ${symbol})`);
    }
  }
}
