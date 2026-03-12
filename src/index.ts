import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseArgs } from "node:util";
import Papa from "papaparse";
import XLSX from "xlsx";
import { type BalanceRecord } from "./balance.ts";
import { createAllClients, destroyAllClients, probeAndFilter, fetchFinalizedBlock, type ChainBlockInfo } from "./chains.ts";
import { getBalancesForAddressOnChain } from "./query.ts";
import { balanceRecordToSheets, getColHideFlags } from "./output/sheet-layout.ts";
import { writeToGoogleSheets, checkGoogleSheetsAccess } from "./output/google-sheets.ts";
import { parseDateArg, resolveBlockHashAtTimestamp, resolveBlockHashAtNumber } from "./block-at.ts";

function resolvePath(p: string): string {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

export interface RunConfig {
  accounts: { address: string; name?: string; beneficialOwner?: string; controller?: string }[];
  sheetId?: string;
  credentials?: string;
  rpcNodes?: Record<string, string[]>;
}

// Suppress polkadot-api internal noise
const _origError = console.error;
console.error = (...args: any[]) => {
  const first = args[0];
  if (first?.code === -32601) return; // RpcError object from chainHead probes
  if (typeof first === "string" && first.includes("-32601")) return;
  _origError.apply(console, args);
};
process.on("unhandledRejection", (reason: any) => {
  if (reason?.code === -32601) return;
  _origError("Unhandled rejection:", reason);
});
const _origWarn = console.warn;
console.warn = (...args: any[]) => {
  if (typeof args[0] === "string" && args[0].startsWith("Runtime entry") && args[0].includes("not found")) return;
  _origWarn.apply(console, args);
};

main();

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    options: {
      config: { type: "string" },
      at: { type: "string" },
      "at-block": { type: "string" },
      "sheet-id": { type: "string" },
      credentials: { type: "string" },
    },
    allowPositionals: true,
  });

  let accountsList: { Address: string; Name?: string; BeneficialOwner?: string; Controller?: string }[];
  let sheetId: string | undefined;
  let credPath: string | undefined;
  let rpcOverrides: Record<string, string[]> | undefined;

  if (values.config) {
    const cfg: RunConfig = JSON.parse(fs.readFileSync(resolvePath(values.config), "utf8"));
    accountsList = cfg.accounts.map((a) => ({
      Address: a.address,
      Name: a.name,
      BeneficialOwner: a.beneficialOwner,
      Controller: a.controller,
    }));
    sheetId = cfg.sheetId;
    credPath = cfg.credentials ? resolvePath(cfg.credentials) : undefined;
    rpcOverrides = cfg.rpcNodes;
  } else {
    const csvFilePath = positionals[0];
    if (!csvFilePath) {
      console.error("Usage: bun run src/index.ts [--config config.json] | <csv-file-path> [--at YYYYMMDD|YYYYMM] [--at-block NUMBER]");
      process.exit(1);
    }
    const csvFile = fs.readFileSync(resolvePath(csvFilePath), "utf8");
    const filteredCsv = csvFile
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    const parsed = Papa.parse(filteredCsv, { header: true });
    accountsList = parsed.data as typeof accountsList;
    sheetId = values["sheet-id"] ?? process.env.GOOGLE_SHEET_ID;
    credPath = values.credentials ? resolvePath(values.credentials) : process.env.GOOGLE_APPLICATION_CREDENTIALS;
  }

  // --- Preflight checks (fail fast before any chain queries) ---

  // 1. Credentials file
  if (credPath) {
    if (!fs.existsSync(credPath)) {
      console.error(`Credentials file not found: ${credPath}`);
      process.exit(1);
    }
  }

  // 2. Google Sheets access
  if (sheetId) {
    if (!credPath) {
      console.error("--credentials or GOOGLE_APPLICATION_CREDENTIALS required when using --sheet-id");
      process.exit(1);
    }
    console.log("Checking Google Sheets access...");
    try {
      await checkGoogleSheetsAccess({ sheetId, credentialsPath: credPath });
      console.log("  Google Sheets access OK");
    } catch (e: any) {
      console.error(`Google Sheets access failed: ${e.message ?? e}`);
      process.exit(1);
    }
  }

  // 3. xlsx output path writable
  if (!sheetId) {
    const basePath = values.config ?? positionals[0]!;
    const { dir } = path.parse(resolvePath(basePath));
    const outputDir = dir || ".";
    const testFile = path.join(outputDir, `.balances-write-test-${Date.now()}`);
    try {
      fs.writeFileSync(testFile, "");
      fs.unlinkSync(testFile);
    } catch (e: any) {
      console.error(`Cannot write to output directory ${outputDir}: ${e.message}`);
      process.exit(1);
    }
  }

  // 4. Create clients and probe RPC endpoints
  console.log("Probing RPC endpoints...");
  const allRuntimes = createAllClients(rpcOverrides);
  let runtimes = await probeAndFilter(allRuntimes);
  if (runtimes.length === 0) {
    console.error("No reachable chains. Aborting.");
    process.exit(1);
  }

  const balances: BalanceRecord = {};
  const chainBlockInfo = new Map<string, ChainBlockInfo>();

  // Pin a specific block per chain
  if (values.at) {
    const targetTs = parseDateArg(values.at);
    console.log(`Resolving block hashes for date ${new Date(targetTs * 1000).toISOString()}...`);
    for (const rt of runtimes) {
      console.log(`  Resolving for ${rt.config.id}...`);
      const hash = await resolveBlockHashAtTimestamp(rt, targetTs);
      const blockNum = await rt.api.query.System.Number.getValue({ at: hash });
      const tsMs = await rt.api.query.Timestamp.Now.getValue({ at: hash });
      chainBlockInfo.set(rt.config.id, { hash, number: Number(blockNum), timestamp: new Date(Number(tsMs)) });
    }
  } else if (values["at-block"]) {
    const blockNum = parseInt(values["at-block"], 10);
    if (isNaN(blockNum)) {
      console.error("--at-block must be a number");
      process.exit(1);
    }
    console.log(`Resolving block hashes for block #${blockNum}...`);
    const relayRt = runtimes.find((rt) => rt.config.id === "dot" || rt.config.id === "ksm");
    let relayTs: number | undefined;
    if (relayRt) {
      const hash = await resolveBlockHashAtNumber(relayRt, blockNum);
      const tsMs = await relayRt.api.query.Timestamp.Now.getValue({ at: hash });
      relayTs = Number(tsMs) / 1000;
      chainBlockInfo.set(relayRt.config.id, { hash, number: blockNum, timestamp: new Date(Number(tsMs)) });
      console.log(`  Relay block #${blockNum} timestamp: ${new Date(relayTs * 1000).toISOString()}`);
    }
    for (const rt of runtimes) {
      if (chainBlockInfo.has(rt.config.id)) continue;
      if (relayTs) {
        console.log(`  Resolving for ${rt.config.id} via timestamp...`);
        const hash = await resolveBlockHashAtTimestamp(rt, relayTs);
        const num = await rt.api.query.System.Number.getValue({ at: hash });
        const tsMs = await rt.api.query.Timestamp.Now.getValue({ at: hash });
        chainBlockInfo.set(rt.config.id, { hash, number: Number(num), timestamp: new Date(Number(tsMs)) });
      } else {
        const hash = await resolveBlockHashAtNumber(rt, blockNum);
        const tsMs = await rt.api.query.Timestamp.Now.getValue({ at: hash });
        chainBlockInfo.set(rt.config.id, { hash, number: blockNum, timestamp: new Date(Number(tsMs)) });
      }
    }
  }
  // For --at/--at-block, blocks are already pinned above.
  // For the default case, pin lazily per-chain right before querying (avoids stale pins).
  const useExplicitAt = !!(values.at || values["at-block"]);

  const refreshTime = new Date();

  for (const account of accountsList) {
    if (account.Address) {
      console.log("Fetching balances for address:", account.Address, ", Name:", account.Name);
      for (const rt of runtimes) {
        console.log(`---- on ${rt.config.id.toUpperCase()} ----`);

        // Lazy pin: fetch finalized block right before first query on this chain
        if (!useExplicitAt && !chainBlockInfo.has(rt.config.id)) {
          try {
            const info = await fetchFinalizedBlock(rt);
            chainBlockInfo.set(rt.config.id, info);
            console.log(`  pinned #${info.number} (${info.timestamp.toISOString()})`);
          } catch (e: any) {
            console.warn(`  Could not pin block: ${e.message}`);
          }
        }

        const at = chainBlockInfo.get(rt.config.id)?.hash;
        try {
          await getBalancesForAddressOnChain(rt, account.Address, balances, at);
        } catch (e: any) {
          if (at && (e.message?.includes("not pinned") || e.code === -32601)) {
            // Block was unpinned or chainHead RPC failed — re-pin and retry
            console.warn(`  Block stale, re-pinning...`);
            try {
              const info = await fetchFinalizedBlock(rt);
              chainBlockInfo.set(rt.config.id, info);
              await getBalancesForAddressOnChain(rt, account.Address, balances, info.hash);
            } catch {
              // Last resort: query without at
              console.warn(`  Re-pin failed, querying at latest finalized`);
              await getBalancesForAddressOnChain(rt, account.Address, balances, undefined);
            }
          } else {
            throw e;
          }
        }
      }
    }
  }

  // Build chain spec name → block number map for sheet labels
  const chainBlocks: Record<string, number> = {};
  for (const rt of runtimes) {
    const info = chainBlockInfo.get(rt.config.id);
    if (rt._specCache && info) {
      chainBlocks[rt._specCache.chain] = info.number;
    }
  }

  const { sheets, sheetMeta } = balanceRecordToSheets(balances, accountsList, chainBlocks);

  // Output to Google Sheets or xlsx
  if (sheetId) {
    await writeToGoogleSheets({ sheetId, credentialsPath: credPath! }, sheets, sheetMeta, refreshTime);
  } else {
    const basePath = resolvePath(values.config ?? positionals[0]!);
    const { dir, name } = path.parse(basePath);
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
