# BusyTeX deployment assets

The browser PDF compiler is configured for `/core/busytex`. Populate this directory during deployment with the pinned `texlyre-busytex` runtime assets. Verify the deployment with `REQUIRE_BUSYTEX_ASSETS=1 npm run verify:artifact-assets`. To prepare the directory locally:

```sh
npm run busytex:prepare
```

That command downloads the assets for the version locked in `package-lock.json` into `public/core/busytex/`. The payload contains TeX Live/WASM data and is intentionally ignored by Git. A deployment must publish it at the same-origin `/core/busytex` path, or set `VITE_BUSYTEX_BASE_PATH` to an equivalent same-origin path at build time.

Do not replace this with a user-controlled or cross-origin URL. The compiler runs in a dedicated worker with shell escape disabled, and it must receive a read-only, pinned runtime asset set.
