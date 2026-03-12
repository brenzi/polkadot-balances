export class Balance {
  raw: bigint;
  decimals: number;
  symbol: string;
  label?: string;

  constructor(raw: bigint, decimals: number, symbol: string) {
    this.raw = raw;
    this.decimals = decimals;
    this.symbol = symbol;
  }

  decimalValue(): number {
    return Number(this.raw) / 10 ** this.decimals;
  }

  toString(): string {
    return `${this.decimalValue()} ${this.symbol}`;
  }

  add(other: Balance): Balance {
    if (this.decimals !== other.decimals || this.symbol !== other.symbol) {
      throw new Error("Cannot add balances with different decimals or symbols");
    }
    return new Balance(this.raw + other.raw, this.decimals, this.symbol);
  }

  sub(other: Balance): Balance {
    if (this.decimals !== other.decimals || this.symbol !== other.symbol) {
      throw new Error("Cannot subtract balances with different decimals or symbols");
    }
    return new Balance(this.raw - other.raw, this.decimals, this.symbol);
  }
}

// token → chain → category → address/reason → Balance
export type BalanceRecord = Record<string, Record<string, Record<string, Record<string, Balance>>>>;

export function storeBalance(balances: BalanceRecord, path: (string | number)[], balance: Balance) {
  let current: any = balances;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]!;
    if (!(key in current)) current[key] = {};
    current = current[key];
  }
  current[path[path.length - 1]!] = balance;
}

export const maxBigInt = (...args: bigint[]) => args.reduce((a, b) => (a > b ? a : b));

export function safeStringify(obj: any) {
  return JSON.stringify(obj, (_, value) => (typeof value === "bigint" ? value.toString() : value));
}
