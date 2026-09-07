# Pass 1 — Remove the Abandoned Cloudflare OAuth Architecture

## Status

**Complete.**

The repository's Google Workspace authorization runtime no longer uses the `elara-gemini` Cloudflare Worker. The live authority is application-owned and browser-facing, while the Worker remains only for its separate Gemini/transcription boundary.

### Verified boundaries

- `src/google/oauth/authority.ts` uses the single application `GoogleOAuthAuthority` and Google Identity Services.
- Workspace service adapters receive capability-bound authorization from that authority; none constructs its own OAuth client or calls the Gemini Worker for Google access.
- `worker/src/index.ts` contains Gemini and transcription handling only; it has no Google Workspace OAuth routes, token store, or refresh-token authority.
- `worker/wrangler.toml` configures the Gemini Worker only.
- The remaining `GEMINI_WORKER_URL` and `elara-gemini.cryogenized.workers.dev` references are Gemini/transcription deployment references, not Google Workspace authorization references.

### Cleanup conclusion

There was no separate Worker OAuth implementation left to delete from the live source tree. The apparent conflict came from older Worker-era documentation and deployment references describing the Gemini Worker, which are now explicitly kept separate from Google OAuth.

## Security boundary

Google Workspace authorization must not inherit the Gemini Worker credential boundary. Google OAuth client identifiers may be public browser configuration; access tokens remain transient runtime secrets, and persistent refresh credentials belong only to the later protected authorization-code exchange boundary.

## Next pass

Pass 2 establishes the Google Identity Services authorization-code client boundary required by the long-lived server-side OAuth model. The token exchange and durable refresh-token authority are deliberately separate infrastructure work.
