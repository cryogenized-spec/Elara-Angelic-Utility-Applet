---
id: SYS-ART
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: attachment and artifact identity, storage and transformations
paths: [src/artifacts, src/domain/artifact.ts]
keywords: [artifact, attachment, image, document-input, blob, generated]
---

# Artifacts and attachments

## 1. Purpose and boundary

`SYS-ART` owns durable file identity and lifecycle for user attachments, derived data and generated outputs. Chat messages store stable artifact IDs; binary payloads and artifact metadata live behind the artifact repository. Gemini may consume an artifact but never becomes its database.

## 2. Runtime architecture

```text
file/tool output
-> validate + normalize
-> artifact metadata/blob store
-> optional preprocessing/transformation
-> stable artifact ID on message
-> provider adapter resolves inline/file URI when needed
```

Generated PDF and OCR operations cross into `SYS-DOC / documents.md`, then return output through this artifact boundary.

## 3. Source map

| Concern | Authority |
| --- | --- |
| Domain types | `src/domain/artifact.ts` |
| Repository | `src/artifacts/repository.ts` |
| Validation/limits | `src/artifacts/validation.ts`, `limits.ts` |
| Intake | `src/artifacts/intake.ts` |
| Image preprocessing | `src/artifacts/image-preprocessing.ts` |
| Transformations | `src/artifacts/transformations.ts` |
| Provider adaptation | `src/gemini/provider.ts` |
| Generated cards | `src/app/components/artifacts/` |

## 4. Data and contracts

Artifacts are typed as attachments, derived artifacts or generated artifacts and move through bounded statuses such as pending/processing/ready/failed. The central Elara Dexie database stores `artifactMetadata` and `artifactBlobs`; a message stores only `attachments?: string[]` and `artifacts?: string[]`.

Original image data remains canonical. Optional image preprocessing creates provider-appropriate data without silently replacing the source. PDF input remains PDF for Gemini rather than being automatically OCR'd or rasterized. OCR is explicit and produces a derived artifact with parentage.

For Gemini, ready files at or below 4 MiB can be sent inline; larger files use the Files API. Provider remote references are metadata caches with expiry, not artifact identity.

## 5. Invariants

- Binary payloads never live inside chat messages.
- Artifact IDs are stable; object URLs are presentation-only and must be revoked, never persisted.
- Repository reads report missing/corrupt payloads instead of silently fabricating empty data.
- Trust-boundary validation is repeated even when UI intake already validated a file.
- Transformations preserve provenance/parentage.
- A stale or cancelled generation cannot commit obsolete artifact metadata.

## 6. Security and failure semantics

MIME type, size, readiness and provenance are validated before provider/tool use; filename extensions are not authority. Provider failures surface typed artifact errors. Raw file bytes, base64 data, signed/provider references, credentials and tokens must not enter diagnostics or analytics.

## 7. Verification and tests

Use `src/artifacts/*.test.ts`, `src/gemini/multimodal.test.ts`, generated-card tests and `npm run verify:artifact-assets`. `scripts/reliability-gate.mjs` also checks binary hydration/corruption semantics and document-compiler safety boundaries.

## 8. Known gaps

Office/archive formats are not silently converted. Add new file classes through validation/intake/provider contracts rather than special-casing them in the composer. Document-generation implementation belongs in `SYS-DOC`, not here.
