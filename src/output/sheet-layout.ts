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

export function balanceRecordToSheets(
  balances: BalanceRecord,
  accountsList: { Address: string; Name?: string; BeneficialOwner?: string; Controller?: string }[],
) {
  const sheets: Record<string, any[][]> = {};
  const sheetMeta: Record<string, SheetRowMeta> = {};

  for (const token in balances) {
    const rows: any[][] = [];
    // Header rows
    rows.push(["Chain", "balance kind", ...accountsList.map((acc) => acc.Address)]);
    rows.push(["", "", ...accountsList.map((acc) => acc.Name)]);
    rows.push(["", "", ...accountsList.map((acc) => acc.BeneficialOwner)]);
    rows.push(["Chain", "Type", ...accountsList.map((acc) => acc.Controller)]);

    const fullBalanceRows: number[] = [];
    const transferableRows: number[] = [];
    const poolRows: number[] = [];
    const frozenRows: number[] = [];
    const reservedRows: number[] = [];

    for (const chain in balances[token]) {
      // FULL BALANCES
      rows.push([
        chain,
        "fullBalance",
        ...accountsList.map((acc) => {
          const accountBalances = balances[token]![chain]![acc.Address];
          const bal = accountBalances ? accountBalances["fullBalance"] : undefined;
          return bal?.decimalValue() ?? "";
        }),
      ]);
      fullBalanceRows.push(rows.length);

      // TRANSFERABLE BALANCES
      rows.push([
        chain,
        "transferable",
        ...accountsList.map((acc) => {
          const accountBalances = balances[token]![chain]![acc.Address];
          const bal = accountBalances ? accountBalances["transferable"] : undefined;
          return bal?.decimalValue() ?? "";
        }),
      ]);
      transferableRows.push(rows.length);

      // FROZEN BALANCES
      rows.push([
        chain,
        "frozen total",
        ...accountsList.map((acc) => {
          const accountBalances = balances[token]![chain]![acc.Address];
          const bal = accountBalances ? accountBalances["frozen"] : undefined;
          return bal?.decimalValue() ?? "";
        }),
      ]);
      frozenRows.push(rows.length);

      try {
        const reasons = Object.keys(balances[token]![chain]!["frozenReason"]!);
        console.log("frozen reasons:", reasons);
        for (const reason of reasons) {
          rows.push([
            chain,
            `frozen: ${reason}`,
            ...accountsList.map((acc) => {
              const accountBalances = (balances[token]![chain] as any)?.["frozenReason"];
              const bal = accountBalances?.[reason]?.[acc.Address] as Balance | undefined;
              return bal?.decimalValue() ?? "";
            }),
          ]);
          frozenRows.push(rows.length);
        }
      } catch {
        // no frozen reasons
      }

      // RESERVED BALANCES
      rows.push([
        chain,
        "reserved total",
        ...accountsList.map((acc) => {
          const accountBalances = balances[token]![chain]![acc.Address];
          const bal = accountBalances ? accountBalances["reserved"] : undefined;
          return bal?.decimalValue() ?? "";
        }),
      ]);
      reservedRows.push(rows.length);

      try {
        const reasons = Object.keys(balances[token]![chain]!["reservedReason"]!);
        console.log("reserved reasons:", reasons);
        for (const reason of reasons) {
          rows.push([
            chain,
            `reserved: ${reason}`,
            ...accountsList.map((acc) => {
              const accountBalances = (balances[token]![chain] as any)?.["reservedReason"];
              const bal = accountBalances?.[reason]?.[acc.Address] as Balance | undefined;
              return bal?.decimalValue() ?? "";
            }),
          ]);
          reservedRows.push(rows.length);
        }
      } catch {
        // no reserved reasons
      }

      // Nomination Pools claimable rewards
      try {
        const pools = Object.keys(balances[token]![chain]!["nominationPool"]!);
        console.log("nominationPools:", pools);
        for (const pool of pools) {
          rows.push([
            chain,
            `nominationPool ${pool}`,
            ...accountsList.map((acc) => {
              const accountBalances = (balances[token]![chain] as any)?.["nominationPool"];
              const bal = accountBalances?.[pool]?.[acc.Address] as Balance | undefined;
              return bal?.decimalValue() ?? "";
            }),
          ]);
          reservedRows.push(rows.length);
        }
      } catch {
        // no nomination pools
      }

      // DEX liquidity pools
      try {
        const pools = Object.keys(balances[token]![chain]!["pool"]!);
        console.log("pools:", pools);
        for (const pool of pools) {
          rows.push([
            chain,
            `pool ${pool} share`,
            ...accountsList.map((acc) => {
              const accountBalances = (balances[token]![chain] as any)?.["pool"];
              const bal = accountBalances?.[pool]?.[acc.Address] as Balance | undefined;
              return bal?.decimalValue() ?? "";
            }),
          ]);
          poolRows.push(rows.length);
        }
      } catch {
        // no pools
      }
    }

    // Summary rows with formulas
    rows.push([]);

    const makeFormulaRow = (label: string, sourceRows: number[]) => [
      "",
      label,
      ...accountsList.map((_, i) => {
        const col = colLetter(2 + i); // column C onwards
        if (sourceRows.length === 0) return "";
        return `=SUM(${sourceRows.map((r) => `${col}${r}`).join(",")})`;
      }),
    ];

    rows.push(makeFormulaRow("Total transferable", transferableRows));
    rows.push(makeFormulaRow("Total frozen", frozenRows));
    rows.push(makeFormulaRow("Total reserved", reservedRows));
    rows.push(makeFormulaRow("Total on-account balances", fullBalanceRows));
    rows.push(makeFormulaRow("Total pooled", poolRows));

    // Grand total = on-account + pooled
    const rowCount = rows.length;
    const onAccountRow = rowCount - 1; // Total on-account balances
    const pooledRow = rowCount; // Total pooled
    rows.push([
      "",
      "Grand total",
      ...accountsList.map((_, i) => {
        const col = colLetter(2 + i);
        return `=${col}${onAccountRow}+${col}${pooledRow}`;
      }),
    ]);

    sheets[token] = rows;
    sheetMeta[token] = {
      // Convert 1-based formula rows to 0-based indices
      transferableRows: transferableRows.map((r) => r - 1),
      reservedRows: reservedRows.map((r) => r - 1),
      frozenRows: frozenRows.map((r) => r - 1),
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
