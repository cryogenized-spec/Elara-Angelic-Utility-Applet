# Artifact System

## Status

Implemented as the shared foundation for local attachments, derived transformations, and generated outputs.

## Domain boundary

An artifact is the durable object. Camera capture, file selection, OCR, Gemini, document compilation, preview components, and future Google Drive tools consume or produce artifact IDs; they do not own binary payloads.

The main application database stores artifact metadata and binary data in separate Dexie tables. Messages store only stable IDs:

```ts
attachments?: string[];
artifacts?: string[];
```

The existing `ChatMessage.text` contract remains unchanged so generation IDs, response variants, stale-generation arbitration, and historical messages remain compatible.

The artifact domain has three runtime forms:

- `Attachment` — user-provided input;
- `DerivedArtifact` — output of an explicit transformation such as OCR;
- `GeneratedArtifact` — output of a registered semantic tool such as `document.create_pdf`.

All forms have explicit status transitions: `pending`, `processing`, `ready`, and `failed`. Long-running mutations may persist an operation identity in metadata; conditional status/output writes require that identity and the expected current status, so a superseded operation cannot publish a late `ready` result. Stale and cancelled work remains inert or ends as a structured `failed` artifact; no separate `cancelled` status is introduced.

## Persistence and object URLs

Dexie schema version 7 adds `artifactMetadata` and `artifactBlobs`. Blob data is stored as IndexedDB-safe binary and hydrated to a `Blob` at the repository boundary. The message store never contains binary payloads.

Object URLs are presentation-only. Components create them when rendering an image or PDF, revoke them when the artifact changes or the component unmounts, and never place them in Dexie, chat state, tool results, or analytics.

`artifactRepository` is the application interface for creation, retrieval, listing, metadata updates, lifecycle changes, message association, disassociation, and deletion. Components and provider adapters do not access Dexie directly.

Message creation plus its attachment associations use one Dexie transaction through `appendMessageWithArtifacts`. Artifact metadata and blobs are validated inside that transaction, so a missing/corrupt/out-of-scope attachment or an interrupted write rolls back the message rather than leaving a partial association. Derived artifact creation and message association use the same all-or-nothing contract. Association IDs are deduplicated and references are revalidated before persistence.

The v1–v6 schema history remains explicit. A real v6 fixture is opened through v7 in regression coverage; legacy records are preserved, the two artifact stores are added empty, and no artifact references are fabricated.

Repository reads are strict integrity checks. `get` and `list` never repair missing metadata, synthesize an empty Blob, recreate a missing blob record, or otherwise silently self-heal corrupted state. They distinguish `ARTIFACT_NOT_FOUND` from `ARTIFACT_STORAGE_FAILED`; a present artifact with a missing/corrupt payload is reported as storage corruption. Silent repair, if ever introduced, must be a separate explicitly audited operation with its own tests.

## Attachment lifecycle

```text
picker
  ↓
validation and MIME/signature checks
  ↓
artifact Blob persistence
  ↓
processing
  ↓
ready
  ↓
message association
  ↓
provider adaptation
```

Validation is repeated at provider boundaries. `accept` attributes are picker hints only. Filenames, extensions, MIME labels, embedded metadata, and uploaded content are untrusted.

Initial supported classes are images, PDF, plain text, Markdown, JSON, CSV, XML, CSS, HTML, JavaScript, and common source-code text. Unsupported office/archive formats fail clearly rather than being silently rasterized or decompressed.

The initial limits are centralized in `src/artifacts/limits.ts`. They cover individual files, total message bytes, attachment count, OCR dimensions/time, generated source, compiler output, and compiler logs.

## Image preprocessing and AVIF

The original image remains canonical. `preprocessImage` is optional and can strip metadata, normalize orientation, resize, recompress, or convert formats under a policy. Derived encodings are cached by source artifact and normalized policy so the same image is not repeatedly transcoded.

AVIF is an optional browser capability. If the browser cannot encode it, the adapter falls back to the original or another provider-compatible representation. AVIF is not a domain invariant.

## Gemini adaptation

Gemini-specific input construction lives at the existing `geminiTurnPort` boundary. The provider receives local artifact IDs from chat orchestration and resolves them through `artifactRepository`.

Small files are mapped to transient inline multimodal data. Larger files use the Gemini Files API when available. A short-lived provider handle may be cached in attachment metadata, but the local artifact remains canonical. Expired handles are invalidated and recreated. Oversized upload preparation carries the active generation signal and claims a durable operation identity before asynchronous upload; a stale or cancelled upload cannot persist its remote reference. Provider URIs and credentials are never conversational text.

PDFs are passed as PDFs when supported. They are not rasterized or OCR'd automatically. Gemini receives actual image/document input and remains the normal visual reasoning interface.

## Local OCR

OCR is optional and independent of Gemini. The browser-side OCR service runs recognition in a Web Worker and returns structured text blocks, confidence, language, and bounds. OCR is explicitly invoked from a persisted image artifact; ordinary image messages do not trigger OCR automatically.

The product decision for this slice is post-send OCR: the draft Composer does not create derived artifacts before a message identity exists. When an image message is persisted, its artifact preview exposes an explicit `Extract text` action, and the Composer tells the user to send first. This keeps the draft flow free of orphan OCR outputs while preserving a reachable, user-controlled OCR action.

OCR output is stored as a derived artifact with a parent artifact ID and is associated with the originating message in one transaction. Each UI OCR request has an abort controller and operation identity; unmount, source deletion, cancellation, and supersession prevent any late derived-artifact creation. OCR timeout/abort/error/success paths settle once, remove listeners and timers, and terminate the worker. It can subsequently be included in a Gemini request or transformed further.

The runtime dependency is `tesseract.js` (Apache-2.0) with Tesseract WASM/core and language data licenses preserved by the selected asset distribution. Runtime/model asset hosting must retain the applicable notices. The OCR implementation is lazy and does not run on the chat main thread.

## Transformations

Transformations preserve parentage and provenance. The first executable transformation is:

```text
image → OCR text
```

The model and future features can extend this to OCR text → Markdown, PDF → extracted text, Markdown → PDF, LaTeX → PDF, and artifact-to-artifact workflows without adding a second persistence system.

## Generated artifacts and PDF creation

`document.create_pdf` is registered through the existing tool registry, Gemini declarations, schema validation, and executor. Its only model-visible arguments are:

```ts
{
  source: string;
  title?: string;
}
```

It does not expose shell, exec, filesystem paths, compiler flags, environment variables, or arbitrary binaries. The handler creates a generated artifact, moves it through `pending → processing → ready|failed`, stores the PDF separately, and returns only artifact metadata and bounded diagnostics.

The initial compiler adapter uses a lazy browser WASM Worker boundary around LuaLaTeX when the configured BusyTeX assets are available. The runtime is configured with shell escape disabled, no model-controlled paths, bounded source/output/log sizes, and a hard timeout. Missing compiler assets fail as a structured compilation failure rather than creating an unrestricted fallback.

Deployments should run `npm run busytex:prepare` using the lockfile-pinned `texlyre-busytex` release and publish the resulting ignored `public/core/busytex/` directory at the same-origin `/core/busytex` path. `public/core/README.md` records the required layout and `VITE_BUSYTEX_BASE_PATH` override. A production deployment check should fail if that path is absent; there is intentionally no remote or user-controlled compiler fallback.

`texlyre-busytex` is AGPL-3.0-or-later. Any deployment bundling or serving it must preserve that license and its source/distribution obligations. The application must not enable it in a distribution whose licensing policy has not approved that dependency.

The compiler Worker is defense-in-depth in addition to source validation; shell escape being disabled is not treated as the complete security boundary. Worker timeout and cancellation detach listeners and terminate the worker, and the artifact handler conditionally finalizes output using the active generation's operation identity. A late compiler success cannot transition an obsolete or timed-out artifact to `ready`. A future server compiler must use the same semantic contract and an isolated container/runtime with no network, read-only base filesystem, bounded resources, and controlled packages.

## Templates, preferences, memory, and Drive

Templates and document preferences have extension points but no template-management UI in this slice. Templates are controlled source/context assets, not model-selected execution settings.

Generated artifact presentation supports PDF preview/download plus Markdown rendering and bounded plain-text/code blocks from source content or text output Blobs. Generated artifacts are not automatically memories or preferences. Google Drive remains outside the artifact domain and will later consume an artifact through its existing semantic tool boundary.
