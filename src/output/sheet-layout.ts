import type { Balance, BalanceRecord } from "../balance.ts";

export function colLetter(idx: number): string {
  let s = "";
  let n = idx + 1; // 1-based
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

export interface SheetRowMeta {
  transferableRows: number[]; // 0-based row indices
  reservedRows: number[];
  frozenRows: number[];
  chainMerges: { startRow: number; endRow: number }[]; // 0-based, for merging col A
}

// Fixed layout (1-based rows):
//   1-4:  headers
//   5:    empty
//   6-11: summary (transferable, frozen, reserved, on-account, pooled, grand total)
//   12:   empty
//   13+:  data
//
// Columns: A=Chain[#block], B=Type, C=Total, D+=Accounts
const DATA_START = 12; // 0-based index where data rows begin
const ACCT_COL = 3;    // account columns start at D (index 3)

export function balanceRecordToSheets(
  balances: BalanceRecord,
  accountsList: { Address: string; Name?: string; BeneficialOwner?: string; Controller?: string }[],
  chainBlocks?: Record<string, number>,
) {
  const sheets: Record<string, any[][]> = {};
  const sheetMeta: Record<string, SheetRowMeta> = {};
  const lastCol = colLetter(ACCT_COL + accountsList.length - 1);

  const totalFormula = (row1: number) =>
    accountsList.length === 0 ? "" : `=SUM(D${row1}:${lastCol}${row1})`;

  for (const token in balances) {
    const dataRows: any[][] = [];
    const fullBalanceIdxs: number[] = [];
    const transferableIdxs: number[] = [];
    const poolIdxs: number[] = [];
    const frozenIdxs: number[] = [];
    const reservedIdxs: number[] = [];
    const chainMerges: { startRow: number; endRow: number }[] = [];

    for (const chain in balances[token]) {
      const chainStartIdx = dataRows.length;
      const blockNum = chainBlocks?.[chain];
      const chainLabel = blockNum != null ? `${chain} [#${blockNum}]` : chain;

      const pushRow = (type: string, values: any[]) => {
        const isFirst = dataRows.length === chainStartIdx;
        const row1 = DATA_START + dataRows.length + 1;
        dataRows.push([isFirst ? chainLabel : "", type, totalFormula(row1), ...values]);
      };

      fullBalanceIdxs.push(dataRows.length);
      pushRow("fullBalance", accountsList.map((acc) => {
        const ab = balances[token]![chain]![acc.Address];
        return ab ? ab["fullBalance"]?.decimalValue() ?? "" : "";
      }));

      transferableIdxs.push(dataRows.length);
      pushRow("transferable", accountsList.map((acc) => {
        const ab = balances[token]![chain]![acc.Address];
        return ab ? ab["transferable"]?.decimalValue() ?? "" : "";
      }));

      frozenIdxs.push(dataRows.length);
      pushRow("frozen total", accountsList.map((acc) => {
        const ab = balances[token]![chain]![acc.Address];
        return ab ? ab["frozen"]?.decimalValue() ?? "" : "";
      }));

      try {
        const reasons = Object.keys(balances[token]![chain]!["frozenReason"]!);
        for (const reason of reasons) {
          pushRow(`frozen: ${reason}`, accountsList.map((acc) => {
            const ab = (balances[token]![chain] as any)?.["frozenReason"];
            return (ab?.[reason]?.[acc.Address] as Balance | undefined)?.decimalValue() ?? "";
          }));
        }
      } catch { /* no frozen reasons */ }

      reservedIdxs.push(dataRows.length);
      pushRow("reserved total", accountsList.map((acc) => {
        const ab = balances[token]![chain]![acc.Address];
        return ab ? ab["reserved"]?.decimalValue() ?? "" : "";
      }));

      try {
        const reasons = Object.keys(balances[token]![chain]!["reservedReason"]!);
        for (const reason of reasons) {
          pushRow(`reserved: ${reason}`, accountsList.map((acc) => {
            const ab = (balances[token]![chain] as any)?.["reservedReason"];
            return (ab?.[reason]?.[acc.Address] as Balance | undefined)?.decimalValue() ?? "";
          }));
        }
      } catch { /* no reserved reasons */ }

      try {
        const pools = Object.keys(balances[token]![chain]!["nominationPool"]!);
        for (const pool of pools) {
          pushRow(`nominationPool ${pool}`, accountsList.map((acc) => {
            const ab = (balances[token]![chain] as any)?.["nominationPool"];
            return (ab?.[pool]?.[acc.Address] as Balance | undefined)?.decimalValue() ?? "";
          }));
        }
      } catch { /* no nomination pools */ }

      try {
        const pools = Object.keys(balances[token]![chain]!["pool"]!);
        for (const pool of pools) {
          poolIdxs.push(dataRows.length);
          pushRow(`pool ${pool} share`, accountsList.map((acc) => {
            const ab = (balances[token]![chain] as any)?.["pool"];
            return (ab?.[pool]?.[acc.Address] as Balance | undefined)?.decimalValue() ?? "";
          }));
        }
      } catch { /* no pools */ }

      const chainEndIdx = dataRows.length - 1;
      if (chainEndIdx > chainStartIdx) {
        chainMerges.push({ startRow: DATA_START + chainStartIdx, endRow: DATA_START + chainEndIdx });
      }
    }

    const toRow = (idx: number) => DATA_START + idx + 1;

    const makeFormulaRow = (label: string, idxs: number[], row1: number) => [
      "",
      label,
      totalFormula(row1),
      ...accountsList.map((_, i) => {
        const col = colLetter(ACCT_COL + i);
        if (idxs.length === 0) return "";
        return `=SUM(${idxs.map((idx) => `${col}${toRow(idx)}`).join(",")})`;
      }),
    ];

    const rows: any[][] = [
      ["Chain", "Type", "Total", ...accountsList.map((acc) => acc.Address)],
      ["", "", "", ...accountsList.map((acc) => acc.Name)],
      ["", "", "", ...accountsList.map((acc) => acc.BeneficialOwner)],
      ["Chain", "Type", "", ...accountsList.map((acc) => acc.Controller)],
      [],
      makeFormulaRow("Total transferable", transferableIdxs, 6),
      makeFormulaRow("Total frozen", frozenIdxs, 7),
      makeFormulaRow("Total reserved", reservedIdxs, 8),
      makeFormulaRow("Total on-account balances", fullBalanceIdxs, 9),
      makeFormulaRow("Total pooled", poolIdxs, 10),
      [
        "",
        "Grand total",
        totalFormula(11),
        ...accountsList.map((_, i) => {
          const col = colLetter(ACCT_COL + i);
          return `=${col}9+${col}10`;
        }),
      ],
      [],
      ...dataRows,
    ];

    sheets[token] = rows;
    sheetMeta[token] = {
      transferableRows: transferableIdxs.map((idx) => DATA_START + idx),
      reservedRows: reservedIdxs.map((idx) => DATA_START + idx),
      frozenRows: frozenIdxs.map((idx) => DATA_START + idx),
      chainMerges,
    };
  }
  return { sheets, sheetMeta };
}

export function getColHideFlags(rows: any[][]) {
  return rows[0]!.map((_: any, colIdx: number) => {
    if (colIdx < ACCT_COL) return {};
    let sum = 0;
    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const val = rows[rowIdx]![colIdx];
      if (typeof val === "number") sum += val;
      else if (typeof val === "string" && !isNaN(Number(val))) sum += Number(val);
    }
    if (sum === 0) return { hidden: true };
    return {};
  });
}
