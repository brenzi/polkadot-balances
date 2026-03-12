import type { Balance } from "../balance.ts";
import { coreProbe } from "./core.ts";
import { stakingProbe } from "./staking.ts";
import { convictionProbe } from "./conviction.ts";
import { proxyProbe } from "./proxy.ts";
import { preimageProbe } from "./preimage.ts";
import { referendaProbe } from "./referenda.ts";
import { parachainProbe } from "./parachain.ts";
import { uniquesProbe } from "./uniques.ts";
import { nftsProbe } from "./nfts.ts";
import { nominationPoolProbe } from "./nomination-pool.ts";
import { assetsProbe } from "./assets.ts";
import { collatorProbe } from "./collator.ts";
import { identityProbe } from "./identity.ts";
import { multisigProbe } from "./multisig.ts";
import { bountiesProbe } from "./bounties.ts";
import { societyProbe } from "./society.ts";
import { recoveryProbe } from "./recovery.ts";
import { holdsProbe } from "./holds.ts";
import { hrmpProbe } from "./hrmp.ts";

export type ProbeId =
  | "core"
  | "staking"
  | "conviction"
  | "proxy"
  | "preimage"
  | "referenda"
  | "parachain"
  | "uniques"
  | "nfts"
  | "nomination-pool"
  | "assets"
  | "collator"
  | "identity"
  | "multisig"
  | "bounties"
  | "society"
  | "recovery"
  | "holds"
  | "hrmp";

export type ProbeContext = {
  api: any;
  client: any;
  address: string;
  decimals: number;
  symbol: string;
  chain: string;
  ed: Balance;
  store: (path: string[], balance: Balance) => void;
  at?: string; // block hash for historical queries
};

export type BalanceProbe = {
  id: ProbeId;
  run: (ctx: ProbeContext) => Promise<number>; // returns reserved amount accounted for
};

/** Build PullOptions only when `at` is defined, to avoid passing { at: undefined } */
export function atOpt(ctx: ProbeContext): [options: { at: string }] | [] {
  return ctx.at ? [{ at: ctx.at }] : [];
}

export const probeRegistry: Partial<Record<ProbeId, BalanceProbe>> = {
  core: coreProbe,
  staking: stakingProbe,
  conviction: convictionProbe,
  proxy: proxyProbe,
  preimage: preimageProbe,
  referenda: referendaProbe,
  parachain: parachainProbe,
  uniques: uniquesProbe,
  nfts: nftsProbe,
  "nomination-pool": nominationPoolProbe,
  assets: assetsProbe,
  collator: collatorProbe,
  identity: identityProbe,
  multisig: multisigProbe,
  bounties: bountiesProbe,
  society: societyProbe,
  recovery: recoveryProbe,
  holds: holdsProbe,
  hrmp: hrmpProbe,
};
