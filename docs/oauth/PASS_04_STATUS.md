# Pass 4 Status — Drive, Docs, and Sheets Service Adapters

## Completed

Pass 4 establishes focused Google Workspace service adapters behind the existing OAuth authority.

### Drive

Added `src/google/drive/service.ts` and unit coverage.

Operations:

- file listing/search with explicit query and bounded pagination;
- file metadata retrieval;
- authorized file download;
- metadata/file creation;
- explicit metadata updates;
- explicit parent/folder moves.

Read operations request `drive.files.read`; mutations request `drive.files.write`.

Drive list requests use explicit field projection to limit returned data. Inputs are bounded and validated before reaching the provider URL.

### Docs

The existing `src/google/docs/service.ts` remains the focused Docs adapter and is now part of the Pass 4 production surface.

Operations:

- `getDocument` using `docs.read`;
- `createDocument` using `docs.write`;
- `batchUpdate` using `docs.write`.

The adapter does not know OAuth token material; it receives an authorized request from the OAuth authority.

### Sheets

Added `src/google/sheets/service.ts` and unit coverage.

Operations:

- spreadsheet metadata retrieval;
- targeted A1 range reads;
- bounded range writes;
- bounded row appends;
- explicit batch updates.

Reads request `sheets.read`; writes request `sheets.write`.

The adapter deliberately does not invent a "list spreadsheets" API. File discovery remains a Drive/file-selection concern.

### Documentation

Added:

- `docs/GOOGLE_DRIVE_SERVICE.md`
- `docs/GOOGLE_SHEETS_SERVICE.md`

Updated `docs/README.md` to index the complete OAuth pass/status handoffs and Workspace service documents.

## Important limitation

These adapters are application-side service boundaries only. They cannot be declared production-operational until the protected Cloudflare OAuth authority can issue authorized request capabilities through the documented endpoint contract.

## Next exact action

Pass 5 — expand the explicit model-visible Google tool surface with Drive and Sheets operations, then connect tool execution through the existing risk/capability/OAuth boundary.
