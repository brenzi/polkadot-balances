import { google } from "googleapis";
import * as fs from "fs";
import type { SheetRowMeta } from "./sheet-layout.ts";

export interface GoogleSheetsConfig {
  sheetId: string;
  credentialsPath: string;
}

async function getAuth(credentialsPath: string) {
  const credentials = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return auth;
}

/**
 * Preflight check: verify credentials and sheet write access.
 * Throws on failure so we fail fast before any chain queries.
 */
export async function checkGoogleSheetsAccess(config: GoogleSheetsConfig) {
  const auth = await getAuth(config.credentialsPath);
  const api = google.sheets({ version: "v4", auth });
  await api.spreadsheets.get({ spreadsheetId: config.sheetId });
}

/**
 * Write balance sheets to a Google Spreadsheet.
 * Strategy: clear values (preserving formatting), then write full grid.
 */
export async function writeToGoogleSheets(
  config: GoogleSheetsConfig,
  sheets: Record<string, any[][]>,
  meta?: Record<string, SheetRowMeta>,
  refreshTime?: Date,
) {
  const auth = await getAuth(config.credentialsPath);
  const api = google.sheets({ version: "v4", auth });

  // Force EN locale so formulas use commas and dots consistently
  await api.spreadsheets.batchUpdate({
    spreadsheetId: config.sheetId,
    requestBody: {
      requests: [{
        updateSpreadsheetProperties: {
          properties: { locale: "en_US" },
          fields: "locale",
        },
      }],
    },
  });

  // Get existing sheet tabs (case-insensitive comparison for Google Sheets)
  const spreadsheet = await api.spreadsheets.get({ spreadsheetId: config.sheetId });
  const existingTabs = new Set(
    (spreadsheet.data.sheets?.map((s) => s.properties?.title) ?? [])
      .filter((t): t is string => !!t)
      .map((t) => t.toLowerCase()),
  );

  // Create missing tabs one at a time (avoids batch failure if one already exists)
  for (const tabName in sheets) {
    if (!existingTabs.has(tabName.toLowerCase())) {
      try {
        await api.spreadsheets.batchUpdate({
          spreadsheetId: config.sheetId,
          requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
        });
        existingTabs.add(tabName.toLowerCase());
      } catch (e: any) {
        console.warn(`  Warning creating tab "${tabName}": ${e.message ?? e}`);
      }
    }
  }

  // Prepend info row (A1=timestamp, B1=warning) and shift all indices by +1
  const timestamp = (refreshTime ?? new Date()).toISOString();
  const WARNING = "⚠ Contents will be overwritten automatically on next run.";
  const gsSheets: Record<string, any[][]> = {};
  const gsMeta: Record<string, SheetRowMeta> | undefined = meta
    ? Object.fromEntries(
        Object.entries(meta).map(([k, v]) => [k, {
          transferableRows: v.transferableRows.map((r) => r + 1),
          reservedRows: v.reservedRows.map((r) => r + 1),
          frozenRows: v.frozenRows.map((r) => r + 1),
          chainMerges: v.chainMerges.map((m) => ({ startRow: m.startRow + 1, endRow: m.endRow + 1 })),
        }]),
      )
    : undefined;
  for (const tabName in sheets) {
    const shifted = sheets[tabName]!.map((row) =>
      row.map((cell: any) => {
        if (typeof cell === "string" && cell.startsWith("=")) {
          return cell.replace(/([A-Z]+)(\d+)/g, (_: string, col: string, num: string) => `${col}${Number(num) + 1}`);
        }
        return cell;
      }),
    );
    gsSheets[tabName] = [[timestamp, WARNING], ...shifted];
  }

  // For each token sheet: clear values, then write
  for (const tabName in gsSheets) {
    const aoa = gsSheets[tabName]!;

    await api.spreadsheets.values.clear({
      spreadsheetId: config.sheetId,
      range: `'${tabName}'`,
    });

    await api.spreadsheets.values.update({
      spreadsheetId: config.sheetId,
      range: `'${tabName}'!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: aoa },
    });

    console.log(`  Written ${aoa.length} rows to tab "${tabName}"`);
  }

  // Apply formatting
  const formatRequests: any[] = [];
  const updatedSpreadsheet = await api.spreadsheets.get({ spreadsheetId: config.sheetId });

  for (const tabName in gsSheets) {
    const aoa = gsSheets[tabName]!;
    const sheetObj = updatedSpreadsheet.data.sheets?.find((s) => s.properties?.title === tabName);
    if (!sheetObj?.properties?.sheetId && sheetObj?.properties?.sheetId !== 0) continue;
    const sheetTabId = sheetObj.properties.sheetId;
    const colCount = Math.max(...aoa.map((r) => r.length), 2);

    // Row 0 (info row): italic grey
    formatRequests.push({
      repeatCell: {
        range: { sheetId: sheetTabId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { italic: true, foregroundColorStyle: { rgbColor: { red: 0.6, green: 0.6, blue: 0.6 } } } } },
        fields: "userEnteredFormat.textFormat(italic,foregroundColorStyle)",
      },
    });

    // Bold header rows (1-4) and summary rows (6-12), after info row
    for (const [start, end] of [[1, 5], [6, 12]]) {
      formatRequests.push({
        repeatCell: {
          range: { sheetId: sheetTabId, startRowIndex: start, endRowIndex: end },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: "userEnteredFormat.textFormat.bold",
        },
      });
    }

    // Wrap text on address header row (row 1) for account columns D+
    formatRequests.push({
      repeatCell: {
        range: { sheetId: sheetTabId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 3, endColumnIndex: colCount },
        cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
        fields: "userEnteredFormat.wrapStrategy",
      },
    });

    // Column widths: A=120, B=200, C=100 (Total), D+=120
    formatRequests.push({
      updateDimensionProperties: {
        range: { sheetId: sheetTabId, dimension: "COLUMNS", startIndex: 0, endIndex: 1 },
        properties: { pixelSize: 120 },
        fields: "pixelSize",
      },
    });
    formatRequests.push({
      updateDimensionProperties: {
        range: { sheetId: sheetTabId, dimension: "COLUMNS", startIndex: 1, endIndex: 2 },
        properties: { pixelSize: 200 },
        fields: "pixelSize",
      },
    });
    formatRequests.push({
      updateDimensionProperties: {
        range: { sheetId: sheetTabId, dimension: "COLUMNS", startIndex: 2, endIndex: 3 },
        properties: { pixelSize: 100 },
        fields: "pixelSize",
      },
    });
    if (colCount > 3) {
      formatRequests.push({
        updateDimensionProperties: {
          range: { sheetId: sheetTabId, dimension: "COLUMNS", startIndex: 3, endIndex: colCount },
          properties: { pixelSize: 120 },
          fields: "pixelSize",
        },
      });
    }

    // Light blue background for Total column (C = index 2)
    const lightBlue = { red: 0.85, green: 0.92, blue: 1.0 };
    formatRequests.push({
      repeatCell: {
        range: { sheetId: sheetTabId, startRowIndex: 1, endRowIndex: aoa.length, startColumnIndex: 2, endColumnIndex: 3 },
        cell: { userEnteredFormat: { backgroundColor: lightBlue } },
        fields: "userEnteredFormat.backgroundColor",
      },
    });

    // Chain merges in column A
    const rowMeta = gsMeta?.[tabName];
    if (rowMeta) {
      for (const merge of rowMeta.chainMerges) {
        formatRequests.push({
          mergeCells: {
            range: {
              sheetId: sheetTabId,
              startRowIndex: merge.startRow,
              endRowIndex: merge.endRow + 1,
              startColumnIndex: 0,
              endColumnIndex: 1,
            },
            mergeType: "MERGE_ALL",
          },
        });
      }

      // Vertical-align merged chain cells to middle
      for (const merge of rowMeta.chainMerges) {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sheetTabId, startRowIndex: merge.startRow, endRowIndex: merge.startRow + 1, startColumnIndex: 0, endColumnIndex: 1 },
            cell: { userEnteredFormat: { verticalAlignment: "MIDDLE" } },
            fields: "userEnteredFormat.verticalAlignment",
          },
        });
      }

      // Row coloring by type (indices already shifted by +1)
      const darkGreen = { red: 0.1, green: 0.4, blue: 0.1 };
      const grey = { red: 0.5, green: 0.5, blue: 0.5 };

      for (const row of rowMeta.transferableRows) {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sheetTabId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: colCount },
            cell: { userEnteredFormat: { textFormat: { bold: true, foregroundColorStyle: { rgbColor: darkGreen } } } },
            fields: "userEnteredFormat.textFormat(bold,foregroundColorStyle)",
          },
        });
      }
      for (const row of [...rowMeta.reservedRows, ...rowMeta.frozenRows]) {
        formatRequests.push({
          repeatCell: {
            range: { sheetId: sheetTabId, startRowIndex: row, endRowIndex: row + 1, startColumnIndex: 0, endColumnIndex: colCount },
            cell: { userEnteredFormat: { textFormat: { foregroundColorStyle: { rgbColor: grey } } } },
            fields: "userEnteredFormat.textFormat.foregroundColorStyle",
          },
        });
      }
    }
  }

  if (formatRequests.length > 0) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: config.sheetId,
      requestBody: { requests: formatRequests },
    });
  }

  console.log(`Google Sheets updated: https://docs.google.com/spreadsheets/d/${config.sheetId}`);
}
