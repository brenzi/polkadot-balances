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

  // For each token sheet: clear values, then write
  for (const tabName in sheets) {
    const aoa = sheets[tabName]!;

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

  for (const tabName in sheets) {
    const aoa = sheets[tabName]!;
    const sheetObj = updatedSpreadsheet.data.sheets?.find((s) => s.properties?.title === tabName);
    if (!sheetObj?.properties?.sheetId && sheetObj?.properties?.sheetId !== 0) continue;
    const sheetTabId = sheetObj.properties.sheetId;
    const colCount = aoa[0]?.length ?? 2;

    // Bold header rows
    formatRequests.push({
      repeatCell: {
        range: { sheetId: sheetTabId, startRowIndex: 0, endRowIndex: 4 },
        cell: { userEnteredFormat: { textFormat: { bold: true } } },
        fields: "userEnteredFormat.textFormat.bold",
      },
    });

    // Wrap text on header row (AccountId is wide)
    formatRequests.push({
      repeatCell: {
        range: { sheetId: sheetTabId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 2, endColumnIndex: colCount },
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

    // Row coloring by type
    const rowMeta = meta?.[tabName];
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
