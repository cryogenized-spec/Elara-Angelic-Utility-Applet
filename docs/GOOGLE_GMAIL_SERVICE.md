# Google Gmail Service

Prompt 45 brings Gmail forward as a first-class orchestration substrate. It is intentionally not treated as a single `email` tool.

## Granular operation surface

The service separates message retrieval, message/thread retrieval, label inspection, label mutation, message/thread label mutation, trash/untrash, and sending. Pagination and Gmail search queries remain explicit so the orchestrator can inspect precisely what it is acting on.

Google's current Gmail API exposes separate resources for messages, threads, labels, and drafts, with operations including list/get/modify/trash/untrash; message resources also expose batch modification and send, while drafts have create/get/list/update/send/delete. citeturn909083search0turn909083search5turn909083search7

## Authorization

The current application capability layer distinguishes `gmail.read`, `gmail.modify`, and `gmail.send`. The scope registry remains authoritative for mapping those capabilities to provider scopes. Google currently documents separate Gmail scopes including `gmail.readonly`, `gmail.modify`, `gmail.send`, `gmail.labels`, and settings scopes; the narrowest applicable scope should be selected when a capability is finalized. citeturn757480search0turn757480search1

## Orchestration/Kanban implications

Gmail operations are designed to become auditable work units. For example, finding an email, identifying its thread, applying a label, moving it to trash, drafting a response, and sending that response are separate operations rather than one opaque assistant action.

The Kanban/orchestration layer must consume service results and operation records. It must not receive OAuth tokens or embed Gmail endpoint details.

## Safety

Sending, destructive deletion, bulk modification, and other consequential mutations must flow through the application write-confirmation policy before execution. Read operations may be selected automatically when authorized.
