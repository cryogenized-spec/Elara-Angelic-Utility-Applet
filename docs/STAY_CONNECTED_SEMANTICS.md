# Stay Connected Semantics

Prompt 40 defines what Elara means by a persistent Google connection.

## Meaning

"Stay connected" means Elara may retain the application's authorized Google account relationship and use silent/non-interactive token recovery where permitted. It does not mean permanent authorization, perpetual access, or permission to bypass OAuth.

## State model

- `disconnected`: no account connection is configured.
- `connected`: account is known and at least one valid grant exists.
- `needs-consent`: a capability requires a scope that has not been granted.
- `token-recovery`: the OAuth authority is attempting non-interactive recovery.
- `reauthorization-required`: recovery failed because consent must be renewed or a grant was revoked/expired.
- `partially-authorized`: some registered capabilities are available and others are not.
- `revoked`: the user or provider has revoked access; affected grants are cleared or marked unusable.

## Security rules

The UI never stores provider tokens. Persistence may retain non-secret connection metadata such as account identifier, granted capability keys, timestamps, and connection state.

A failed token refresh must not cause Elara to repeatedly redirect the user. The OAuth authority distinguishes a recoverable token-expiry condition from revoked consent and returns an explicit state.

Disconnect is explicit and complete for the selected Google connection. It does not delete unrelated conversation or memory data.

## Character continuity

Elara can speak naturally about her connection state, but the character cannot change OAuth state on its own. "Stay connected" is an application setting backed by the OAuth authority, not a personality instruction.

## Least-privilege expectation

A connected account can still be only partially authorized. Calendar read access does not imply Calendar write access, and Calendar access does not imply Tasks, Docs, or Chat access. Google recommends incremental, least-privilege authorization. citeturn616269search5turn616269search0
