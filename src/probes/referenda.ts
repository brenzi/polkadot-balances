import { Balance } from "../balance.ts";
import type { BalanceProbe, ProbeContext } from "./index.ts";
import { atOpt } from "./index.ts";

export const referendaProbe: BalanceProbe = {
  id: "referenda",
  async run(ctx: ProbeContext): Promise<number> {
    const { api, address, decimals, symbol, chain, store } = ctx;
    let accounted = 0;
    try {
      const referenda = await api.query.Referenda.ReferendumInfoFor.getEntries(...atOpt(ctx));
      for (const { keyArgs, value } of referenda) {
        if (
          (value.type === "Rejected" || value.type === "TimedOut") &&
          value.value[1]?.amount &&
          value.value[1].who?.toString() === address
        ) {
          const referendumDeposit = new Balance(value.value[1].amount, decimals, symbol);
          console.log(
            `  Referendum ${keyArgs.toString()} created by this account with deposit: ${referendumDeposit.toString()} and status: ${value.type}`,
          );
          store(
            [symbol, chain, "reservedReason", `referendumSubmission(${keyArgs.toString()})`, address],
            referendumDeposit,
          );
          accounted += referendumDeposit.decimalValue();
        }
        if (value.type === "Ongoing") {
          const submissionDeposit = value.value.submission_deposit;
          const decisionDeposit = value.value.decision_deposit;
          if (submissionDeposit?.who?.toString() === address) {
            const referendumDeposit = new Balance(submissionDeposit.amount, decimals, symbol);
            console.log(
              `  Referendum ${keyArgs.toString()} created by this account with deposit: ${referendumDeposit.toString()} and status: ${value.type}`,
            );
            store(
              [symbol, chain, "reservedReason", `referendumSubmission(${keyArgs.toString()})`, address],
              referendumDeposit,
            );
            accounted += referendumDeposit.decimalValue();
          }
          if (decisionDeposit?.who?.toString() === address) {
            const referendumDeposit = new Balance(decisionDeposit.amount, decimals, symbol);
            console.log(
              `  Referendum ${keyArgs.toString()} decision deposit by this account with deposit: ${referendumDeposit.toString()} and status: ${value.type}`,
            );
            store(
              [symbol, chain, "reservedReason", `referendumDecision(${keyArgs.toString()})`, address],
              referendumDeposit,
            );
            accounted += referendumDeposit.decimalValue();
          }
        }
      }
    } catch (e: any) {
      console.warn("  Error fetching referendum info:", e.toString());
    }
    return accounted;
  },
};
