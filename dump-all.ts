import { dot, pah, ppl, ksm, kah, kct, kpl, enc, itp, itk } from "@polkadot-api/descriptors"
import { createClient, Binary } from "polkadot-api"
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import Papa from "papaparse";
import * as fs from "fs";

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


main()
async function main() {
  console.log("---- on ITK ----");
  await getAllBalancesOnChain(itkClient, itkApi);
  console.log("---- on ITP ----");
  await getAllBalancesOnChain(itpClient, itpApi);

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

async function getAllBalancesOnChain(client: any, api: any) {
  const spec = await client.getChainSpecData();
  const decimals = Number(spec.properties.tokenDecimals);
  const chain = spec.name;
  const symbol = spec.properties.tokenSymbol?.toString() || "UNIT";

  const accounts = await api.query.System.Account.getEntries();
  const rows = accounts.map(({ keyArgs, value }: any) => {
    const address = keyArgs[0].toString();
    const free = new Balance(value.data.free, decimals, symbol);
    const reserved = new Balance(value.data.reserved, decimals, symbol);
    console.log(`-)   Address: ${address} on ${chain} (${symbol}) - free: ${free.decimalValue()} reserved: ${reserved.decimalValue()}`);
    return { address, free: free.decimalValue(), reserved: reserved.decimalValue() };
  });
  const csv = Papa.unparse(rows);
  fs.writeFileSync(`all-accounts-${chain}-${symbol}.csv`, csv);
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

function safeStringify(obj: any) {
  return JSON.stringify(obj, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}
