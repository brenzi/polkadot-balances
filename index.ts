import { dot, pah, ksm, kah } from "@polkadot-api/descriptors"
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

const kahClient = createClient(
  withPolkadotSdkCompat(
    getWsProvider(["wss://bezzera.integritee.network:4230"])
  )
);
const kahApi = kahClient.getTypedApi(kah)

let balances: BalanceRecord = {};

main()
async function main() {
  const csvFilePath = process.argv[2];
  if (!csvFilePath) {
    console.error("Usage: node index.js <csv-file-path>");
    process.exit(1);
  }
  const csvFile = fs.readFileSync(csvFilePath, "utf8");
  const parsed = Papa.parse(csvFile, { header: true });
  const accountsList = parsed.data;

  //console.log(accountsList);

  for (const account of accountsList) {
    if (account.Address) {
      console.log("Fetching balances for address:", account.Address, ", Name:", account.Name);
      console.log("---- on Polkadot Relaychain ----");
      await getBalancesForAddressOnChain(dotClient, dotApi, account.Address);
      console.log("---- on PAH ----");
      await getBalancesForAddressOnChain(pahClient, pahApi, account.Address);
      console.log("---- on Kusama Relaychain ----");
      await getBalancesForAddressOnChain(ksmClient, ksmApi, account.Address);
      console.log("---- on KAH ----");
      await getBalancesForAddressOnChain(kahClient, kahApi, account.Address);

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
  await ksmClient.destroy();
  await kahClient.destroy();
}

async function getBalancesForAddressOnChain(client: any, api: any, address: string) {
  const spec = await client.getChainSpecData();
  const decimals = Number(spec.properties.tokenDecimals);
  const chain = spec.name;
  const symbol = spec.properties.tokenSymbol?.toString() || "UNIT";
  if (!balances[symbol]) balances[symbol] = {};
  if (!balances[symbol][chain]) balances[symbol][chain] = {};
  if (!balances[symbol][chain][address]) balances[symbol][chain][address] = {};

  const accountInfo = await api.query.System.Account.getValue(address);
  if (!accountInfo) {
    return null
  }
  const { data: balance } = accountInfo;
  const reserved = new Balance(balance.reserved, decimals, symbol);
  const free = new Balance(balance.free, decimals, symbol);
  balances[symbol][chain][address]["free"] = free;
  balances[symbol][chain][address]["reserved"] = reserved;
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
          staked.label="bonded for staking";
          console.log(`  Staked: ${staked.toString()} (controller: ${controller.toString()})`);
          reservedByStaking = staked.decimalValue()
          balances[symbol][chain][address]["reserved"] = staked;
        }
      }
    } catch (e) {
      // console.log("  Error fetching staking info:", e.toString());
    }
    try {
      const poolMember = await api.query.NominationPools.PoolMembers.getValue(address);
      if (poolMember && poolMember.points) {
        const points = new Balance(poolMember.points, decimals, symbol);
        console.log(`  In Nomination Pool: ${points.toString()}`);
        reservedMismatch -= points.decimalValue();
      }
      //TODO: pending claims on pool rewards are not yet counted towards total balance here
    } catch (e) {
      // console.log("  Error fetching nomination pool info:", e.toString());
    }
    try {
      const proxies = await api.query.Proxy.Proxies.getValue(address);
      if (proxies && proxies.length > 0 && proxies[1] > 0n) {
        const proxyDeposit = new Balance(proxies[1], decimals, symbol)
        console.log(`  Has Proxies with total deposit of: ${proxyDeposit.toString()}`);
        reservedMismatch -= proxyDeposit.decimalValue();
      }
    } catch (e) {
      // console.log("  Error fetching proxy info:", e.toString());
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
            reservedMismatch -= preimageDeposit.decimalValue();
          }
        }
      }
    } catch (e) {
      // console.log("  Error fetching preimage info:", e.toString());
    }
    try {
      const locks = await api.query.ConvictionVoting.ClassLocksFor.getValue(address);
      if (locks && locks.length > 0) {
        const maxLock = locks.reduce((max: any, lock: any) => (Number(lock[1]) > Number(max[1]) ? lock : max), locks[0]);
        const maxLockAmount = new Balance(maxLock[1], decimals, symbol);
        console.log(`  Max lock in Conviction Voting: ${maxLockAmount.toString()} (class: ${maxLock[0]})`);
        reservedMismatch -= maxLockAmount.decimalValue();
      }
    } catch (e) {
      //console.log("  Error fetching conviction voting info:", e.toString());
    }
    try {
      const referenda = await api.query.Referenda.ReferendumInfoFor.getEntries();
      for (const {keyArgs, value} of referenda) {
        //console.log(keyArgs.toString(), value);
        if (value.value[1]?.amount && value.value[1].who?.toString() === address) {
          const referendumDeposit = new Balance(value.value[1].amount, decimals, symbol);
          console.log(`  Referendum ${keyArgs.toString()} created by this account with deposit: ${referendumDeposit.toString()} and status: ${value.type}`);
          reservedMismatch -= referendumDeposit.decimalValue();
        }
      }
    } catch (e) {
      //console.log("  Error fetching referendum info:", e.toString());
    }
    try {
      const paras = await api.query.Registrar.Paras.getEntries();
      for (const {keyArgs, value} of paras) {
        if (value.manager?.toString() === address) {
          const paraDeposit = new Balance(value.deposit, decimals, symbol);
          console.log(`  Para ${keyArgs.toString()} managed by this account with deposit: ${paraDeposit.toString()}`);
          reservedMismatch -= paraDeposit.decimalValue();
        }
      }
    } catch (e) {
      //console.log("  Error fetching parachain registrar info:", e.toString());
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
          reservedMismatch -= leaseDeposit.decimalValue();
        }
      }
    } catch (e) {
      //console.log("  Error fetching parachain slot lease info:", e.toString());
    }
    // TODO: collatorSelection, assets (poolAssets, foreignAssets),
    //  uniques, nfts, hrmp, alliance, society, bounties, child_bounties,
    //  identity, indices, recovery
    //console.log(reservedByStaking, reserved.decimalValue(), reservedMismatch);
    if ((reservedByStaking < reserved.decimalValue() + 0.000001) && (reservedMismatch > 0.000001)) {
      console.log(`  !!! Mismatch in reserved balance accounting: ${reservedMismatch} ${symbol}`);
    }
  }
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
    }


    // Add total rows with formulas
    const colOffset = 3; // first address column is column D (Excel)
    const rowCount = rows.length + 1; // Excel is 1-based

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

    // Grand total
    const grandTotalRow = [
      "",
      "Grand total",
      ...accountsList.map((_, i) => {
        const col = String.fromCharCode(67 + i);
        const freeCell = `${col}${rowCount}`;
        const reservedCell = `${col}${rowCount + 1}`;
        return `=${freeCell}+${reservedCell}`;
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
