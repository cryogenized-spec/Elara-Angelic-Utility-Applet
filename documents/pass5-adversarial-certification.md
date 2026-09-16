# Pass 5 — Adversarial Certification

## 1. Purpose

Pass 5 does not add product capability. It attacks the guarantees established by Passes 1–4 and requires protected boundaries to fail closed under controlled hostile mutations and race conditions.

Base: certified `main@7b75f909db5bb1646526d7f6f559f76879655db7`.

A Pass-5 head is certifiable only when the normal CI matrix and the adversarial sentinels both pass on the same exact PR head. Post-merge `main` must then pass the same runtime certification before the pass is closed.

## 2. Static boundary mutations

`scripts/verify-coverage-gate.mjs` copies the repository into disposable sandboxes and deliberately violates reviewed controls. The mutation suite must prove rejection of hostile changes including executable DOM sinks, dynamic code execution, unreviewed network and durable-storage authority, credential-shaped browser persistence, committed secret material, disabled or narrowed tests, E2E source-boundary cheating, guard tampering, mutable or unpinned CI, elevated workflow permissions, deployment decoupling, mutable dependency installation, and runtime-pin drift.

The existing coverage adversary remains part of the same sentinel: coverage-floor regression and disappearance of an eligible source file must both fail closed.

## 3. Runtime authority attacks

Tool-loop adversarial tests exercise authority rather than model intent. Undeclared or disallowed tool calls must not reach an executor. Mutation calls must not execute after the confirmation shown to the user expires. If an OAuth grant outlives the original confirmation, that stale confirmation must not authorize a retry.

The confirmation freshness check therefore exists both immediately after approval and again after any delayed OAuth grant before mutation replay.

## 4. Credential corruption

Encrypted credential stores are treated as hostile persistence boundaries. The autonomy installation-token tests corrupt sealed ciphertext and require an empty credential on read. The interactive Lockbox adversarial test corrupts the primary encrypted record and requires unlock to fail while plaintext remains absent from session and local storage. Secondary Lockbox tests continue to cover stale protection stamps, mismatched ciphertext, credential rotation, orphan prevention, and locked-session write refusal.

## 5. Certification rule

Pass 5 is complete only after:

1. the final exact PR head passes documentation, verification, security architecture, secret scanning, supply-chain, test-quality/adversarial sentinels, locked install, registry signatures, high-severity audit, lint, TS6, TS7, unit/coverage, Worker/Durable Object, build, Playwright, and final reliability;
2. the PR is merged without changing that certified head; and
3. the resulting `main` merge commit passes the same runtime certification, with Pages deployment remaining downstream of the successful runtime job.

Prompt-injection and hostile-content trust propagation are intentionally a separate future security programme. Pass 5 certifies application, credential, authority, test, CI, and deployment boundaries; it does not claim that model-level indirect prompt injection has been solved.
