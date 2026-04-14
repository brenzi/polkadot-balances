import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const nftsProbe: BalanceProbe = {
  id: "nfts",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;

    // Nfts.Collection — collection owner deposits
    try {
      const collections = await api.query.Nfts.Collection.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of collections) {
        if (!value) continue;
        if (value.owner?.toString() === address) {
          const deposit = new Balance(value.owner_deposit ?? 0n, decimals, symbol);
          if (deposit.raw > 0n) {
            console.log(`  NFT collection ${keyArgs[0]} owner deposit: ${deposit.toString()}`);
            store([symbol, chain, "reservedReason", `nfts(${keyArgs[0]})`, address], deposit);
            accounted += deposit.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching NFTs collection info:", e.toString());
    }

    // Nfts.Item — item deposits (deposit.account == address)
    try {
      const items = await api.query.Nfts.Item.getEntries(...atOpt(ctx));
      let itemDepositSum = 0n;
      for (const { value } of items) {
        if (!value) continue;
        // deposit is { account, amount } struct
        const depositAccount = value.deposit?.account?.toString();
        const depositAmount = value.deposit?.amount ?? 0n;
        if (depositAccount === address && depositAmount > 0n) {
          itemDepositSum += depositAmount;
        }
      }
      if (itemDepositSum > 0n) {
        const bal = new Balance(itemDepositSum, decimals, symbol);
        console.log(`  NFT item deposits total: ${bal.toString()}`);
        store([symbol, chain, "reservedReason", "nftsItems", address], bal);
        accounted += bal.decimalValue();
      }
    } catch (e: any) {
      console.warn("  Error fetching NFTs item info:", e.toString());
    }

    // Nfts.ItemMetadataOf — item metadata deposits
    try {
      const metaEntries = await api.query.Nfts.ItemMetadataOf.getEntries(...atOpt(ctx));
      let metaDepositSum = 0n;
      for (const { value } of metaEntries) {
        if (!value) continue;
        const depositAccount = value.deposit?.account?.toString();
        const depositAmount = value.deposit?.amount ?? 0n;
        if (depositAccount === address && depositAmount > 0n) {
          metaDepositSum += depositAmount;
        }
      }
      if (metaDepositSum > 0n) {
        const bal = new Balance(metaDepositSum, decimals, symbol);
        console.log(`  NFT item metadata deposits: ${bal.toString()}`);
        store([symbol, chain, "reservedReason", "nftsItemMeta", address], bal);
        accounted += bal.decimalValue();
      }
    } catch (e: any) {
      console.warn("  Error fetching NFTs item metadata:", e.toString());
    }

    // Nfts.Attribute — attribute deposits
    try {
      const attrEntries = await api.query.Nfts.Attribute.getEntries(...atOpt(ctx));
      let attrDepositSum = 0n;
      for (const { value } of attrEntries) {
        if (!value) continue;
        // value is [data, AttributeDeposit { account, amount }] or { deposit: { account, amount }, value }
        const deposit = value[1] ?? value.deposit;
        const depositAccount = deposit?.account?.toString();
        const depositAmount = deposit?.amount ?? 0n;
        if (depositAccount === address && depositAmount > 0n) {
          attrDepositSum += depositAmount;
        }
      }
      if (attrDepositSum > 0n) {
        const bal = new Balance(attrDepositSum, decimals, symbol);
        console.log(`  NFT attribute deposits: ${bal.toString()}`);
        store([symbol, chain, "reservedReason", "nftsAttrs", address], bal);
        accounted += bal.decimalValue();
      }
    } catch (e: any) {
      console.warn("  Error fetching NFTs attribute info:", e.toString());
    }

    // Nfts.CollectionMetadataOf — collection metadata deposits
    try {
      const metaEntries = await api.query.Nfts.CollectionMetadataOf.getEntries(...atOpt(ctx));
      let metaDepositSum = 0n;
      for (const { value } of metaEntries) {
        if (!value) continue;
        const depositAccount = value.deposit?.account?.toString();
        const depositAmount = value.deposit?.amount ?? 0n;
        if (depositAccount === address && depositAmount > 0n) {
          metaDepositSum += depositAmount;
        }
      }
      if (metaDepositSum > 0n) {
        const bal = new Balance(metaDepositSum, decimals, symbol);
        console.log(`  NFT collection metadata deposits: ${bal.toString()}`);
        store([symbol, chain, "reservedReason", "nftsCollMeta", address], bal);
        accounted += bal.decimalValue();
      }
    } catch (e: any) {
      console.warn("  Error fetching NFTs collection metadata:", e.toString());
    }

    return accounted;
  },
};
