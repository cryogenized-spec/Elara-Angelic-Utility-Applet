# Prompt 19 — Document Input

## Status

Accepted as the canonical document/PDF input boundary for Elara.

## Goal

Documents enter through the shared attachment lifecycle and are transformed into provider-ready content only at the provider boundary. PDF is the primary document target.

## Current provider facts

Google's current documentation confirms native document input in Interactions. PDFs can be supplied inline for smaller transient inputs; the current documentation recommends the Files API for larger files or files reused across multiple requests. Google documents a 50 MB PDF limit for inline handling, while the Files API supports much larger files. citeturn467827search0turn467827search1turn467827search5

## Accepted document classes

The initial application supports PDF first, with a typed extension point for other document MIME types that Gemini supports as text-oriented inputs. Unsupported formats fail validation before provider handoff.

The attachment system records MIME type, byte length, original filename, and a stable attachment ID. It does not convert every document to text in the browser merely to make the provider simpler.

## Transport selection

The provider chooses the transport based on current provider limits and lifecycle requirements:

- inline document data for small transient files;
- Files API upload/reference for larger or reusable files;
- a future approved remote URI/reference path where the security boundary permits it.

The logical attachment contract remains transport-neutral.

## PDF-specific behavior

PDFs are treated as multimodal documents rather than text-only blobs. Google's current document-processing guidance says Gemini can understand text, images, diagrams, charts, and tables in PDFs. Elara therefore must not pre-strip PDFs into plain text as the default path. citeturn467827search5

## Lifecycle

`picked → validating → ready → transfer/encoding → provider-ready → consumed`

Failures are explicit and recoverable. A failed document must not leave the composer permanently blocked or create a half-persisted message.

## Conversation integration

Messages store a typed `document-ref` part pointing to attachment metadata. Binary document bytes are not duplicated inside message records or conversation JSON.

## Security/privacy

Validate MIME, size, and attachment provenance at the application boundary and again at the Worker/provider trust boundary. Do not trust filename extensions. Never place raw PDF bytes, signed upload URLs, API keys, or OAuth material into diagnostics or analytics.

## Future compatibility

The document layer must work with future tool calls and Google Workspace results without embedding Google-specific service logic. A Workspace tool returning a document reference is data produced by a tool service; it does not turn the attachment system into the tool executor.

## Completion criterion

PDF-first document support has a single validated lifecycle, transport-neutral logical representation, explicit provider handoff, and clear separation from chat orchestration and tool execution.