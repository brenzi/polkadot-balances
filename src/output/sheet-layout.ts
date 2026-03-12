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
}

// Fixed layout row positions (1-based, for spreadsheet formulas):
//   1-4:  header rows
//   5:    empty
//   6:    Total transferable
//   7:    Total frozen
//   8:    Total reserved
//   9:    Total on-account balances
//  10:    Total pooled
//  11:    Grand total
//  12:    empty
//  13+:   data rows
const DATA_START = 12; // 0-based index where data rows begin

export function balanceRecordToSheets(
  balances: BalanceRecord,
  accountsList: { Address: string; Name?: string; BeneficialOwner?: string; Controller?: string }[],
) {
  const sheets: Record<string, any[][]> = {};
  const sheetMeta: Record<string, SheetRowMeta> = {};

  for (const token in balances) {
    // Build data rows into a separate array, tracking row types
    const dataRows: any[][] = [];
    const fullBalanceIdxs: number[] = [];
    const transferableIdxs: number[] = [];
    const poolIdxs: number[] = [];
    const frozenIdxs: number[] = [];
    const reservedIdxs: number[] = [];

    for (const chain in balances[token]) {
      fullBalanceIdxs.push(dataRows.length);
      dataRows.push([
        chain,
        "fullBalance",
        ...accountsList.map((acc) => {
          const accountBalances = balances[token]![chain]![acc.Address];
          const bal = accountBalances ? accountBalances["fullBalance"] : undefined;
          return bal?.decimalValue() ?? "";
        }),
      ]);

      transferableIdxs.push(dataRows.length);
      dataRows.push([
        chain,
        "transferable",
        ...accountsList.map((acc) => {
          const accountBalances = balances[token]![chain]![acc.Address];
          const bal = accountBalances ? accountBalances["transferable"] : undefined;
          return bal?.decimalValue() ?? "";
        }),
      ]);

      frozenIdxs.push(dataRows.length);
      dataRows.push([
        chain,
        "frozen total",
        ...accountsList.map((acc) => {
          const accountBalances = balances[token]![chain]![acc.Address];
          const bal = accountBalances ? accountBalances["frozen"] : undefined;
          return bal?.decimalValue() ?? "";
        }),
      ]);

      try {
        const reasons = Object.keys(balances[token]![chain]!["frozenReason"]!);
        console.log("frozen reasons:", reasons);
        for (const reason of reasons) {
          frozenIdxs.push(dataRows.length);
          dataRows.push([
            chain,
            `frozen: ${reason}`,
            ...accountsList.map((acc) => {
              const accountBalances = (balances[token]![chain] as any)?.["frozenReason"];
              const bal = accountBalances?.[reason]?.[acc.Address] as Balance | undefined;
              return bal?.decimalValue() ?? "";
            }),
          ]);
        }
      } catch {
        // no frozen reasons
      }

      reservedIdxs.push(dataRows.length);
      dataRows.push([
        chain,
        "reserved total",
        ...accountsList.map((acc) => {
          const accountBalances = balances[token]![chain]![acc.Address];
          const bal = accountBalances ? accountBalances["reserved"] : undefined;
          return bal?.decimalValue() ?? "";
        }),
      ]);

      try {
        const reasons = Object.keys(balances[token]![chain]!["reservedReason"]!);
        console.log("reserved reasons:", reasons);
        for (const reason of reasons) {
          reservedIdxs.push(dataRows.length);
          dataRows.push([
            chain,
            `reserved: ${reason}`,
            ...accountsList.map((acc) => {
              const accountBalances = (balances[token]![chain] as any)?.["reservedReason"];
              const bal = accountBalances?.[reason]?.[acc.Address] as Balance | undefined;
              return bal?.decimalValue() ?? "";
            }),
          ]);
        }
      } catch {
        // no reserved reasons
      }

      try {
        const pools = Object.keys(balances[token]![chain]!["nominationPool"]!);
        console.log("nominationPools:", pools);
        for (const pool of pools) {
          reservedIdxs.push(dataRows.length);
          dataRows.push([
            chain,
            `nominationPool ${pool}`,
            ...accountsList.map((acc) => {
              const accountBalances = (balances[token]![chain] as any)?.["nominationPool"];
              const bal = accountBalances?.[pool]?.[acc.Address] as Balance | undefined;
              return bal?.decimalValue() ?? "";
            }),
          ]);
        }
      } catch {
        // no nomination pools
      }

      try {
        const pools = Object.keys(balances[token]![chain]!["pool"]!);
        console.log("pools:", pools);
        for (const pool of pools) {
          poolIdxs.push(dataRows.length);
          dataRows.push([
            chain,
            `pool ${pool} share`,
            ...accountsList.map((acc) => {
              const accountBalances = (balances[token]![chain] as any)?.["pool"];
              const bal = accountBalances?.[pool]?.[acc.Address] as Balance | undefined;
              return bal?.decimalValue() ?? "";
            }),
          ]);
        }
      } catch {
        // no pools
      }
    }

    // Convert data-relative indices to final 1-based row numbers
    const toRow = (idx: number) => DATA_START + idx + 1;

    const makeFormulaRow = (label: string, idxs: number[]) => [
      "",
      label,
      ...accountsList.map((_, i) => {
        const col = colLetter(2 + i);
        if (idxs.length === 0) return "";
        return `=SUM(${idxs.map((idx) => `${col}${toRow(idx)}`).join(",")})`;
      }),
    ];

    // Assemble: headers + empty + summary + empty + data
    const rows: any[][] = [
      ["Chain", "balance kind", ...accountsList.map((acc) => acc.Address)],
      ["", "", ...accountsList.map((acc) => acc.Name)],
      ["", "", ...accountsList.map((acc) => acc.BeneficialOwner)],
      ["Chain", "Type", ...accountsList.map((acc) => acc.Controller)],
      [],
      makeFormulaRow("Total transferable", transferableIdxs),
      makeFormulaRow("Total frozen", frozenIdxs),
      makeFormulaRow("Total reserved", reservedIdxs),
      makeFormulaRow("Total on-account balances", fullBalanceIdxs),
      makeFormulaRow("Total pooled", poolIdxs),
      [
        "",
        "Grand total",
        ...accountsList.map((_, i) => {
          const col = colLetter(2 + i);
          return `=${col}9+${col}10`; // on-account (row 9) + pooled (row 10)
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
    };
  }
  return { sheets, sheetMeta };
}

export function getColHideFlags(rows: any[][]) {
  return rows[0]!.map((_: any, colIdx: number) => {
    if (colIdx < 2) return {};
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
