# polkadot-balances

Audit Polkadot ecosystem account balances across multiple chains. Breaks down reserved, frozen, and transferable balances by reason (staking, conviction voting, proxies, preimages, parachain deposits, nomination pools, assets, identity, multisig, bounties, etc.) and outputs to Google Sheets or xlsx.

## Install

```bash
bun install
```

## Usage

### With a config file (recommended)

```bash
bun run src/index.ts --config my-run.config.json
```

Config file format:

```json
{
  "accounts": [
    {
      "address": "1abc...",
      "name": "Treasury",
      "beneficialOwner": "Acme Corp",
      "controller": "Alice"
    }
  ],
  "sheetId": "1yCxay_g-...",
  "credentials": "/path/to/service-account.json",
  "rpcNodes": {
    "dot": ["wss://rpc.polkadot.io"],
    "pah": ["wss://polkadot-asset-hub-rpc.polkadot.io"],
    "ksm": ["wss://kusama-rpc.polkadot.io"]
  }
}
```

- `accounts` — list of Substrate addresses to query. `name`, `beneficialOwner`, `controller` are optional labels for the header rows.
- `sheetId` — Google Sheets spreadsheet ID (optional; omit for xlsx output).
- `credentials` — path to Google service account JSON key (required when `sheetId` is set).
- `rpcNodes` — per-chain RPC endpoints. Only chains listed here are queried. Omit this field entirely to use the built-in defaults for all enabled chains.

Available chain IDs: `dot`, `pah`, `ksm`, `kah`, `enc`, `ppl`, `kpl`, `kct`.

### With a CSV file (legacy)

```bash
bun run src/index.ts accounts.csv [--sheet-id ID] [--credentials path]
```

CSV format:

```csv
Address,Name,BeneficialOwner,Controller
1abc...,Treasury,Acme Corp,Alice
```

Lines starting with `#` are ignored.

### Historical queries

```bash
bun run src/index.ts --config run.json --at 20250101
bun run src/index.ts --config run.json --at 202501
bun run src/index.ts --config run.json --at-block 22000000
```

- `--at YYYYMMDD` or `--at YYYYMM` — query at end of day / end of month (UTC).
- `--at-block NUMBER` — query at a specific relay chain block number. Parachain blocks are resolved via the relay block's timestamp.

## Google Sheets setup

### 1. Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (or use an existing one).

### 2. Enable the Google Sheets API

1. In your project, go to **APIs & Services > Library**.
2. Search for "Google Sheets API" and click **Enable**.

### 3. Create a service account

1. Go to **APIs & Services > Credentials**.
2. Click **Create Credentials > Service account**.
3. Give it a name (e.g. `polkadot-balances`), click through the wizard.
4. On the service account page, go to the **Keys** tab.
5. Click **Add Key > Create new key > JSON**. Save the downloaded file.
6. Reference this file as `credentials` in your config or pass it via `--credentials`.

### 4. Share the spreadsheet

1. Create a new Google Sheets spreadsheet (or use an existing one).
2. Copy the spreadsheet ID from the URL: `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`
3. Share the spreadsheet with the service account's email address (found in the JSON key file as `client_email`). Grant **Editor** access.

### 5. Run

```bash
bun run src/index.ts --config my-run.config.json
```

The tool creates one tab per token (DOT, KSM, etc.), writes all balance data with SUM formulas, and applies formatting (bold headers, color-coded rows). Human formatting changes (column widths, conditional formatting, colors) are preserved across runs — only cell values are overwritten.

## Output

Without `--sheet-id` / Google Sheets config, the tool writes an xlsx file next to the input file (e.g. `accounts-balances.xlsx` or `my-run.config-balances.xlsx`).

Each sheet tab (one per token) contains:
- Header rows: address, name, beneficial owner, controller
- Per-chain rows: full balance, transferable, frozen (with reasons), reserved (with reasons), nomination pools, DEX liquidity pools
- Summary rows with SUM formulas: total transferable, frozen, reserved, on-account, pooled, grand total
- Columns with all-zero balances are auto-hidden (xlsx) or visible (Google Sheets)
