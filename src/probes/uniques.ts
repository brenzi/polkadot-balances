import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const uniquesProbe: BalanceProbe = {
  id: "uniques",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;

    // Track which collection IDs are owned by this address (for metadata/attribute attribution)
    const ownedClasses = new Set<string>();

    // Uniques.Class — collection owner deposits
    try {
      const classes = await api.query.Uniques.Class.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of classes) {
        const classId = keyArgs[0];
        if (!value) continue;
        if (value.owner === address) {
          ownedClasses.add(String(classId));
          if (value.total_deposit > 0n) {
            const totalDeposit = new Balance(value.total_deposit, decimals, symbol);
            console.log(`  Uniques class ${classId}: ${totalDeposit.toString()}`);
            store([symbol, chain, "reservedReason", `uniques(${classId})`, address], totalDeposit);
            accounted += totalDeposit.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching uniques class info:", e.toString());
    }

    // Uniques.Asset — individual item deposits (for items owned by address)
    try {
      const items = await api.query.Uniques.Asset.getEntries(...atOpt(ctx));
      let itemDepositSum = 0n;
      for (const { keyArgs, value } of items) {
        if (!value) continue;
        if (value.owner?.toString() === address && value.deposit > 0n) {
          itemDepositSum += value.deposit;
        }
      }
      if (itemDepositSum > 0n) {
        const bal = new Balance(itemDepositSum, decimals, symbol);
        console.log(`  Uniques item deposits total: ${bal.toString()}`);
        store([symbol, chain, "reservedReason", "uniquesItems", address], bal);
        accounted += bal.decimalValue();
      }
    } catch (e: any) {
      console.warn("  Error fetching uniques item info:", e.toString());
    }

    // Uniques.ClassMetadataOf — collection metadata deposits (for owned collections)
    if (ownedClasses.size > 0) {
      try {
        const metaEntries = await api.query.Uniques.ClassMetadataOf.getEntries(...atOpt(ctx));
        let metaDepositSum = 0n;
        for (const { keyArgs, value } of metaEntries) {
          if (!value) continue;
          if (ownedClasses.has(String(keyArgs[0])) && value.deposit > 0n) {
            metaDepositSum += value.deposit;
          }
        }
        if (metaDepositSum > 0n) {
          const bal = new Balance(metaDepositSum, decimals, symbol);
          console.log(`  Uniques class metadata deposits: ${bal.toString()}`);
          store([symbol, chain, "reservedReason", "uniquesClassMeta", address], bal);
          accounted += bal.decimalValue();
        }
      } catch (e: any) {
        console.warn("  Error fetching uniques class metadata:", e.toString());
      }
    }

    // Uniques.InstanceMetadataOf — item metadata deposits (for owned collections)
    if (ownedClasses.size > 0) {
      try {
        const metaEntries = await api.query.Uniques.InstanceMetadataOf.getEntries(...atOpt(ctx));
        let metaDepositSum = 0n;
        for (const { keyArgs, value } of metaEntries) {
          if (!value) continue;
          if (ownedClasses.has(String(keyArgs[0])) && value.deposit > 0n) {
            metaDepositSum += value.deposit;
          }
        }
        if (metaDepositSum > 0n) {
          const bal = new Balance(metaDepositSum, decimals, symbol);
          console.log(`  Uniques item metadata deposits: ${bal.toString()}`);
          store([symbol, chain, "reservedReason", "uniquesItemMeta", address], bal);
          accounted += bal.decimalValue();
        }
      } catch (e: any) {
        console.warn("  Error fetching uniques item metadata:", e.toString());
      }
    }

    // Uniques.Attribute — attribute deposits (for owned collections)
    if (ownedClasses.size > 0) {
      try {
        const attrEntries = await api.query.Uniques.Attribute.getEntries(...atOpt(ctx));
        let attrDepositSum = 0n;
        for (const { keyArgs, value } of attrEntries) {
          if (!value) continue;
          if (ownedClasses.has(String(keyArgs[0]))) {
            // value is [data, deposit] tuple
            const deposit = value[1] ?? value.deposit ?? 0n;
            if (deposit > 0n) {
              attrDepositSum += deposit;
            }
          }
        }
        if (attrDepositSum > 0n) {
          const bal = new Balance(attrDepositSum, decimals, symbol);
          console.log(`  Uniques attribute deposits: ${bal.toString()}`);
          store([symbol, chain, "reservedReason", "uniquesAttrs", address], bal);
          accounted += bal.decimalValue();
        }
      } catch (e: any) {
        console.warn("  Error fetching uniques attributes:", e.toString());
      }
    }

    return accounted;
  },
};
