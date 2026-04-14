import type { ChainRuntime } from "./chains.ts";

/**
 * Parse --at date string into a target UTC timestamp (seconds).
 * - YYYYMMDD → end of that day (23:59:59 UTC)
 * - YYYYMM → end of that month (last day 23:59:59 UTC)
 */
export function parseDateArg(at: string): number {
  if (/^\d{8}$/.test(at)) {
    const y = +at.slice(0, 4);
    const m = +at.slice(4, 6);
    const d = +at.slice(6, 8);
    return Math.floor(new Date(Date.UTC(y, m - 1, d, 23, 59, 59)).getTime() / 1000);
  }
  if (/^\d{6}$/.test(at)) {
    const y = +at.slice(0, 4);
    const m = +at.slice(4, 6);
    // day 0 of next month = last day of this month
    return Math.floor(new Date(Date.UTC(y, m, 0, 23, 59, 59)).getTime() / 1000);
  }
  throw new Error(`Invalid --at format: ${at}. Use YYYYMMDD or YYYYMM`);
}

/**
 * Resolve a UTC timestamp to a block hash on a given chain via binary search.
 * Uses Timestamp.Now storage to read block timestamps.
 */
export async function resolveBlockHashAtTimestamp(
  rt: ChainRuntime,
  targetTimestampSec: number,
): Promise<string> {
  const { client, api } = rt;
  const targetMs = BigInt(targetTimestampSec) * 1000n;

  // Get current finalized block as upper bound
  const finalized = await client.getFinalizedBlock();
  const currentHash = finalized.hash;
  const currentNumber = finalized.number;
  const currentTs = await api.query.Timestamp.Now.getValue({ at: currentHash });

  if (targetMs >= currentTs) {
    console.warn(`  Target timestamp is in the future or at current block, using finalized block`);
    return currentHash;
  }

  // Estimate block time from recent blocks
  // Go back ~100 blocks to estimate
  const sampleBack = Math.min(100, currentNumber);
  const sampleNumber = currentNumber - sampleBack;
  const sampleHash = await blockNumberToHash(client, sampleNumber);
  const sampleTs = await api.query.Timestamp.Now.getValue({ at: sampleHash });
  const blockTimeMs = Number(currentTs - sampleTs) / sampleBack;

  // Initial estimate
  const msToTarget = Number(currentTs - targetMs);
  const blocksBack = Math.floor(msToTarget / blockTimeMs);
  let lo = Math.max(0, currentNumber - blocksBack - 1000); // generous lower bound
  let hi = currentNumber;

  // Binary search
  for (let i = 0; i < 30; i++) {
    if (hi - lo <= 1) break;
    const mid = Math.floor((lo + hi) / 2);
    const midHash = await blockNumberToHash(client, mid);
    const midTs = await api.query.Timestamp.Now.getValue({ at: midHash });
    if (midTs <= targetMs) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  // lo is the last block at or before target timestamp
  const resultHash = await blockNumberToHash(client, lo);
  const resultTs = await api.query.Timestamp.Now.getValue({ at: resultHash });
  console.log(
    `  Resolved block #${lo} (ts: ${new Date(Number(resultTs)).toISOString()}) for target ${new Date(targetTimestampSec * 1000).toISOString()}`,
  );
  return resultHash;
}

/**
 * Resolve a relay chain block number to a block hash, then find the corresponding
 * parachain block by matching timestamps.
 */
export async function resolveBlockHashAtNumber(
  rt: ChainRuntime,
  blockNumber: number,
): Promise<string> {
  return blockNumberToHash(rt.client, blockNumber);
}

async function blockNumberToHash(client: any, blockNumber: number): Promise<string> {
  // polkadot-api: use the raw RPC call
  const hash = await client._request("chain_getBlockHash", [blockNumber]);
  return hash as string;
}
