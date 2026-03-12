import { Balance, safeStringify } from "../balance.ts";
import { RELAY_NATIVE_FROM_PARACHAINS } from "../constants.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

function extractDeposit(account: any): bigint {
  if (!account?.reason) return 0n;
  // reason is an enum: "Consumer" | "Sufficient" | "DepositHeld(amount)" | "DepositRefunded" | "DepositFrom(...)"
  if (account.reason.type === "DepositHeld") return account.reason.value ?? 0n;
  if (account.reason.type === "DepositFrom") return account.reason.value?.amount ?? account.reason.value?.[1] ?? 0n;
  return 0n;
}

export const assetsProbe: BalanceProbe = {
  id: "assets",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;

    // Asset creation deposits (Assets.Asset where owner == address)
    try {
      const assetDetails = await api.query.Assets.Asset.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of assetDetails) {
        if (!value) continue;
        if (value.owner?.toString() !== address) continue;
        const assetId = keyArgs[0];
        if (value.deposit > 0n) {
          const depositBal = new Balance(value.deposit, decimals, symbol);
          console.log(`  Asset ${assetId} creation deposit: ${depositBal.toString()}`);
          store([symbol, chain, "reservedReason", `assetCreation(${assetId})`, address], depositBal);
          accounted += depositBal.decimalValue();
        }
        // Metadata deposit (usually paid by the asset owner)
        try {
          const meta = await api.query.Assets.Metadata.getValue(assetId, ...atOpt(ctx));
          if (meta?.deposit > 0n) {
            const metaBal = new Balance(meta.deposit, decimals, symbol);
            console.log(`  Asset ${assetId} metadata deposit: ${metaBal.toString()}`);
            store([symbol, chain, "reservedReason", `assetMetadata(${assetId})`, address], metaBal);
            accounted += metaBal.decimalValue();
          }
        } catch {}
      }
    } catch (e: any) {
      console.warn("  Error fetching asset creation deposits:", e.toString());
    }

    // ForeignAssets creation deposits
    try {
      const assetDetails = await api.query.ForeignAssets.Asset.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of assetDetails) {
        if (!value) continue;
        if (value.owner?.toString() !== address) continue;
        const assetId = keyArgs[0];
        if (value.deposit > 0n) {
          const depositBal = new Balance(value.deposit, decimals, symbol);
          console.log(`  ForeignAsset creation deposit: ${depositBal.toString()}`);
          store([symbol, chain, "reservedReason", `foreignAssetCreation`, address], depositBal);
          accounted += depositBal.decimalValue();
        }
        try {
          const meta = await api.query.ForeignAssets.Metadata.getValue(assetId, ...atOpt(ctx));
          if (meta?.deposit > 0n) {
            const metaBal = new Balance(meta.deposit, decimals, symbol);
            console.log(`  ForeignAsset metadata deposit: ${metaBal.toString()}`);
            store([symbol, chain, "reservedReason", `foreignAssetMetadata`, address], metaBal);
            accounted += metaBal.decimalValue();
          }
        } catch {}
      }
    } catch (e: any) {
      console.warn("  Error fetching foreign asset creation deposits:", e.toString());
    }

    // Regular Assets — balance + per-account deposit tracking
    try {
      const assets = await api.query.Assets.Metadata.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of assets) {
        const assetId = Number(keyArgs[0]);
        if (!value) continue;
        const assetSymbol = value.symbol.asText();
        const assetDecimals = Number(value.decimals);
        const assetBalance = await api.query.Assets.Account.getValue(assetId, address, ...atOpt(ctx));
        if (assetBalance) {
          if (assetBalance.balance > 0n) {
            const balance = new Balance(assetBalance.balance, assetDecimals, assetSymbol);
            store([assetSymbol, chain, address, "transferable"], balance);
            console.log(`  Asset ${assetId} (${assetSymbol}): ${balance.toString()}`);
          }
          const deposit = extractDeposit(assetBalance);
          if (deposit > 0n) {
            const depositBal = new Balance(deposit, decimals, symbol);
            console.log(`  Asset ${assetId} (${assetSymbol}) account deposit: ${depositBal.toString()}`);
            store([symbol, chain, "reservedReason", `assetAccount(${assetSymbol})`, address], depositBal);
            accounted += depositBal.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching assets info:", e.toString());
    }

    // Foreign Assets — balance + per-account deposit tracking
    try {
      const assets = await api.query.ForeignAssets.Metadata.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of assets) {
        const assetId = keyArgs[0];
        if (!value) continue;
        const assetSymbol = value.symbol.asText();
        const assetDecimals = Number(value.decimals);
        const assetBalance = await api.query.ForeignAssets.Account.getValue(assetId, address, ...atOpt(ctx));
        if (assetBalance) {
          if (assetBalance.balance > 0n) {
            const balance = new Balance(assetBalance.balance, assetDecimals, assetSymbol);
            store([assetSymbol, chain, address, "transferable"], balance);
            console.log(`  ForeignAsset (${assetSymbol}): ${balance.toString()}`);
          }
          const deposit = extractDeposit(assetBalance);
          if (deposit > 0n) {
            const depositBal = new Balance(deposit, decimals, symbol);
            console.log(`  ForeignAsset (${assetSymbol}) account deposit: ${depositBal.toString()}`);
            store([symbol, chain, "reservedReason", `foreignAssetAccount(${assetSymbol})`, address], depositBal);
            accounted += depositBal.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching foreign assets info:", e.toString());
    }

    // DEX Liquidity Pools
    try {
      const pools = await api.query.AssetConversion.Pools.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of pools) {
        const [assetId1, assetId2] = keyArgs[0];
        const poolAssetId = Number(value);
        const liq = await api.query.PoolAssets.Account.getValue(poolAssetId, address, ...atOpt(ctx));
        if (liq && liq.balance > 0n) {
          // Track pool asset account deposit
          const poolDeposit = extractDeposit(liq);
          if (poolDeposit > 0n) {
            const depositBal = new Balance(poolDeposit, decimals, symbol);
            console.log(`  Pool asset ${poolAssetId} account deposit: ${depositBal.toString()}`);
            store([symbol, chain, "reservedReason", `poolAssetAccount(${poolAssetId})`, address], depositBal);
            accounted += depositBal.decimalValue();
          }

          // Pool share valuation — runtime API may not support `at`
          if (!ctx.at) {
            try {
              const poolAsset = await api.query.PoolAssets.Asset.getValue(poolAssetId);
              const liqTotal = poolAsset?.supply ?? 0n;
              const poolShare = Number(liq.balance) / Number(liqTotal);
              const poolMeta1 = await api.query.ForeignAssets.Metadata.getValue(assetId1);
              const poolMeta2 = await api.query.ForeignAssets.Metadata.getValue(assetId2);
              const relayNative = safeStringify(RELAY_NATIVE_FROM_PARACHAINS);
              const assetSymbol1 =
                safeStringify(assetId1) === relayNative ? symbol : poolMeta1.symbol.asText();
              const assetSymbol2 =
                safeStringify(assetId2) === relayNative ? symbol : poolMeta2.symbol.asText();
              const assetDecimals1 =
                safeStringify(assetId1) === relayNative ? decimals : Number(poolMeta1.decimals);
              const assetDecimals2 =
                safeStringify(assetId2) === relayNative ? decimals : Number(poolMeta2.decimals);
              console.log(
                `    User has liquidity tokens: ${poolShare} of pool of ${assetSymbol1} and ${assetSymbol2}`,
              );
              const reserves = await api.apis.AssetConversionApi.get_reserves(assetId1, assetId2);
              const userAmount1 = new Balance(
                BigInt(Math.round(poolShare * Number(reserves[0]))),
                assetDecimals1,
                assetSymbol1,
              );
              const userAmount2 = new Balance(
                BigInt(Math.round(poolShare * Number(reserves[1]))),
                assetDecimals2,
                assetSymbol2,
              );
              console.log(
                `    Corresponding to underlying assets: ${userAmount1.toString()} and ${userAmount2.toString()}`,
              );
              store(
                [assetSymbol1, chain, "pool", `LP(${assetSymbol2}/${assetSymbol1})`, address],
                userAmount1,
              );
              store(
                [assetSymbol2, chain, "pool", `LP(${assetSymbol2}/${assetSymbol1})`, address],
                userAmount2,
              );
            } catch (e: any) {
              console.warn("    Error fetching pool reserves:", e.toString());
            }
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching pool assets info:", e.toString());
    }

    return accounted;
  },
};
