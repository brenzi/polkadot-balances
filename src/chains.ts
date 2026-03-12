import { dot, pah, ppl, ksm, kah, kct, kpl, enc } from "@polkadot-api/descriptors";
import { createClient } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/node";
import { withPolkadotSdkCompat } from "polkadot-api/polkadot-sdk-compat";
import type { ProbeId } from "./probes/index.ts";

export interface ChainConfig {
  id: string;
  descriptor: any;
  wsUrls: string[];
  probes: ProbeId[];
  enabled: boolean;
}

export interface ChainRuntime {
  config: ChainConfig;
  client: any;
  api: any;
  _specCache?: { decimals: number; chain: string; symbol: string; ed: bigint };
}

export const CHAINS: ChainConfig[] = [
  {
    id: "dot",
    descriptor: dot,
    wsUrls: ["wss://polkadot.chainbricks.synology.me:4100", "wss://polkadot-rpc.n.dwellir.com", "wss://rpc.polkadot.io"],
    enabled: true,
    probes: [
      "core", "staking", "conviction", "proxy", "preimage", "referenda",
      "parachain", "nomination-pool", "hrmp", "multisig", "bounties", "holds",
    ],
  },
  {
    id: "pah",
    descriptor: pah,
    wsUrls: ["wss://bezzera.encointer.org:4130", "wss://polkadot-asset-hub-rpc.polkadot.io"],
    enabled: true,
    probes: ["core", "proxy", "uniques", "nfts", "nomination-pool", "parachain", "assets", "multisig", "holds"],
  },
  {
    id: "ksm",
    descriptor: ksm,
    wsUrls: ["wss://kusama.chainbricks.synology.me:4200", "wss://kusama-rpc.n.dwellir.com", "wss://kusama-rpc.polkadot.io"],
    enabled: true,
    probes: [
      "core", "staking", "conviction", "proxy", "preimage", "referenda",
      "parachain", "nomination-pool", "hrmp", "multisig", "bounties", "holds",
    ],
  },
  {
    id: "kah",
    descriptor: kah,
    wsUrls: ["wss://bezzera.encointer.org:4230", "wss://sys.ibp.network/asset-hub-kusama"],
    enabled: true,
    probes: ["core", "proxy", "uniques", "nfts", "nomination-pool", "assets", "multisig", "holds"],
  },
  {
    id: "enc",
    descriptor: enc,
    wsUrls: ["wss://kusama.api.encointer.org"],
    enabled: true,
    probes: ["core", "proxy", "holds"],
  },
  {
    id: "ppl",
    descriptor: ppl,
    wsUrls: ["wss://people-polkadot-rpc.n.dwellir.com", "wss://sys.ibp.network/people-polkadot"],
    enabled: false,
    probes: ["core", "proxy", "identity"],
  },
  {
    id: "kpl",
    descriptor: kpl,
    wsUrls: ["wss://sys.ibp.network/people-kusama", "wss://people-kusama-rpc.n.dwellir.com"],
    enabled: false,
    probes: ["core", "proxy", "identity"],
  },
  {
    id: "kct",
    descriptor: kct,
    wsUrls: ["wss://sys.ibp.network/coretime-kusama", "wss://coretime-kusama-rpc.n.dwellir.com"],
    enabled: false,
    probes: ["core", "proxy", "collator"],
  },
];

export function createAllClients(rpcOverrides?: Record<string, string[]>): ChainRuntime[] {
  let configs: ChainConfig[];
  if (rpcOverrides) {
    // Full override: only chains listed in rpcOverrides are used
    configs = CHAINS
      .filter((c) => rpcOverrides[c.id]?.length)
      .map((c) => ({ ...c, wsUrls: rpcOverrides[c.id]! }));
  } else {
    configs = CHAINS.filter((c) => c.enabled);
  }
  return configs.map((config) => {
    const client = createClient(withPolkadotSdkCompat(getWsProvider(config.wsUrls)));
    const api = client.getTypedApi(config.descriptor);
    return { config, client, api };
  });
}

/**
 * Probe each runtime with a simple RPC call. Returns only reachable runtimes.
 * Unreachable ones are destroyed and logged.
 */
export async function probeAndFilter(runtimes: ChainRuntime[], timeoutMs = 15000): Promise<ChainRuntime[]> {
  const results = await Promise.allSettled(
    runtimes.map(async (rt) => {
      const result: number = await Promise.race([
        rt.api.query.System.Number.getValue() as Promise<number>,
        new Promise<number>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
      ]);
      return { rt, blockNum: result };
    }),
  );

  const alive: ChainRuntime[] = [];
  for (let i = 0; i < runtimes.length; i++) {
    const r = results[i]!;
    if (r.status === "fulfilled") {
      console.log(`  ${runtimes[i]!.config.id}: reachable (block #${r.value.blockNum})`);
      alive.push(runtimes[i]!);
    } else {
      console.warn(`  ${runtimes[i]!.config.id}: unreachable (${r.reason}), skipping`);
      await runtimes[i]!.client.destroy();
    }
  }
  return alive;
}

export interface ChainBlockInfo {
  hash: string;
  number: number;
  timestamp: Date;
}

export async function fetchFinalizedBlock(rt: ChainRuntime): Promise<ChainBlockInfo> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const finalized = await rt.client.getFinalizedBlock();
    try {
      const tsMs = await rt.api.query.Timestamp.Now.getValue({ at: finalized.hash });
      return { hash: finalized.hash, number: finalized.number, timestamp: new Date(Number(tsMs)) };
    } catch {
      // Block may have been unpinned between getFinalizedBlock and query — retry
    }
  }
  // Last resort: return finalized info without exact timestamp
  const finalized = await rt.client.getFinalizedBlock();
  return { hash: finalized.hash, number: finalized.number, timestamp: new Date() };
}

export async function destroyAllClients(runtimes: ChainRuntime[]) {
  for (const rt of runtimes) {
    await rt.client.destroy();
  }
}
