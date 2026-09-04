# Pass 5 Status — Drive and Sheets Model Tool Surface

## Completed

Pass 5 expands the explicit Google tool allow-list without introducing arbitrary network access.

### Added model-visible tool names

Drive:

- `drive.searchFiles`
- `drive.getFile`
- `drive.downloadFile`
- `drive.createFile`
- `drive.updateFile`
- `drive.moveFile`

Sheets:

- `sheets.getSpreadsheet`
- `sheets.readRange`
- `sheets.writeRange`
- `sheets.appendRows`
- `sheets.batchUpdate`

Each operation is registered with an application capability and mutation risk in `src/google/tools/registry.ts`.

### Argument validation

Added `src/google/tools/drive-sheets-schemas.ts` with explicit Zod argument contracts for all newly added Drive and Sheets operations. The schemas reject unknown fields, require non-empty IDs/ranges, bound pagination and payload sizes, and prevent empty mutations.

Added regression coverage in:

- `src/google/tools/drive-sheets-schemas.test.ts`
- `src/google/tools/registry.test.ts`

### Boundary preserved

No `google.request` or arbitrary HTTP operation was introduced. Tool schemas contain application capability names and risk classifications but no OAuth tokens, provider scope strings, client secrets, or model-controlled endpoint URLs.

## Important limitation

The current clean repository still lacks the protected Cloudflare OAuth Worker source that would execute the server-side authorization-code/token-refresh boundary. Therefore these tools are now correctly described and validated at the application boundary, but cannot be declared fully operational against Google until the protected authority exists.

## Next exact action

Pass 6 — connect the complete Google tool surface to risk/confirmation and diagnostics, then implement the protected OAuth Worker/service execution path once its deployment source is available.
