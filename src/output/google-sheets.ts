import { google } from "googleapis";
import * as fs from "fs";

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
) {
  const auth = await getAuth(config.credentialsPath);
  const api = google.sheets({ version: "v4", auth });

  // Get existing sheet tabs
  const spreadsheet = await api.spreadsheets.get({ spreadsheetId: config.sheetId });
  const existingTabs = new Set(spreadsheet.data.sheets?.map((s) => s.properties?.title) ?? []);

  const requests: any[] = [];

  for (const tabName in sheets) {
    // Create tab if it doesn't exist
    if (!existingTabs.has(tabName)) {
      requests.push({
        addSheet: {
          properties: { title: tabName },
        },
      });
    }
  }

  // Execute tab creation first if needed
  if (requests.length > 0) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: config.sheetId,
      requestBody: { requests },
    });
  }

  // For each token sheet: clear values, then write
  for (const tabName in sheets) {
    const aoa = sheets[tabName]!;

    // Clear all values (preserves formatting)
    await api.spreadsheets.values.clear({
      spreadsheetId: config.sheetId,
      range: `'${tabName}'`,
    });

    // Write the full grid
    await api.spreadsheets.values.update({
      spreadsheetId: config.sheetId,
      range: `'${tabName}'!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: aoa,
      },
    });

    console.log(`  Written ${aoa.length} rows to tab "${tabName}"`);
  }

  // Apply basic formatting (bold headers)
  const formatRequests: any[] = [];
  const updatedSpreadsheet = await api.spreadsheets.get({ spreadsheetId: config.sheetId });

  for (const tabName in sheets) {
    const aoa = sheets[tabName]!;
    const sheetObj = updatedSpreadsheet.data.sheets?.find((s) => s.properties?.title === tabName);
    if (!sheetObj?.properties?.sheetId) continue;
    const sheetTabId = sheetObj.properties.sheetId;

    // Bold first 4 rows (headers)
    formatRequests.push({
      repeatCell: {
        range: {
          sheetId: sheetTabId,
          startRowIndex: 0,
          endRowIndex: 4,
        },
        cell: {
          userEnteredFormat: {
            textFormat: { bold: true },
          },
        },
        fields: "userEnteredFormat.textFormat.bold",
      },
    });

    // Auto-resize columns
    formatRequests.push({
      autoResizeDimensions: {
        dimensions: {
          sheetId: sheetTabId,
          dimension: "COLUMNS",
          startIndex: 0,
          endIndex: aoa[0]?.length ?? 2,
        },
      },
    });
  }

  if (formatRequests.length > 0) {
    await api.spreadsheets.batchUpdate({
      spreadsheetId: config.sheetId,
      requestBody: { requests: formatRequests },
    });
  }

  console.log(`Google Sheets updated: https://docs.google.com/spreadsheets/d/${config.sheetId}`);
}
