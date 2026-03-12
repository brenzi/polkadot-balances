import { itp, itk } from "@polkadot-api/descriptors";
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import Papa from "papaparse";
import * as fs from "fs";
import { Balance } from "./src/balance.ts";

const itkClient = createClient(
  withPolkadotSdkCompat(getWsProvider(["wss://kusama.api.integritee.network"])),
);
const itkApi = itkClient.getTypedApi(itk);

const itpClient = createClient(
  withPolkadotSdkCompat(getWsProvider(["wss://polkadot.api.integritee.network"])),
);
const itpApi = itpClient.getTypedApi(itp);

main();
async function main() {
  console.log("---- on ITK ----");
  await getAllBalancesOnChain(itkClient, itkApi);
  console.log("---- on ITP ----");
  await getAllBalancesOnChain(itpClient, itpApi);

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
    console.log(
      `-)   Address: ${address} on ${chain} (${symbol}) - free: ${free.decimalValue()} reserved: ${reserved.decimalValue()}`,
    );
    return { address, free: free.decimalValue(), reserved: reserved.decimalValue() };
  });
  const csv = Papa.unparse(rows);
  fs.writeFileSync(`all-accounts-${chain}-${symbol}.csv`, csv);
}
