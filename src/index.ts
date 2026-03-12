import * as fs from "fs";
import * as path from "path";
import { parseArgs } from "node:util";
import Papa from "papaparse";
import XLSX from "xlsx";
import { type BalanceRecord } from "./balance.ts";
import { createAllClients, destroyAllClients } from "./chains.ts";
import { getBalancesForAddressOnChain } from "./query.ts";
import { balanceRecordToSheets, getColHideFlags } from "./output/sheet-layout.ts";
import { writeToGoogleSheets } from "./output/google-sheets.ts";
import { parseDateArg, resolveBlockHashAtTimestamp, resolveBlockHashAtNumber } from "./block-at.ts";

main();

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      at: { type: "string" },
      "at-block": { type: "string" },
      "sheet-id": { type: "string" },
      credentials: { type: "string" },
    },
    allowPositionals: true,
  });

  const csvFilePath = positionals[0];
  if (!csvFilePath) {
    console.error("Usage: bun run src/index.ts <csv-file-path> [--at YYYYMMDD|YYYYMM] [--at-block NUMBER]");
    process.exit(1);
  }

  const csvFile = fs.readFileSync(csvFilePath, "utf8");
  const filteredCsv = csvFile
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  const parsed = Papa.parse(filteredCsv, { header: true });
  const accountsList = parsed.data as {
    Address: string;
    Name?: string;
    BeneficialOwner?: string;
    Controller?: string;
  }[];

  const runtimes = createAllClients();
  const balances: BalanceRecord = {};

  // Resolve --at / --at-block to per-chain block hashes
  const chainBlockHashes = new Map<string, string>();
  if (values.at) {
    const targetTs = parseDateArg(values.at);
    console.log(`Resolving block hashes for date ${new Date(targetTs * 1000).toISOString()}...`);
    for (const rt of runtimes) {
      console.log(`  Resolving for ${rt.config.id}...`);
      const hash = await resolveBlockHashAtTimestamp(rt, targetTs);
      chainBlockHashes.set(rt.config.id, hash);
    }
  } else if (values["at-block"]) {
    const blockNum = parseInt(values["at-block"], 10);
    if (isNaN(blockNum)) {
      console.error("--at-block must be a number");
      process.exit(1);
    }
    // For --at-block, resolve the block on each chain.
    // For relay chains, use the block number directly.
    // For parachains, resolve via timestamp of the relay block.
    console.log(`Resolving block hashes for block #${blockNum}...`);
    // First, resolve the relay chain block to get its timestamp
    const relayRt = runtimes.find((rt) => rt.config.id === "dot" || rt.config.id === "ksm");
    let relayTs: number | undefined;
    if (relayRt) {
      const hash = await resolveBlockHashAtNumber(relayRt, blockNum);
      chainBlockHashes.set(relayRt.config.id, hash);
      const tsMs = await relayRt.api.query.Timestamp.Now.getValue({ at: hash });
      relayTs = Number(tsMs) / 1000;
      console.log(`  Relay block #${blockNum} timestamp: ${new Date(relayTs * 1000).toISOString()}`);
    }
    // For other chains, resolve via timestamp
    for (const rt of runtimes) {
      if (chainBlockHashes.has(rt.config.id)) continue;
      if (relayTs) {
        console.log(`  Resolving for ${rt.config.id} via timestamp...`);
        const hash = await resolveBlockHashAtTimestamp(rt, relayTs);
        chainBlockHashes.set(rt.config.id, hash);
      } else {
        // No relay chain context — use block number directly (best effort)
        const hash = await resolveBlockHashAtNumber(rt, blockNum);
        chainBlockHashes.set(rt.config.id, hash);
      }
    }
  }

  for (const account of accountsList) {
    if (account.Address) {
      console.log("Fetching balances for address:", account.Address, ", Name:", account.Name);
      for (const rt of runtimes) {
        console.log(`---- on ${rt.config.id.toUpperCase()} ----`);
        const at = chainBlockHashes.get(rt.config.id);
        await getBalancesForAddressOnChain(rt, account.Address, balances, at);
      }
    }
  }

  const { sheets, sheetMeta } = balanceRecordToSheets(balances, accountsList);

  // Output to Google Sheets or xlsx
  const sheetId = values["sheet-id"] ?? process.env.GOOGLE_SHEET_ID;
  const credPath = values.credentials ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (sheetId) {
    if (!credPath) {
      console.error("--credentials or GOOGLE_APPLICATION_CREDENTIALS required when using --sheet-id");
      process.exit(1);
    }
    await writeToGoogleSheets({ sheetId, credentialsPath: credPath }, sheets, sheetMeta);
  } else {
    const { dir, name } = path.parse(csvFilePath);
    const outputFile = path.join(dir, `${name}-balances.xlsx`);
    const wb = XLSX.utils.book_new();
    for (const sheetName in sheets) {
      const aoa = sheets[sheetName]!;
      const ws = XLSX.utils.aoa_to_sheet(aoa);
      for (const cell in ws) {
        if (cell[0] === "!" || typeof ws[cell].v !== "string") continue;
        if (ws[cell].v.startsWith("=")) {
          ws[cell].f = ws[cell].v.slice(1);
          delete ws[cell].v;
        }
      }
      ws["!cols"] = getColHideFlags(aoa);
      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }
    XLSX.writeFile(wb, outputFile);
    console.log(`Balances written to ${outputFile}`);
  }

  await destroyAllClients(runtimes);
}
