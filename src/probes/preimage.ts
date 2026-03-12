import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const preimageProbe: BalanceProbe = {
  id: "preimage",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;
    try {
      const preimages = await api.query.Preimage.RequestStatusFor.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of preimages) {
        if (value.type === "Unrequested") {
          if (value.value.ticket[0].toString() === address) {
            const preimageDeposit = new Balance(value.value.ticket[1], decimals, symbol);
            console.log(`  Has unrequested preimage with deposit: ${preimageDeposit.toString()}`);
            store([symbol, chain, "reservedReason", `preimage(${keyArgs.toString()})`, address], preimageDeposit);
            accounted += preimageDeposit.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching preimage info:", e.toString());
    }
    return accounted;
  },
};
