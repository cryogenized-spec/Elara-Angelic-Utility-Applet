# Google Drive Service Boundary

Pass 4 defines the focused Drive adapter used by Elara.

## Operations

`GoogleDriveService` currently exposes:

- `listFiles()` with bounded pagination, explicit Drive `q` support, and selected fields;
- `getFile()` for selected file metadata and download capability;
- `downloadFile()` for authorized blob content using `alt=media`;
- `exportFile()` for authorized Google Workspace document export;
- `createFile()` for metadata/file creation;
- `updateFile()` for explicit metadata mutations;
- `moveFile()` for explicit parent changes.

Google's current Drive guidance uses `files.get` with `alt=media` for blob downloads and `files.export` for Google Workspace document exports. Before a download, the service checks the Drive `capabilities.canDownload` field. Export responses are bounded to 10 MB, matching the documented Drive export limit. citeturn285584search4

## Authorization

Read operations require application capability `drive.files.read`. Write/mutation operations require `drive.files.write`. Provider OAuth scopes never appear in model-visible tool schemas.

The selected first-class provider scope is `drive.file`, preserving per-file access where the feature workflow is sufficient. Google currently documents `drive.file` as access to specific Drive files used with the app. citeturn285584search0

## Request hygiene

Drive list/get responses use explicit `fields` projections. Page size is bounded to 100. File IDs, names, MIME types, and other user-supplied strings are bounded before becoming request components. Binary downloads are bounded by the application transfer limit rather than allowing an unrestricted model-driven data pull.

Folder moves use `files.update` with `addParents`/`removeParents`, matching the current Drive API guidance. citeturn905264search1

## Future additions

Multipart binary upload and Google Picker integration should be added only with precise operation contracts and matching OAuth capability review. Do not introduce a generic Drive HTTP tool.
