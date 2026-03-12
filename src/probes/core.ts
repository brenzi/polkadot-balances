import { Balance, maxBigInt } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const coreProbe: BalanceProbe = {
  id: "core",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    const accountInfo = await api.query.System.Account.getValue(address, ...atOpt(ctx));
    if (!accountInfo) return 0;

    const { data: balance } = accountInfo;
    const reserved = new Balance(balance.reserved, decimals, symbol);
    const frozen = new Balance(balance.frozen, decimals, symbol);
    const free = new Balance(balance.free, decimals, symbol);
    const transferable = new Balance(
      balance.free - maxBigInt(0n, balance.frozen - balance.reserved),
      decimals,
      symbol,
    );
    const fullBalance = free.add(reserved);

    store([symbol, chain, address, "free"], free);
    store([symbol, chain, address, "frozen"], frozen);
    store([symbol, chain, address, "reserved"], reserved);
    store([symbol, chain, address, "transferable"], transferable);
    store([symbol, chain, address, "fullBalance"], fullBalance);

    console.log(
      ` transferable: ${transferable.toString()} full on-account balance ${fullBalance.toString()} | free: ${free.toString()} reserved: ${reserved.toString()} frozen: ${frozen.toString()}`,
    );

    return 0;
  },
};
