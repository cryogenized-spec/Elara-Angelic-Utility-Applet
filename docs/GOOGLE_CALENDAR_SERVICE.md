# Google Calendar Service

Prompt 42 establishes the first concrete Google Workspace service boundary: Calendar.

## Scope

The initial service supports read-only event listing through the central OAuth authority using the registered `calendar.events.read` capability.

The service owns Calendar API request/response translation and Calendar-domain validation. It does not own OAuth, token storage, consent, retry policy, diagnostics persistence, or user-facing UI.

## Authorization boundary

Before every operation, the service asks the OAuth authority for an authorized request capability. It never receives a raw access token and never constructs Authorization headers itself.

The Calendar service may only use capability keys declared in the central scope registry. An operation requiring write access must not silently upgrade from read access.

## Data boundary

Only the Calendar fields required by the application-facing contract are returned. Raw provider responses must not leak directly into UI state.

Malformed or unexpected provider payloads are treated as explicit provider/data errors rather than silently producing partially trusted application objects.

## Future operations

Later Calendar operations may include event creation, update, deletion, calendar-list discovery, free/busy lookup, and settings reads. Each will declare its required capability and remain subject to the application's write-confirmation policy.

For event creation, Google's current Calendar guidance requires an appropriate write scope and write access to the target calendar. Those requirements remain external authorization invariants rather than assumptions inside the character system instruction. citeturn616269search3turn616269search0

## Security invariant

Calendar cannot delete, modify, or create anything merely because Elara's character prompt asks for an action. The application must expose the operation, authorize the capability, validate the request, and enforce any required user confirmation before a mutating call is permitted.
