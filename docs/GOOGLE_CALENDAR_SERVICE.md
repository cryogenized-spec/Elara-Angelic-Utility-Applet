# Google Calendar Service

Prompt 42 establishes the first concrete Google Workspace service boundary: Calendar.

## Scope

The service supports read-only event listing and explicit event creation through the central OAuth authority. Event listing uses `calendar.events.read`; event creation uses the separate `calendar.events.write` capability.

The service owns Calendar API request/response translation and Calendar-domain validation. It does not own OAuth, token storage, consent, retry policy, diagnostics persistence, or user-facing UI.

## Authorization boundary

Before every operation, the service asks the OAuth authority for an authorized request capability. It never receives a raw access token and never constructs Authorization headers itself.

The Calendar service may only use capability keys declared in the central scope registry. Event creation cannot silently upgrade from the read-only capability. The tool executor enforces the application's write-confirmation policy before the handler is permitted to mutate the calendar.

## Data boundary

Only the Calendar fields required by the application-facing contract are returned for event listing. Event creation accepts an explicit event resource, bounds the calendar id, summary, event id, and serialized request size, then forwards the validated resource to the provider.

Malformed or unexpected provider payloads are treated as explicit provider/data errors rather than silently producing partially trusted application objects.

## Supported operations

`calendar.listEvents` reads ordered events within optional RFC 3339 time bounds.

`calendar.createEvent` creates one event on an explicit calendar (defaulting to `primary`). It is registered as a `write`-risk tool, is visible to Gemini through the canonical capability declarations, and must pass user confirmation before the Google API write occurs.

Future Calendar operations may include event update, deletion, calendar-list discovery, free/busy lookup, and settings reads. Each will declare its required capability and remain subject to the application's write-confirmation policy.

For event creation, Google's current Calendar guidance requires an appropriate write scope and write access to the target calendar. Those requirements remain external authorization invariants rather than assumptions inside the character system instruction. citeturn616269search3turn616269search0

## Security invariant

Calendar cannot delete, modify, or create anything merely because Elara's character prompt asks for an action. The application must expose the operation, authorize the capability, validate the request, and enforce the required user confirmation before a mutating call is permitted.
