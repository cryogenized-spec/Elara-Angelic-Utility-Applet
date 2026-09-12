---
id: SYS-LEGAL
status: active
verified_commit: cab20253ef448dd96e4feb82bf917729b27404a3
scope: third-party runtime/build notices and release obligations
paths: [package.json, package-lock.json, public/core/README.md, src/ui/generated-fonts/LICENSE.txt]
keywords: [license, notice, third-party, attribution]
---

# Third-party notices

## 1. Purpose and boundary

`SYS-LEGAL` records known third-party licensing/attribution obligations that must survive packaging and deployment. It is a release checklist, not legal advice, and the exact lockfile plus upstream license files remain authoritative.

## 2. Runtime architecture

Third-party code enters through npm dependencies and bundled/runtime assets. Release review must consider both the generated dependency graph and assets served separately from the JavaScript bundle, especially BusyTeX, OCR data and bundled fonts.

## 3. Source map

| Component/evidence | Location |
| --- | --- |
| Dependency graph | `package.json`, `package-lock.json` |
| BusyTeX deployment note | `public/core/README.md` |
| Bundled font notice | `src/ui/generated-fonts/LICENSE.txt` |
| Artifact/document code | `src/documents/`, `src/ocr/` |

## 4. Data and contracts

Known notices at the verified commit:

- `@google/genai` — Apache-2.0.
- `tesseract.js` and Tesseract WASM/core — JavaScript package Apache-2.0; language/traineddata assets may carry separate notices that must travel with hosted assets.
- `texlyre-busytex` — AGPL-3.0-or-later. Bundling/serving it requires the approved AGPL source/distribution obligations; it is a release gate, not a hidden remote fallback.
- Bundled Inter, Manrope and Outfit Latin WOFF2 assets — SIL Open Font License 1.1; local notice is stored beside generated fonts.
- All remaining dependencies retain the licenses represented by the exact `package-lock.json` graph and upstream packages.

## 5. Invariants

- Do not remove license/notice files required by redistributed assets.
- Runtime-downloaded/hosted OCR or compiler data is part of the release review even when not committed to Git.
- Dependency upgrades require rechecking the resulting lockfile licenses.
- BusyTeX licensing is explicit and cannot be bypassed by silently substituting an unreviewed remote runtime.

## 6. Security and failure semantics

License metadata is public and contains no application secrets. Release automation should fail visibly when required compiler/runtime assets or notices are missing rather than fetching arbitrary user-controlled replacements.

## 7. Verification and tests

Before public release, generate/review a complete dependency license report for the exact lockfile, verify bundled font notices, review OCR language-data notices, and satisfy the approved BusyTeX AGPL source/license-offer policy. `verify:artifact-assets` checks runtime asset presence, not legal completeness.

## 8. Known gaps

This document records currently known high-impact notices, not a permanent substitute for automated full dependency-license inventory. Re-run the release review whenever dependencies or bundled runtime assets change.
