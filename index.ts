import { dot } from "@polkadot-api/descriptors"
import { createClient, Binary } from "polkadot-api"
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import * as fs from "fs";
import Papa from "papaparse";
import { firstValueFrom } from "rxjs";

const dotClient = createClient(
  withPolkadotSdkCompat(
    getWsProvider(["wss://polkadot-relay-2.api.integritee.network:443", "wss://polkadot.chainbricks.synology.me:4100"])
  )
);
const dotApi = dotClient.getTypedApi(dot)

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
      await getBalancesForAddressOnChain(dotApi, account.Address);
    }
  }
  await dotClient.destroy();
}

async function getBalancesForAddressOnChain(api: any, address: string) {
  const spec = await dotClient.getChainSpecData();
  const decimals = Number(spec.properties.tokenDecimals);
  const symbol = spec.properties.tokenSymbol?.toString() || "UNIT";

  const accountInfo = await api.query.System.Account.getValue(address);
  if (!accountInfo) {
    return null
  }
  const { data: balance } = accountInfo;
  const reserved = new Balance(balance.reserved, decimals, symbol);
  const free = new Balance(balance.free, decimals, symbol);
  const miscFrozen = new Balance(balance.miscFrozen ?? 0n, decimals, symbol);
  const feeFrozen = new Balance(balance.feeFrozen ?? 0n, decimals, symbol);
  console.log(` free: ${free.toString()} reserved: ${reserved.toString()} miscFrozen: ${miscFrozen.toString()} feeFrozen: ${feeFrozen.toString()}`);
  if (reserved.decimalValue() > 0) {
    let reservedMismatch = reserved.decimalValue();
    let reservedByStaking = 0;
    if (api.query.Staking) {
      const controller = await api.query.Staking.Bonded.getValue(address);
      if (controller) {
        const stakingLedger = await api.query.Staking.Ledger.getValue(controller.toString());
        if (stakingLedger && stakingLedger.active) {
          const staked = new Balance(stakingLedger.active, decimals, symbol);
          console.log(`  Staked: ${staked.toString()} (controller: ${controller.toString()})`);
          reservedByStaking = staked.decimalValue()
        }
      }
    }
    if (api.query.NominationPools) {
      const poolMember = await api.query.NominationPools.PoolMembers.getValue(address);
      if (poolMember && poolMember.points) {
        const points = new Balance(poolMember.points, decimals, symbol);
        console.log(`  In Nomination Pool: ${points.toString()}`);
        reservedMismatch -= points.decimalValue();
      }
      //TODO: pending claims on pool rewards are not yet counted towards total balance here
    }
    if (api.query.Proxy) {
      const proxies = await api.query.Proxy.Proxies.getValue(address);
      if (proxies && proxies.length > 0 && proxies[1] > 0n) {
        const proxyDeposit = new Balance(proxies[1], decimals, symbol)
        console.log(`  Has Proxies with total deposit of: ${proxyDeposit.toString()}`);
        reservedMismatch -= proxyDeposit.decimalValue();
      }
    }
    // if (api.query.Multisig) {
    //   // fetch pending multisigs with deposit
    //   const multisigs = await api.query.Multisig.Multisigs.keys();
    //   const userMultisigs = multisigs.filter((key: any) => key.args[0].toString() === address);
    //   if (userMultisigs.length > 0) {
    //     console.log(`  Is part of ${userMultisigs.length} multisig(s)`);
    //   }
    // }
    if (api.query.Preimage) {
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
    }
    if (api.query.ConvictionVoting) {
      const locks = await api.query.ConvictionVoting.ClassLocksFor.getValue(address);
      if (locks && locks.length > 0) {
        const maxLock = locks.reduce((max: any, lock: any) => (Number(lock[1]) > Number(max[1]) ? lock : max), locks[0]);
        const maxLockAmount = new Balance(maxLock[1], decimals, symbol);
        console.log(`  Max lock in Conviction Voting: ${maxLockAmount.toString()} (class: ${maxLock[0]})`);
        reservedMismatch -= maxLockAmount.decimalValue();
      }
    }
    if (api.query.Referenda) {
      const referenda = await api.query.Referenda.ReferendumInfoFor.getEntries();
      for (const {keyArgs, value} of referenda) {
        //console.log(keyArgs.toString(), value);
        if (value.value[1]?.amount && value.value[1].who?.toString() === address) {
          const referendumDeposit = new Balance(value.value[1].amount, decimals, symbol);
          console.log(`  Referendum ${keyArgs.toString()} created by this account with deposit: ${referendumDeposit.toString()} and status: ${value.type}`);
          reservedMismatch -= referendumDeposit.decimalValue();
        }
      }
    }
    if (api.query.Registrar) {
      const paras = await api.query.Registrar.Paras.getEntries();
      for (const {keyArgs, value} of paras) {
        if (value.manager?.toString() === address) {
          const paraDeposit = new Balance(value.deposit, decimals, symbol);
          console.log(`  Para ${keyArgs.toString()} managed by this account with deposit: ${paraDeposit.toString()}`);
          reservedMismatch -= paraDeposit.decimalValue();
        }
      }
    }
    if (api.query.Slots) {
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
    }
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
