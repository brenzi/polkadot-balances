import { dot, pah, ppl, ksm, kah, kct, kpl, enc, itp, itk } from "@polkadot-api/descriptors"
import { createClient, Binary } from "polkadot-api"
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import * as fs from "fs";
import Papa from "papaparse";
import { firstValueFrom } from "rxjs";
import XLSX from "xlsx";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {RELAY_NATIVE_FROM_PARACHAINS} from "./constants";

const dotClient = createClient(
  withPolkadotSdkCompat(
    getWsProvider(["wss://polkadot-relay-2.api.integritee.network:443", "wss://polkadot.chainbricks.synology.me:4100"])
  )
);
const dotApi = dotClient.getTypedApi(dot)
const ksmClient = createClient(
  withPolkadotSdkCompat(
    getWsProvider(["wss://kusama-relay-1.api.integritee.network:443", "wss://kusama.chainbricks.synology.me:4200"])
  )
);
const ksmApi = ksmClient.getTypedApi(ksm)

const pahClient = createClient(
  withPolkadotSdkCompat(
    getWsProvider(["wss://bezzera.integritee.network:4130"])
  )
);
const pahApi = pahClient.getTypedApi(pah)

const pplClient = createClient(
  withPolkadotSdkCompat(
    getWsProvider(["wss://sys.ibp.network/people-polkadot"])
  )
);
const pplApi = pplClient.getTypedApi(ppl)

const kahClient = createClient(
  withPolkadotSdkCompat(
    getWsProvider(["wss://bezzera.integritee.network:4230", "wss://sys.ibp.network/asset-hub-kusama"])
    // getWsProvider(["wss://bezzera.integritee.network:4230"])
  )
);
const kahApi = kahClient.getTypedApi(kah)

const kctClient = createClient(
  withPolkadotSdkCompat(
    getWsProvider(["wss://sys.ibp.network/coretime-kusama"])
  )
);
const kctApi = kctClient.getTypedApi(kct)

const kplClient = createClient(
  withPolkadotSdkCompat(
    getWsProvider(["wss://sys.ibp.network/people-kusama"])
  )
);
const kplApi = kplClient.getTypedApi(kpl)

const encClient = createClient(
  withPolkadotSdkCompat(
    getWsProvider(["wss://kusama.api.encointer.org"])
  )
);
const encApi = encClient.getTypedApi(enc)

const itkClient = createClient(
  withPolkadotSdkCompat(
    getWsProvider(["wss://kusama.api.integritee.network"])
  )
);
const itkApi = itkClient.getTypedApi(itk)

const itpClient = createClient(
  withPolkadotSdkCompat(
    getWsProvider(["wss://polkadot.api.integritee.network"])
  )
);
const itpApi = itpClient.getTypedApi(itp)



let balances: BalanceRecord = {};

main()
async function main() {
  const csvFilePath = process.argv[2];
  if (!csvFilePath) {
    console.error("Usage: node index.js <csv-file-path>");
    process.exit(1);
  }
  const csvFile = fs.readFileSync(csvFilePath, "utf8");
  // filter commented lines starting with #
  const filteredCsv = csvFile
    .split("\n")
    .filter(line => !line.trim().startsWith("#"))
    .join("\n");
  const parsed = Papa.parse(filteredCsv, { header: true });
  const accountsList = parsed.data;

  //console.log(accountsList);

  for (const account of accountsList) {
    if (account.Address) {
      console.log("Fetching balances for address:", account.Address, ", Name:", account.Name);
      console.log("---- on Polkadot Relaychain ----");
      await getBalancesForAddressOnChain(dotClient, dotApi, account.Address);
      console.log("---- on PAH ----");
      await getBalancesForAddressOnChain(pahClient, pahApi, account.Address);
      console.log("---- on PPL ----");
      await getBalancesForAddressOnChain(pplClient, pplApi, account.Address);
      console.log("---- on Kusama Relaychain ----");
      await getBalancesForAddressOnChain(ksmClient, ksmApi, account.Address);
      console.log("---- on KAH ----");
      await getBalancesForAddressOnChain(kahClient, kahApi, account.Address);
      console.log("---- on KCT ----");
      await getBalancesForAddressOnChain(kctClient, kctApi, account.Address);
      console.log("---- on KPL ----");
      await getBalancesForAddressOnChain(kplClient, kplApi, account.Address);
      console.log("---- on Encointer ----");
      await getBalancesForAddressOnChain(encClient, encApi, account.Address);

      // DEPRECATED
      // console.log("---- on ITK ----");
      // await getBalancesForAddressOnChain(itkClient, itkApi, account.Address);
      // console.log("---- on ITP ----");
      // await getBalancesForAddressOnChain(itpClient, itpApi, account.Address);
    }
  }

  const { dir, name } = path.parse(csvFilePath);
  const outputFile = path.join(dir, `${name}-balances.xlsx`);

  const sheets = balanceRecordToSheets(balances, accountsList);
  const wb = XLSX.utils.book_new();
  for (const sheetName in sheets) {
    const aoa = sheets[sheetName];

    const ws = XLSX.utils.aoa_to_sheet(aoa)
    // Convert formula strings to formula cells
    for (const cell in ws) {
      if (cell[0] === "!" || typeof ws[cell].v !== "string") continue;
      if (ws[cell].v.startsWith("=")) {
        ws[cell].f = ws[cell].v.slice(1); // Remove '='
        delete ws[cell].v;
      }
    }
    // hide zero balance rows
    ws['!cols'] = getColHideFlags(aoa);

    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }
  XLSX.writeFile(wb, outputFile);
  console.log(`Balances written to ${outputFile}`);

  await dotClient.destroy();
  await pahClient.destroy();
  await pplClient.destroy();
  await ksmClient.destroy();
  await kahClient.destroy();
  await kctClient.destroy();
  await kplClient.destroy();
  await encClient.destroy();
  await itkClient.destroy();
  await itpClient.destroy();
}

async function getBalancesForAddressOnChain(client: any, api: any, address: string) {
  const spec = await client.getChainSpecData();
  const decimals = Number(spec.properties.tokenDecimals);
  const chain = spec.name;
  const symbol = spec.properties.tokenSymbol?.toString() || "UNIT";

  const accountInfo = await api.query.System.Account.getValue(address);
  if (!accountInfo) {
    return null
  }
  const { data: balance } = accountInfo;
  const reserved = new Balance(balance.reserved, decimals, symbol);
  const free = new Balance(balance.free, decimals, symbol);
  storeBalance([symbol,chain,address,"free"], free);
  storeBalance([symbol,chain,address,"reserved"], reserved);
  const miscFrozen = new Balance(balance.miscFrozen ?? 0n, decimals, symbol);
  const feeFrozen = new Balance(balance.feeFrozen ?? 0n, decimals, symbol);
  console.log(` free: ${free.toString()} reserved: ${reserved.toString()} miscFrozen: ${miscFrozen.toString()} feeFrozen: ${feeFrozen.toString()}`);
  if (reserved.decimalValue() > 0) {
    let reservedMismatch = reserved.decimalValue();
    let reservedByStaking = 0;
    try {
      const controller = await api.query.Staking.Bonded.getValue(address);
      if (controller) {
        const stakingLedger = await api.query.Staking.Ledger.getValue(controller.toString());
        if (stakingLedger && stakingLedger.active) {
          let staked = new Balance(stakingLedger.active, decimals, symbol);
          staked.label = "bonded for staking";
          console.log(`  Staked: ${staked.toString()} (controller: ${controller.toString()})`);
          reservedByStaking = staked.decimalValue()
          storeBalance([symbol, chain, address, "reserved"], staked);
        }
      }
    } catch (e) {
      console.warn("  Error fetching staking info:", e.toString());
    }

    try {
      const proxies = await api.query.Proxy.Proxies.getValue(address);
      if (proxies && proxies.length > 0 && proxies[1] > 0n) {
        const proxyDeposit = new Balance(proxies[1], decimals, symbol)
        console.log(`  Has Proxies with total deposit of: ${proxyDeposit.toString()}`);
        storeBalance([symbol, chain, "reservedReason", "proxy", address], proxyDeposit);
        reservedMismatch -= proxyDeposit.decimalValue();
      }
    } catch (e) {
      console.warn("  Error fetching proxy info:", e.toString());
    }
    // if (api.query.Multisig) {
    //   // fetch pending multisigs with deposit
    //   const multisigs = await api.query.Multisig.Multisigs.keys();
    //   const userMultisigs = multisigs.filter((key: any) => key.args[0].toString() === address);
    //   if (userMultisigs.length > 0) {
    //     console.log(`  Is part of ${userMultisigs.length} multisig(s)`);
    //   }
    // }
    try {
      const preimages = await api.query.Preimage.RequestStatusFor.getEntries();
      for (const {keyArgs, value} of preimages) {
        if (value.type === "Unrequested") {
          if (value.value.ticket[0].toString() === address) {
            const preimageDeposit = new Balance(value.value.ticket[1], decimals, symbol);
            console.log(`  Has unrequested preimage with deposit: ${preimageDeposit.toString()}`);
            storeBalance([symbol, chain, "reservedReason", `preimage(${keyArgs.toString()})`, address], preimageDeposit);
            reservedMismatch -= preimageDeposit.decimalValue();
          }
        }
      }
    } catch (e) {
      console.warn("  Error fetching preimage info:", e.toString());
    }
    try {
      const locks = await api.query.ConvictionVoting.ClassLocksFor.getValue(address);
      if (locks && locks.length > 0) {
        const maxLock = locks.reduce((max: any, lock: any) => (Number(lock[1]) > Number(max[1]) ? lock : max), locks[0]);
        const maxLockAmount = new Balance(maxLock[1], decimals, symbol);
        console.log(`  Max lock in Conviction Voting: ${maxLockAmount.toString()} (class: ${maxLock[0]})`);
        storeBalance([symbol, chain, "reservedReason", "convictionVoting", address], maxLockAmount);
        reservedMismatch -= maxLockAmount.decimalValue();
      }
    } catch (e) {
      console.warn("  Error fetching conviction voting info:", e.toString());
    }
    try {
      const referenda = await api.query.Referenda.ReferendumInfoFor.getEntries();
      for (const {keyArgs, value} of referenda) {
        //console.log(keyArgs.toString(), value);
        if (( value.type === "Rejected" || value.type === "TimedOut") && (value.value[1]?.amount && value.value[1].who?.toString() === address)) {
          const referendumDeposit = new Balance(value.value[1].amount, decimals, symbol);
          console.log(`  Referendum ${keyArgs.toString()} created by this account with deposit: ${referendumDeposit.toString()} and status: ${value.type}`);
          storeBalance([symbol, chain, "reservedReason", `referendumSubmission(${keyArgs.toString()})`, address], referendumDeposit);
          reservedMismatch -= referendumDeposit.decimalValue();
        }
        if (value.type === "Ongoing") {
          // console.log(`  Referendum ${keyArgs.toString()} is ongoing:`, value);
          const submissionDeposit = value.value.submission_deposit;
          const decisionDeposit = value.value.decision_deposit;
          if (submissionDeposit?.who?.toString() === address) {
            const referendumDeposit = new Balance(submissionDeposit.amount, decimals, symbol);
            console.log(`  Referendum ${keyArgs.toString()} created by this account with deposit: ${referendumDeposit.toString()} and status: ${value.type}`);
            storeBalance([symbol, chain, "reservedReason", `referendumSubmission(${keyArgs.toString()})`, address], referendumDeposit);
            reservedMismatch -= referendumDeposit.decimalValue();
          }
          if (decisionDeposit?.who?.toString() === address) {
            const referendumDeposit = new Balance(decisionDeposit.amount, decimals, symbol);
            console.log(`  Referendum ${keyArgs.toString()} decision deposit by this account with deposit: ${referendumDeposit.toString()} and status: ${value.type}`);
            storeBalance([symbol, chain, "reservedReason", `referendumDecision(${keyArgs.toString()})`, address], referendumDeposit);
            reservedMismatch -= referendumDeposit.decimalValue();
          }
        }
      }
    } catch (e) {
      console.warn("  Error fetching referendum info:", e.toString());
    }
    try {
      const paras = await api.query.Registrar.Paras.getEntries();
      for (const {keyArgs, value} of paras) {
        if (value.manager?.toString() === address) {
          const paraDeposit = new Balance(value.deposit, decimals, symbol);
          console.log(`  Para ${keyArgs.toString()} managed by this account with deposit: ${paraDeposit.toString()}`);
          storeBalance([symbol, chain, "reservedReason", `paras(${keyArgs.toString()})`, address], paraDeposit);
          reservedMismatch -= paraDeposit.decimalValue();
        }
      }
    } catch (e) {
      console.warn("  Error fetching parachain registrar info:", e.toString());
    }
    try {
      const leases = await api.query.Slots.Leases.getEntries();
      for (const {keyArgs, value} of leases) {
        //console.log(`paraId ${keyArgs}`);
        const maxLocks = value
          .filter(([account]) => account.toString() === address)
          .reduce((max, [, deposit]) => (BigInt(deposit) > max ? BigInt(deposit) : max), 0n);
        if (maxLocks > 0n) {
          const leaseDeposit = new Balance(maxLocks, decimals, symbol);
          console.log(`  Slot lease for para ${keyArgs.toString()} with deposit: ${leaseDeposit.toString()}`);
          storeBalance([symbol, chain, "reservedReason", `leases(${keyArgs.toString()})`, address], leaseDeposit);
          reservedMismatch -= leaseDeposit.decimalValue();
        }
      }
    } catch (e) {
      console.warn("  Error fetching parachain slot lease info:", e.toString());
    }
    try {
      const leases = await api.query.AhOps.RcLeaseReserve.getEntries();
      for (const {keyArgs, value} of leases) {
        const [blocknr, paraId, account] = keyArgs;
        if (account.toString() !== address) continue;
        const maxLocks = value
        if (maxLocks > 0n) {
          const leaseDeposit = new Balance(maxLocks, decimals, symbol);
          console.log(`  Slot lease for para ${keyArgs.toString()} with deposit: ${leaseDeposit.toString()}`);
          storeBalance([symbol, chain, "reservedReason", `leases(${keyArgs.toString()})`, address], leaseDeposit);
          reservedMismatch -= leaseDeposit.decimalValue();
        }
      }
    } catch (e) {
      console.warn("  Error fetching parachain ahOps slot lease info:", e.toString());
    }
    try {
      const channels = await api.query.Hrmp.HrmpChannels.getEntries();
      // TODO: we can't easily find hrmp channels for sovereign accounts
      //  because they're only referenced by ParaId
    } catch (e) {
      console.warn("  Error fetching parachain slot lease info:", e.toString());
    }
    try {
      const assets = await api.query.Uniques.Class.getEntries();
      for (const {keyArgs, value} of assets) {
        const classId = keyArgs[0];
        if (!value) continue;
        if (value.owner === address) {
          const totalDeposit = new Balance(value.total_deposit, decimals, symbol);
          console.log(`  Uniques class ${classId}: ${totalDeposit.toString()}`);
          storeBalance([symbol, chain, "reservedReason", `uniques(${classId})`, address], totalDeposit);
          reservedMismatch -= totalDeposit.decimalValue();
        }
      }
    } catch (e) {
      console.warn("  Error fetching uniques info:", e.toString());
    }
    try {
      // technically, nomination pool transfers funds to a different account,
      // but from the user's perspective, those funds are still "reserved" and users can use them to vote.
      const poolMember = await api.query.NominationPools.PoolMembers.getValue(address);
      if (poolMember && poolMember.points) {
        const poolId = Number(poolMember.pool_id);
        const points = new Balance(poolMember.points, decimals, symbol);
        console.log(`  In Nomination Pool ${poolId}: ${points.toString()}`);
        storeBalance([symbol,chain,`reservedReason`, `nominationPool(${poolId})`, address], points);
        reservedMismatch -= points.decimalValue();
        // claimable rewards do not count towards reserved nor free balance of this account. list separately
        const claimable = await api.apis.NominationPoolsApi.pending_rewards(address);
        if (claimable > 0n) {
          const claimableBalance = new Balance(claimable, decimals, symbol);
          console.log(`    Pending claimable rewards: ${claimableBalance.toString()}`);
          storeBalance([symbol, chain, `nominationPool`, `pendingRewards(${poolId})`, address], claimableBalance);
        }
      }
    } catch (e) {
      console.warn("  Error fetching nomination pool info:", e.toString());
    }
    if ((reservedByStaking < reserved.decimalValue() + 0.000001) && (reservedMismatch > 0.000001)) {
      console.log(`  !!! Mismatch in reserved balance accounting: ${reservedMismatch} ${symbol}`);
      storeBalance([symbol,chain,"reservedReason", `unknown`, address], new Balance(BigInt(Math.round(reservedMismatch * 10 ** decimals)), decimals, symbol));
    }
  }
  try {
    const assets = await api.query.Assets.Metadata.getEntries();
    for (const {keyArgs, value} of assets) {
      const assetId = Number(keyArgs[0]);
      //console.log(`  Checking Asset ID ${assetId}`, value);
      if (!value) continue;
      const assetSymbol = value.symbol.asText();
      const assetDecimals = Number(value.decimals);
      const assetBalance = await api.query.Assets.Account.getValue(assetId, address);
      if (assetBalance && assetBalance.balance > 0n) {
        const balance = new Balance(assetBalance.balance, assetDecimals, assetSymbol);
        storeBalance([assetSymbol,chain,address,"free"], balance);
        console.log(`  Asset ${assetId} (${assetSymbol}): ${balance.toString()}`);
      }
    }
  } catch (e) {
    console.warn("  Error fetching assets info:", e.toString());
  }
  try {
    const assets = await api.query.ForeignAssets.Metadata.getEntries();
    for (const {keyArgs, value} of assets) {
      const assetId = keyArgs[0];
      if (!value) continue;
      const assetSymbol = value.symbol.asText();
      const assetDecimals = Number(value.decimals);
      const assetBalance = await api.query.ForeignAssets.Account.getValue(assetId, address);
      if (assetBalance && assetBalance.balance > 0n) {
        const balance = new Balance(assetBalance.balance, assetDecimals, assetSymbol);
        storeBalance([assetSymbol,chain,address,"free"], balance);
        console.log(`  ForeignAsset (${assetSymbol}): ${balance.toString()}`);
      }
    }
  } catch (e) {
    console.warn("  Error fetching foreign assets info:", e.toString());
  }
  try {
    const assets = await api.query.AssetConversion.Pools.getEntries();
    for (const {keyArgs, value} of assets) {
      const [assetId1, assetId2] = keyArgs[0];
      const poolAssetId = Number(value)
      //console.log(`  Found AssetConversion pool for assets ${assetId1} and ${assetId2} with LP token asset ID ${poolAssetId}`);
      const liq = await api.query.PoolAssets.Account.getValue(poolAssetId, address);
      if (liq && liq.balance > 0n) {
        const poolAsset = await api.query.PoolAssets.Asset.getValue(poolAssetId);
        const liqTotal = poolAsset?.supply ?? 0n;
        const poolShare = Number(liq.balance) / Number(liqTotal);
        const poolMeta1 = await api.query.ForeignAssets.Metadata.getValue(assetId1);
        const poolMeta2 = await api.query.ForeignAssets.Metadata.getValue(assetId2);
        const assetSymbol1 = safeStringify(assetId1) === safeStringify(RELAY_NATIVE_FROM_PARACHAINS) ? symbol : poolMeta1.symbol.asText();
        const assetSymbol2 = safeStringify(assetId2) === safeStringify(RELAY_NATIVE_FROM_PARACHAINS) ? symbol : poolMeta2.symbol.asText();
        const assetDecimals1 = safeStringify(assetId1) === safeStringify(RELAY_NATIVE_FROM_PARACHAINS) ? decimals : Number(poolMeta1.decimals);
        const assetDecimals2 = safeStringify(assetId2) === safeStringify(RELAY_NATIVE_FROM_PARACHAINS) ? decimals : Number(poolMeta2.decimals);
        console.log(`    User has liquidity tokens: ${poolShare} of pool of ${assetSymbol1} and ${assetSymbol2}`);
        //console.log(`    Pool Asset1 (${assetDecimals1}) location:`, safeStringify(assetId1));
        //console.log(`    Pool Asset2 (${assetDecimals2}) location:`, safeStringify(assetId2));
        try {
          const reserves = await api.apis.AssetConversionApi.get_reserves(assetId1, assetId2);
          //console.log(`    Pool reserves: ${reserves[0]} ${assetSymbol1}, ${reserves[1]} ${assetSymbol2}`);
          const userAmount1 = new Balance(BigInt(Math.round(poolShare * Number(reserves[0]))), assetDecimals1, assetSymbol1);
          const userAmount2 = new Balance(BigInt(Math.round(poolShare * Number(reserves[1]))), assetDecimals2, assetSymbol2);
          console.log(`    Corresponding to underlying assets: ${userAmount1.toString()} and ${userAmount2.toString()}`);
          storeBalance([assetSymbol1,chain,"pool",`LP(${assetSymbol2}/${assetSymbol1})`,address], userAmount1);
          storeBalance([assetSymbol2,chain,"pool",`LP(${assetSymbol2}/${assetSymbol1})`,address], userAmount2);
        } catch (e) {
          console.warn("    Error fetching pool reserves:", e.toString());
        }
      }
    }
  } catch (e) {
    console.warn("  Error fetching pool assets info:", e.toString());
  }
  // TODO: collatorSelection,
  //  nfts, hrmp, alliance, society, bounties, child_bounties,
  //  identity, indices, recovery
  //console.log(reservedByStaking, reserved.decimalValue(), reservedMismatch);

  return `${free} ${symbol} (reserved: ${reserved} ${symbol}, miscFrozen: ${miscFrozen} ${symbol}, feeFrozen: ${feeFrozen} ${symbol})`
}

class Balance {
  raw: bigint;
  decimals: number;
  symbol: string;
  label?: string;

  constructor(raw: bigint, decimals: number, symbol: string) {
    this.raw = raw;
    this.decimals = decimals;
    this.symbol = symbol;
  }

  decimalValue(): number {
    return Number(this.raw) / 10 ** this.decimals;
  }

  toString(): string {
    return `${this.decimalValue()} ${this.symbol}`;
  }
}

// token, chain, address, transferrability
type BalanceRecord = Record<string, Record<string, Record<string, Record<string, Balance>>>>;

function balanceRecordToSheets(
  balances: BalanceRecord,
  accountsList: { Address: string; Name?: string }[]
) {
  const sheets: Record<string, any[][]> = {};

  for (const token in balances) {
    const rows: any[][] = [];
    // Header: Chain, Transferability/Label, ...addresses
    rows.push([
      "Chain",
      "balance kind",
      ...accountsList.map(acc => acc.Address)
    ]);
    rows.push([
      "",
      "",
      ...accountsList.map(acc => acc.Name)
    ]);
    rows.push([
      "",
      "",
      ...accountsList.map(acc => acc.BeneficialOwner)
    ]);
    rows.push([
      "Chain",
      "Type",
      ...accountsList.map(acc => acc.Controller)
    ]);


    const freeRows: number[] = [];
    const poolRows: number[] = [];
    const reservedRows: number[] = [];
    for (const chain in balances[token]) {
      let transferability = "free"
      rows.push([
        chain,
        transferability,
        ...accountsList.map(acc => {
          const accountBalances = balances[token][chain][acc.Address];
          const bal = accountBalances ? accountBalances[transferability] : undefined;
          return bal?.decimalValue() ?? "";
        })
      ]);
      freeRows.push(rows.length); // 1-based for Excel

      transferability = "reserved"
      // Collect all labels for this transferability
      const labelSet = new Set<string>();
      for (const address of accountsList.map(acc => acc.Address)) {
        const accountBalances = balances[token][chain][address];
        const bal = accountBalances ? accountBalances[transferability] : undefined;
        if (bal?.label) labelSet.add(bal.label);
      }

      // Add row for transferability (no label)
      rows.push([
        chain,
        transferability + " total",
        ...accountsList.map(acc => {
          const accountBalances = balances[token][chain][acc.Address];
          const bal = accountBalances ? accountBalances[transferability] : undefined;
          return bal?.decimalValue() ?? "";
        })
      ]);
      reservedRows.push(rows.length);

      console.log("label set:", labelSet);
      // Add rows for each label
      for (const label of labelSet) {
        rows.push([
          chain,
          `${transferability} (${label})`,
          ...accountsList.map(acc => {
            const accountBalances = balances[token][chain][acc.Address];
            const bal = accountBalances ? accountBalances[transferability] : undefined;
            return bal?.label === label ? bal.decimalValue() : "";
          })
        ]);
      }
      try {
        const reasons = Object.keys(balances[token][chain]["reservedReason"]);
        console.log("reserved reasons:", reasons);
        for (const reason of reasons) {
          transferability = `reserved: ${reason}`;
          rows.push([
            chain,
            transferability,
            ...accountsList.map(acc => {
              const accountBalances = balances[token][chain]["reservedReason"];
              const bal = accountBalances ? accountBalances[reason]?.[acc.Address] : undefined;
              return bal?.decimalValue() ?? "";
            })
          ]);
        }
      } catch (e) {
        // no reserved reasons
      }
      try {
        const pools = Object.keys(balances[token][chain]["nominationPool"]);
        console.log("nominationPools:", pools);
        for (const pool of pools) {
          transferability = `nominationPool ${pool}`;
          rows.push([
            chain,
            transferability,
            ...accountsList.map(acc => {
              const accountBalances = balances[token][chain]["nominationPool"];
              const bal = accountBalances ? accountBalances[pool]?.[acc.Address] : undefined;
              return bal?.decimalValue() ?? "";
            })
          ]);
          reservedRows.push(rows.length);
        }
      } catch (e) {
        // no nomination pools
      }
      try {
        const pools = Object.keys(balances[token][chain]["pool"]);
        console.log("pools:", pools);
        for (const pool of pools) {
          transferability = `pool ${pool} share`;
          rows.push([
            chain,
            transferability,
            ...accountsList.map(acc => {
              const accountBalances = balances[token][chain]["pool"];
              const bal = accountBalances ? accountBalances[pool]?.[acc.Address] : undefined;
              return bal?.decimalValue() ?? "";
            })
          ]);
          poolRows.push(rows.length); // 1-based for Excel
        }
      } catch (e) {
        // no pools
      }
    }


    // Add total rows with formulas
    const colOffset = 3; // first address column is column D (Excel)
    const rowCount = rows.length + 1; // Excel is 1-based

    rows.push([]);

    // Total free
    const totalFreeRow = [
      "",
      "Total free",
      ...accountsList.map((_, i) => {
        const col = String.fromCharCode(67 + i); // D, E, F, ...
        const sumRange = freeRows.map(r => `${col}${r}`).join(",");
        return `=SUM(${sumRange})`;
      })
    ];
    rows.push(totalFreeRow);

    // Total reserved
    const totalReservedRow = [
      "",
      "Total reserved",
      ...accountsList.map((_, i) => {
        const col = String.fromCharCode(67 + i);
        const sumRange = reservedRows.map(r => `${col}${r}`).join(",");
        return `=SUM(${sumRange})`;
      })
    ];
    rows.push(totalReservedRow);
    // Total pooled
    const totalPoolRow = [
      "",
      "Total pooled",
      ...accountsList.map((_, i) => {
        const col = String.fromCharCode(67 + i); // D, E, F, ...
        const sumRange = poolRows.map(r => `${col}${r}`).join(",");
        return `=SUM(${sumRange})`;
      })
    ];
    rows.push(totalPoolRow);
    // Grand total
    const grandTotalRow = [
      "",
      "Grand total",
      ...accountsList.map((_, i) => {
        const col = String.fromCharCode(67 + i);
        const freeCell = `${col}${rowCount + 1}`;
        const reservedCell = `${col}${rowCount + 2}`;
        const poolCell = `${col}${rowCount + 3}`;
        return `=${freeCell}+${reservedCell}+${poolCell}`;
      })
    ];
    rows.push(grandTotalRow);
    sheets[token] = rows;
  }
  return sheets;
}

function getColHideFlags(rows: any[][]) {
  // Always show first two columns
  return rows[0].map((_, colIdx) => {
    if (colIdx < 2) return {};
    let sum = 0;
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const val = rows[rowIdx][colIdx];
      if (typeof val === "number") sum += val;
      else if (typeof val === "string" && !isNaN(Number(val))) sum += Number(val);
    }
    if (sum === 0) {
      return { hidden: true };
    }
    return {};
  });
}

function safeStringify(obj: any) {
  return JSON.stringify(obj, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}

function storeBalance(path: (string | number)[], balance: Balance) {
  let current = balances;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (!(key in current)) current[key] = {};
    current = current[key];
  }
  current[path[path.length - 1]] = balance;
}
