# Google Drive Service Boundary

Pass 4 defines the focused Drive adapter used by Elara.

## Operations

`GoogleDriveService` currently exposes:

- `listFiles()` with bounded pagination and explicit Drive `q` support;
- `getFile()` for selected file metadata;
- `downloadFile()` for authorized file content;
- `createFile()` for metadata/file creation;
- `updateFile()` for explicit metadata mutations;
- `moveFile()` for explicit parent changes.

## Authorization

Read operations require application capability `drive.files.read`. Write/mutation operations require `drive.files.write`. Provider OAuth scopes never appear in model-visible tool schemas.

The selected first-class provider scope is `drive.file`, preserving per-file access where the feature workflow is sufficient. Google currently documents `drive.file` as access to only specific Drive files used with the app. citeturn285584search0

## Request hygiene

Drive list responses use an explicit `fields` projection to avoid unnecessary payloads. Page size is bounded to 100. File IDs, names, and other user-supplied strings are validated before becoming request components.

## Future additions

Binary/media upload and Google Picker integration should be added only with a precise operation contract and matching OAuth capability. Do not introduce a generic Drive HTTP tool.
