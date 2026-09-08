# Third-party notices for the artifact slice

This slice adds the following runtime/build components. Release packaging must preserve the upstream notices and comply with the listed licenses.

- `@google/genai` — Apache-2.0.
- `tesseract.js` and its Tesseract WASM/core runtime — Apache-2.0 for the JavaScript package; language data and traineddata assets may carry separate notices and must be hosted with those notices.
- `texlyre-busytex` — AGPL-3.0-or-later. A release that bundles or serves BusyTeX must satisfy the AGPL source/distribution obligations. The dependency is intentionally documented as a release approval gate rather than hidden behind a remote fallback.
- Bundled Inter, Manrope, and Outfit Latin WOFF2 assets — SIL Open Font License 1.1. The local notice is kept beside the files at `src/ui/generated-fonts/LICENSE.txt`.
- Existing application dependencies retain their licenses from the generated `package-lock.json` dependency graph.

Before a public release, generate and review the complete dependency license report for the exact lockfile and attach the BusyTeX source/license offer required by the approved AGPL distribution policy.
