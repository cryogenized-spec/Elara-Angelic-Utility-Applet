# Prompt 18 — Image Input

## Status

Accepted as the canonical image-input boundary for Elara.

## Goal

Image attachments must enter Elara through the existing attachment system and be converted into a provider-ready representation without making UI components aware of Gemini request syntax.

## Current provider facts

Google's current Gemini documentation shows native multimodal input for Interactions, including image content alongside text. The JavaScript SDK uses `@google/genai` and Interactions input parts for multimodal requests. The application must still keep the provider-specific representation inside `gemini/`. citeturn467827search3turn467827search6

## Boundary

```text
browser File
  ↓
attachments validation/normalization
  ↓
image attachment record
  ↓
provider-ready image representation
  ↓
canonical Gemini provider
```

The UI sees metadata, preview state, progress, failure, and removal actions. It never constructs an Interactions `image` object itself.

## Accepted image policy

The attachment layer should validate:

- MIME type using actual file metadata where available;
- byte size against the application limit;
- image dimensions when decoding is practical;
- successful browser decoding for previewable formats;
- safe object-URL lifecycle for local previews.

The server/provider trust boundary validates the final representation again. Picker `accept` values are only an affordance and never the security boundary.

## Provider representation

The normalized attachment should retain the original MIME type, byte length, local attachment ID, and a provider-source mode. The provider can choose the exact Interactions representation based on size and transport rules without changing attachment state.

Small transient images may be represented as inline binary data. Larger or repeatedly reused files may use an approved file-upload/reference path. The attachment abstraction therefore stores a stable logical attachment ID rather than assuming one transport forever.

## Conversation integration

Messages reference an `attachmentId` through a typed `image-ref` part. The message does not contain a duplicate base64 payload. This prevents large binary data from being copied through chat state and persistence layers.

## Failure handling

Failures remain explicit:

`selected → validating → ready → uploading/encoding → provider-ready → attached`

or

`selected → validation-failed`

or

`provider handoff → failed`

The user can remove failed attachments without damaging the conversation draft.

## Security/privacy

Image bytes are not analytics. Diagnostic records contain safe metadata only: attachment ID, type, size bucket, operation, duration, and error category. Do not place image payloads, base64 data, access tokens, or signed URLs into logs.

## Future compatibility

This boundary must support image inputs used by ordinary chat and images attached to future tool workflows without adding tool execution to the attachment subsystem. It must also remain compatible with the future character portrait feature, which is an appearance concern rather than a chat attachment.

## Completion criterion

Image files have one validated lifecycle, one logical attachment representation, one provider handoff boundary, and no direct Gemini API knowledge in UI or persistence code.