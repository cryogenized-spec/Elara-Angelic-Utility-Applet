# Prompt 17 — Attachment System

## Status

Accepted as the attachment lifecycle contract for images and documents.

## Ownership

`attachments/` owns file selection, trust-boundary validation, metadata normalization, preview lifecycle, upload/progress state, failure/removal, and provider-ready representations.

The composer owns only the affordance and presentation. Chat decides when validated attachments are included in a message. Gemini owns final provider translation. Persistence stores normalized attachment metadata and stable references, not arbitrary browser `File` objects.

## Lifecycle

```text
pick
  ↓
validate
  ↓
normalize metadata
  ↓
preview / staged
  ↓
ready
  ↓
provider handoff
  ↓
complete

or
  ↓
failed → retry/remove
```

Each attachment has an explicit lifecycle state. A failed attachment never silently becomes ready.

## File validation

`accept` on a file input is only a picker hint; it is not validation. The attachment boundary must validate MIME type, file extension where appropriate, size, and application-supported combinations. citeturn339022search1turn339022search5

Validation must be performed again at any server/provider trust boundary. Client validation improves UX but is never a security control by itself.

## Supported classes

The initial classes are:

- images for multimodal Gemini input;
- documents, with PDF as a primary target.

The normalized domain representation should be extensible without creating separate attachment managers for every media type.

## Normalized metadata

Conceptually:

```ts
interface Attachment {
  id: string;
  kind: 'image' | 'document';
  name: string;
  mimeType: string;
  sizeBytes: number;
  state: 'staged' | 'ready' | 'uploading' | 'failed' | 'removed';
  previewUrl?: string;
  providerRef?: string;
  errorCode?: string;
}
```

The runtime schema will validate all fields and impose product-specific size/type limits.

## Browser file lifecycle

Object URLs are disposable previews, not durable identity. They must be revoked when a preview is removed or replaced. Persist only stable metadata/references that remain meaningful after reload.

Never persist raw `File` objects into IndexedDB conversation records as the application’s canonical message representation.

## Progress and failure

Large attachments must expose progress when an upload/processing phase actually exists. If no progress signal is available, use an indeterminate state rather than inventing percentages.

Errors must distinguish unsupported type, size limit, read failure, cancellation, provider rejection, and network/processing failure where the underlying boundary can know the difference.

## Gemini handoff

The attachment boundary produces a provider-neutral representation. The Gemini provider converts that representation into the exact Interactions input structure supported by the selected model. The UI never constructs inline-data/file-reference provider objects.

## Future tools and Workspace

Attachments are message inputs, not tool execution inputs by default. A future tool may explicitly accept an attachment reference, but that must be declared by its curated schema and validated by the tool service. Google Workspace services cannot implicitly ingest arbitrary browser files.

## Future memory

An attachment can later be referenced by a memory note, but memory retrieval does not own attachment storage. A note stores a stable reference/summary, not an uncontrolled browser object.

## Security and privacy

Do not place raw file contents into diagnostics or analytics. Error records may contain safe metadata such as type, size, lifecycle state, and provider status. File content is passed only through the approved application/provider boundary.

## Prompt 17 completion criterion

Image/document attachments have one explicit lifecycle and ownership boundary covering selection, validation, preview, progress, failure, removal, persistence metadata, and provider handoff, ready for concrete implementation in the runtime scaffold.
