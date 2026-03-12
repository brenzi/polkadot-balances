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
  // This will throw if credentials are invalid or sheet is not accessible
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

  // Prepend warning row and shift meta indices for Google Sheets
  const WARNING = "⚠ This sheet is generated automatically. Contents will be overwritten on next run.";
  const gsSheets: Record<string, any[][]> = {};
  const gsMeta: Record<string, SheetRowMeta> | undefined = meta
    ? Object.fromEntries(
        Object.entries(meta).map(([k, v]) => [k, {
          transferableRows: v.transferableRows.map((r) => r + 1),
          reservedRows: v.reservedRows.map((r) => r + 1),
          frozenRows: v.frozenRows.map((r) => r + 1),
        }]),
      )
    : undefined;
  for (const tabName in sheets) {
    // Shift all formula row references by +1 to account for the warning row
    const shifted = sheets[tabName]!.map((row) =>
      row.map((cell: any) => {
        if (typeof cell === "string" && cell.startsWith("=")) {
          return cell.replace(/([A-Z]+)(\d+)/g, (_: string, col: string, num: string) => `${col}${Number(num) + 1}`);
        }
        return cell;
      }),
    );
    gsSheets[tabName] = [[WARNING], ...shifted];
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

    // Warning row: italic grey
    formatRequests.push({
      repeatCell: {
        range: { sheetId: sheetTabId, startRowIndex: 0, endRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { italic: true, foregroundColorStyle: { rgbColor: { red: 0.6, green: 0.6, blue: 0.6 } } } } },
        fields: "userEnteredFormat.textFormat(italic,foregroundColorStyle)",
      },
    });

    // Bold header rows (rows 1-4, after warning row)
    formatRequests.push({
      repeatCell: {
        range: { sheetId: sheetTabId, startRowIndex: 1, endRowIndex: 5 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold",
      },
    });

    // Wrap text on address header row (row 1, after warning)
    formatRequests.push({
      repeatCell: {
        range: { sheetId: sheetTabId, startRowIndex: 1, endRowIndex: 2, startColumnIndex: 2, endColumnIndex: colCount },
        cell: { userEnteredFormat: { wrapStrategy: "WRAP" } },
        fields: "userEnteredFormat.wrapStrategy",
      },
    });

    // Set fixed column widths: A=120, B=200, account columns=120
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
    if (colCount > 2) {
      formatRequests.push({
        updateDimensionProperties: {
          range: { sheetId: sheetTabId, dimension: "COLUMNS", startIndex: 2, endIndex: colCount },
          properties: { pixelSize: 120 },
          fields: "pixelSize",
        },
      });
    }

    // Row coloring by type (indices already shifted by +1 in gsMeta)
    const rowMeta = gsMeta?.[tabName];
    if (rowMeta) {
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
