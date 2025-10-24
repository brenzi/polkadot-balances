import {XcmV5Junctions} from "@polkadot-api/descriptors";

export const tokenDecimals = {
    TEER: 12,
    KSM: 12,
    DOT: 10,
}

export const RELAY_NATIVE_FROM_PARACHAINS = {
    parents: 1,
    interior: XcmV5Junctions.Here(),
}
