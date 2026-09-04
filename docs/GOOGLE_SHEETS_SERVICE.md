# Google Sheets Service Boundary

Pass 4 defines the focused Sheets adapter used by Elara.

## Operations

`GoogleSheetsService` currently exposes:

- `getSpreadsheet()` for bounded spreadsheet metadata;
- `readRange()` for targeted A1-range reads;
- `writeRange()` for bounded row writes;
- `appendRows()` for bounded row appends;
- `batchUpdate()` for explicit spreadsheet update requests.

## Authorization

Read operations require application capability `sheets.read`. Write operations require `sheets.write`. OAuth provider scope strings and tokens never enter model-visible schemas.

The selected least-privilege direction is `drive.file` when Elara is working with files the user explicitly selects or the app creates. Google documents `drive.file` alongside spreadsheet-specific scopes; use spreadsheet-wide scopes only when the actual feature requires broader access. citeturn285584search7

## Discovery

Sheets does not get a fictitious generic "list spreadsheets" operation. Spreadsheet selection/discovery should use Drive/file-selection semantics where required.

## Request hygiene

Range reads are targeted rather than whole-workbook reads. Writes are limited to 1,000 rows per operation and batch updates to 100 requests. Request bodies are validated and results are normalized before leaving the service boundary.

## Future additions

Add richer formatting, sheet/tab management, and file-selection UI only as separate explicit operations with their own tests and capability review.
