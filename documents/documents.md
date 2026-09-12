---
id: SYS-DOC
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: local PDF generation and OCR-derived document output
paths: [src/documents, src/ocr]
keywords: [pdf, latex, busytex, ocr, compiler, document-create]
---

# Local documents and OCR

## 1. Purpose and boundary

`SYS-DOC` owns application-local document generation and OCR execution. It provides validated tools/services that create artifact outputs without granting the model arbitrary filesystem, compiler or shell access. Artifact identity/storage remains `SYS-ART / artifacts.md`.

## 2. Runtime architecture

```text
document.create_pdf tool
-> validate source/title
-> compiler adapter
-> dedicated BusyTeX Worker
-> PDF Blob
-> GeneratedArtifact

explicit OCR action
-> image artifact
-> OCR Web Worker
-> derived text artifact
```

Both paths are local browser capabilities. They do not require Google Workspace OAuth.

## 3. Source map

| Concern | Authority |
| --- | --- |
| PDF compiler adapter | `src/documents/compiler.ts` |
| Compiler worker | `src/documents/compiler.worker.ts` |
| Model tool handler | `src/documents/tool-handler.ts` |
| Tool contract | `src/documents/tool-contract.test.ts` |
| OCR service/worker | `src/ocr/service.ts`, `src/ocr/worker.ts` |
| Runtime assets | `public/core/README.md`, `scripts/verify-artifact-assets.mjs` |

## 4. Data and contracts

The model-visible PDF tool is `document.create_pdf`; inputs are bounded source text plus optional title metadata, not paths, shell flags or compiler arguments. The compiler runs in a dedicated Worker using BusyTeX/LuaLaTeX assets. Runtime assets are prepared with `npm run busytex:prepare` and are expected from the configured same-origin `/core/busytex` path unless a safe build-time path is supplied.

OCR is opt-in. It consumes an existing image artifact and produces derived text through `SYS-ART`; images are not automatically OCR'd as part of normal Gemini attachment handling.

## 5. Invariants

- Compiler shell escape remains disabled.
- The model cannot select filesystem paths, runtime URLs, executable flags or arbitrary compiler options.
- BusyTeX assets are pinned/read-only deployment assets, not user-controlled remote resources.
- Source/output/log size and runtime are bounded.
- Generated/derived data re-enters the app through the artifact repository.
- PDF input to Gemini stays PDF unless the user explicitly requests another transformation.

## 6. Security and failure semantics

Compilation and OCR run off the main UI thread. Missing runtime assets, compiler errors, timeout and invalid source are explicit failures; no remote fallback silently receives document contents. Logs exposed to the application are bounded and must not include credentials. See `SYS-LEGAL / third-party-notices.md` for distribution obligations.

## 7. Verification and tests

Use `src/documents/*.test.ts`, OCR tests where present, `npm run verify:artifact-assets`, build checks and the reliability gate. For a deployment that must bundle BusyTeX assets, run the verifier with its required-assets mode as documented in `public/core/README.md`.

## 8. Known gaps

The compiler is intentionally narrow rather than a general office-suite conversion service. New document formats should be added as explicit, validated capabilities. Release packaging must preserve BusyTeX/Tesseract licensing requirements.
