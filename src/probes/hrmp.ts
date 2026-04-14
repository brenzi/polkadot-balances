import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const hrmpProbe: BalanceProbe = {
  id: "hrmp",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;
    try {
      const channels = await api.query.Hrmp.HrmpChannels.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of channels) {
        if (!value) continue;
        // keyArgs is [{ sender, recipient }] — a struct key
        const key = keyArgs[0];
        const sender = key?.sender?.toString?.() ?? key?.[0]?.toString?.();
        const recipient = key?.recipient?.toString?.() ?? key?.[1]?.toString?.();
        if (!sender || !recipient) continue;

        if (value.sender_deposit > 0n && sender === address) {
          const deposit = new Balance(value.sender_deposit, decimals, symbol);
          console.log(`  HRMP channel sender deposit (${sender}→${recipient}): ${deposit.toString()}`);
          store([symbol, chain, "reservedReason", `hrmpSender(${sender}→${recipient})`, address], deposit);
          accounted += deposit.decimalValue();
        }
        if (value.recipient_deposit > 0n && recipient === address) {
          const deposit = new Balance(value.recipient_deposit, decimals, symbol);
          console.log(`  HRMP channel recipient deposit (${sender}→${recipient}): ${deposit.toString()}`);
          store([symbol, chain, "reservedReason", `hrmpRecipient(${sender}→${recipient})`, address], deposit);
          accounted += deposit.decimalValue();
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching HRMP channel info:", e.toString());
    }
    return accounted;
  },
};
