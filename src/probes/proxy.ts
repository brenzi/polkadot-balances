import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const proxyProbe: BalanceProbe = {
  id: "proxy",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;
    try {
      const proxies = await api.query.Proxy.Proxies.getValue(address, ...atOpt(ctx));
      if (proxies && proxies.length > 0 && proxies[1] > 0n) {
        const proxyDeposit = new Balance(proxies[1], decimals, symbol);
        console.log(`  Has Proxies with total deposit of: ${proxyDeposit.toString()}`);
        store([symbol, chain, "reservedReason", "proxy", address], proxyDeposit);
        accounted += proxyDeposit.decimalValue();
      }
    } catch (e: any) {
      console.warn("  Error fetching proxy info:", e.toString());
    }
    return accounted;
  },
};
