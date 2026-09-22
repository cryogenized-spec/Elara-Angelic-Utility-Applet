import type { GoogleOAuthAuthority } from '../oauth/contracts';
import { DriveTransferError } from './errors';
import { DRIVE_LIMITS } from './limits';
import { readBoundedProviderJson } from '../provider-json-boundary';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const MAX_PROVIDER_JSON_BYTES = 2 * 1024 * 1024;
const GOOGLE_NATIVE_MIME_PREFIX = 'application/vnd.google-apps.';

/**
 * Fields every Drive read asks for.
 *
 * Read parity is deliberate: provider identity needed for a later safe mutation
 * (`etag`), user-visible metadata (`starred`, `description`, `createdTime`,
 * `trashed`) and the size/trash state the download and search contracts depend on
 * are projected here rather than fetched ad hoc, so search, get and download
 * never disagree about what a Drive file is.
 */
const DRIVE_FILE_FIELDS = 'id,name,mimeType,modifiedTime,createdTime,webViewLink,parents,size,starred,description,trashed,etag,capabilities(canDownload)';

interface DriveFileResponse {
  id?: unknown;
  name?: unknown;
  mimeType?: unknown;
  modifiedTime?: unknown;
  createdTime?: unknown;
  webViewLink?: unknown;
  parents?: unknown;
  size?: unknown;
  starred?: unknown;
  description?: unknown;
  trashed?: unknown;
  etag?: unknown;
  capabilities?: unknown;
}

interface DriveListResponse {
  files?: unknown;
  nextPageToken?: unknown;
}

export interface GoogleDriveFileSummary {
  readonly trust: 'untrusted-external';
  readonly source: 'drive';
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  createdTime?: string;
  webViewLink?: string;
  parents?: readonly string[];
  size?: number;
  starred?: boolean;
  description?: string;
  trashed?: boolean;
  /** Strong provider validator used later as a conditional-write precondition. */
  etag?: string;
  canDownload?: boolean;
  readonly truncatedFields?: readonly string[];
}

export interface GoogleDriveListResult {
  readonly trust: 'untrusted-external';
  readonly source: 'drive';
  files: readonly GoogleDriveFileSummary[];
  nextPageToken?: string;
  readonly truncated?: boolean;
}

export interface GoogleDriveListOptions {
  query?: string;
  pageToken?: string;
  pageSize?: number;
  /** Explicit opt-in to trashed results. Drive otherwise returns trashed files like live ones. */
  showTrashed?: boolean;
}

export interface GoogleDriveCreateInput {
  name: string;
  mimeType?: string;
  parents?: readonly string[];
}

export interface GoogleDriveContent {
  mimeType: string;
  bytes: Uint8Array;
}

export interface GoogleDriveDownload {
  metadata: GoogleDriveFileSummary;
  mimeType: string;
  bytes: Uint8Array;
  size: number;
}

export interface GoogleDriveTransferOptions {
  maxBytes?: number;
  signal?: AbortSignal;
}

export interface GoogleDriveMutationOptions {
  signal?: AbortSignal;
  isGenerationActive?: () => boolean;
  beforeProviderFetch?: () => void | Promise<void>;
}

function requireText(value: string, field: string, maxLength: number = DRIVE_LIMITS.maxNameLength): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Google Drive ${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`Google Drive ${field} is too long.`);
  return normalized;
}

function requireFileId(fileId: string): string {
  return requireText(fileId, 'file ID', DRIVE_LIMITS.maxFileIdLength);
}

function boundedText(value: unknown, maxLength: number = DRIVE_LIMITS.maxProviderTextLength): string | undefined {
  return typeof value === 'string' ? value.slice(0, maxLength) : undefined;
}

/**
 * A web-view link is either present and truthful or absent.
 *
 * A truncated URL would be a lie the user could click, so an oversized or
 * non-HTTPS link is dropped instead of cut.
 */
function boundedWebViewLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value || value.length > DRIVE_LIMITS.maxProviderTextLength) return undefined;
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A MIME type is classification authority, so a truncated one is worse than
 * none: an implausible value falls back to the generic binary type. This is the
 * same fallback the artifact boundary already applies to a generic media type.
 */
function boundedMimeType(value: unknown): string {
  if (typeof value !== 'string') return 'application/octet-stream';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > DRIVE_LIMITS.maxExportMimeTypeLength) return 'application/octet-stream';
  return trimmed;
}

function asProviderSize(value: unknown): number | undefined {
  // Drive serializes `size` as a string. A malformed or out-of-range value is
  // reported as unknown rather than guessed, because the download ceiling and
  // the artifact size both read this field.
  const parsed = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > Number.MAX_SAFE_INTEGER) return undefined;
  return Math.trunc(parsed);
}

function asFileSummary(value: unknown): GoogleDriveFileSummary {
  const file = value as DriveFileResponse;
  const truncated = new Set<string>();
  const capabilities = typeof file.capabilities === 'object' && file.capabilities !== null ? file.capabilities as Record<string, unknown> : null;
  const canDownload = typeof capabilities?.canDownload === 'boolean' ? capabilities.canDownload : undefined;

  const rawParents = Array.isArray(file.parents) ? file.parents.filter((parent): parent is string => typeof parent === 'string') : [];
  if (rawParents.length > DRIVE_LIMITS.maxParents) truncated.add('parents');
  const parents = rawParents.slice(0, DRIVE_LIMITS.maxParents).flatMap((parent) => {
    const normalized = parent.trim();
    if (!normalized || normalized.length > DRIVE_LIMITS.maxFileIdLength) {
      truncated.add('parents');
      return [];
    }
    return [normalized];
  });

  const size = asProviderSize(file.size);
  if (file.size !== undefined && size === undefined) truncated.add('size');

  const description = boundedText(file.description, DRIVE_LIMITS.maxDescriptionLength);
  if (typeof file.description === 'string' && file.description.length > DRIVE_LIMITS.maxDescriptionLength) truncated.add('description');

  const createdTime = boundedText(file.createdTime);
  if (typeof file.createdTime === 'string' && file.createdTime.length > DRIVE_LIMITS.maxProviderTextLength) truncated.add('createdTime');

  const modifiedTime = boundedText(file.modifiedTime);
  if (typeof file.modifiedTime === 'string' && file.modifiedTime.length > DRIVE_LIMITS.maxProviderTextLength) truncated.add('modifiedTime');

  const etag = typeof file.etag === 'string' && file.etag.trim().length <= DRIVE_LIMITS.maxEtagLength
    ? file.etag.trim()
    : undefined;
  if (typeof file.etag === 'string' && file.etag.trim() && !etag) truncated.add('etag');

  const webViewLink = boundedWebViewLink(file.webViewLink);
  if (typeof file.webViewLink === 'string' && file.webViewLink && !webViewLink) truncated.add('webViewLink');

  const mimeType = boundedMimeType(file.mimeType);
  if (typeof file.mimeType === 'string' && file.mimeType.trim() && mimeType === 'application/octet-stream' && file.mimeType.trim() !== mimeType) {
    truncated.add('mimeType');
  }

  const name = boundedText(file.name, DRIVE_LIMITS.maxNameLength) ?? '';
  if (typeof file.name === 'string' && file.name.length > DRIVE_LIMITS.maxNameLength) truncated.add('name');

  return {
    trust: 'untrusted-external',
    source: 'drive',
    id: requireText(String(file.id ?? ''), 'file ID', DRIVE_LIMITS.maxFileIdLength),
    name,
    mimeType,
    ...(modifiedTime !== undefined ? { modifiedTime } : {}),
    ...(createdTime !== undefined ? { createdTime } : {}),
    ...(webViewLink !== undefined ? { webViewLink } : {}),
    ...(parents.length ? { parents } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(typeof file.starred === 'boolean' ? { starred: file.starred } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(typeof file.trashed === 'boolean' ? { trashed: file.trashed } : {}),
    ...(etag !== undefined ? { etag } : {}),
    ...(canDownload !== undefined ? { canDownload } : {}),
    ...(truncated.size ? { truncatedFields: [...truncated].sort() } : {}),
  };
}

function transferTooLarge(operation: string): DriveTransferError {
  return new DriveTransferError('DRIVE_FILE_TOO_LARGE', `${operation} exceeds the application transfer limit.`);
}

/**
 * Read a binary body under a hard ceiling.
 *
 * The declared content length is checked first, and the body is then read
 * incrementally so a chunked or unterminated response is cancelled as soon as it
 * crosses the ceiling instead of being buffered whole and rejected afterwards.
 */
async function readBinaryResponse(response: Response, operation: string, limit: number, signal?: AbortSignal): Promise<GoogleDriveContent> {
  if (!response.ok) throw new DriveTransferError('DRIVE_TRANSFER_FAILED', `${operation} failed (${response.status}).`);
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > limit) throw transferTooLarge(operation);
  const mimeType = response.headers.get('content-type')?.split(';', 1)[0] ?? 'application/octet-stream';
  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (signal?.aborted) throw new DOMException(`${operation} was cancelled.`, 'AbortError');
    if (bytes.byteLength > limit) throw transferTooLarge(operation);
    return { mimeType, bytes };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (signal?.aborted) throw new DOMException(`${operation} was cancelled.`, 'AbortError');
      total += value.byteLength;
      if (total > limit) throw transferTooLarge(operation);
      chunks.push(value);
    }
  } catch (cause) {
    await reader.cancel().catch(() => undefined);
    if (cause instanceof DriveTransferError || (cause instanceof DOMException && cause.name === 'AbortError')) throw cause;
    throw new DriveTransferError('DRIVE_TRANSFER_FAILED', `${operation} failed while reading the response.`, cause);
  }
  if (signal?.aborted) throw new DOMException(`${operation} was cancelled.`, 'AbortError');
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { mimeType, bytes };
}

function requireCurrent(signal: AbortSignal | undefined, operation: string): void {
  if (signal?.aborted) throw new DOMException(`${operation} was cancelled.`, 'AbortError');
}

function requireMutationCurrent(options: GoogleDriveMutationOptions, operation: string): void {
  if (options.signal?.aborted || options.isGenerationActive?.() === false) {
    throw new DOMException(`${operation} lost turn authority.`, 'AbortError');
  }
}

function providerMutationGuard(options: GoogleDriveMutationOptions, operation: string): () => Promise<void> {
  return async () => {
    requireMutationCurrent(options, operation);
    await options.beforeProviderFetch?.();
    requireMutationCurrent(options, operation);
  };
}

/**
 * Optional free-form Drive parameters are bounded at the service boundary, not
 * only in the model schema, so a direct caller cannot widen the contract the
 * declaration and validation establish.
 */
function boundedParameter(value: string | undefined, field: string, maxLength: number): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxLength) throw new Error(`Google Drive ${field} is too long.`);
  return trimmed;
}

/**
 * One concrete strong ETag is the only validator a conditional write accepts.
 * Weak (`W/"..."`), wildcard (`*`) and multi-value validators are rejected here
 * rather than at the provider, so a direct caller cannot widen the contract the
 * model schema and declaration establish.
 */
const CONCRETE_DRIVE_ETAG_PATTERN = /^"[^"]+"$/;

function conditionalHeaders(etag: string): Record<string, string> {
  const safeEtag = boundedParameter(etag, 'ETag', DRIVE_LIMITS.maxEtagLength);
  if (!safeEtag || !CONCRETE_DRIVE_ETAG_PATTERN.test(safeEtag)) {
    throw new Error('Google Drive mutations require one concrete provider ETag. Read the file again before changing it.');
  }
  return { 'If-Match': safeEtag };
}

function throwMutationFailure(response: Response, action: string): never {
  if (response.status === 412) throw new Error(`Google Drive ${action} was rejected because the file changed. Read the file again before retrying.`);
  throw new Error(`Google Drive ${action} request failed (${response.status}).`);
}

function transferLimit(maxBytes: number | undefined): number {
  if (maxBytes === undefined || !Number.isFinite(maxBytes)) return DRIVE_LIMITS.maxTransferBytes;
  return Math.max(1, Math.min(DRIVE_LIMITS.maxTransferBytes, Math.trunc(maxBytes)));
}

/**
 * Read an explicit trashed opt-in out of Drive query text.
 *
 * Quoted literals are removed first, so a *file name* containing the word
 * "trashed" cannot be mistaken for the caller's own predicate, and an
 * unbalanced literal is never trusted as an opt-in. A malformed query therefore
 * keeps the conservative `trashed = false` boundary rather than widening it.
 */
function hasExplicitTrashedPredicate(query: string): boolean {
  const stripped = query.replace(/'(?:[^'\\]|\\.)*'/g, "''").replace(/"(?:[^"\\]|\\.)*"/g, '""');
  const singles = (stripped.match(/'/g) ?? []).length;
  const doubles = (stripped.match(/"/g) ?? []).length;
  if (singles % 2 !== 0 || doubles % 2 !== 0) return false;
  return /\btrashed\b/i.test(stripped);
}

/**
 * Drive returns trashed files alongside live ones unless the query says
 * otherwise. Elara's reads exclude trashed files by default; `showTrashed` (or an
 * explicit `trashed` predicate in the caller's own query, which is honored
 * verbatim) is the only way to see them.
 */
export function driveQueryWithTrashBoundary(query: string | undefined, showTrashed: boolean): string | undefined {
  const trimmed = boundedParameter(query, 'query', DRIVE_LIMITS.maxQueryLength);
  if (showTrashed) return trimmed;
  if (!trimmed) return 'trashed = false';
  // Only a predicate counts as an explicit opt-in. A file whose *name* contains
  // the word "trashed" must not be able to suppress the boundary.
  if (hasExplicitTrashedPredicate(trimmed)) return trimmed;
  return `${trimmed} and trashed = false`;
}

export class GoogleDriveService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listFiles(options: GoogleDriveListOptions = {}): Promise<GoogleDriveListResult> {
    return this.listFilesFor('drive.files.app.read', options, false);
  }

  async searchLibrary(options: GoogleDriveListOptions = {}): Promise<GoogleDriveListResult> {
    return this.listFilesFor('drive.library.read', options, true);
  }

  async getFile(fileId: string): Promise<GoogleDriveFileSummary> {
    const access = await this.oauth.authorize('drive.files.app.read');
    return this.fetchMetadata(access, fileId);
  }

  /**
   * Read one Drive file's bytes through the provider boundary.
   *
   * The service returns bounded bytes and metadata only; deciding where those
   * bytes live (the artifact repository) belongs to the tool boundary, so this
   * adapter never writes application state.
   */
  async downloadFile(fileId: string, options: GoogleDriveTransferOptions = {}): Promise<GoogleDriveDownload> {
    const limit = transferLimit(options.maxBytes);
    const signal = options.signal;
    requireCurrent(signal, 'Google Drive download');
    const access = await this.oauth.authorize('drive.files.app.read');
    const id = encodeURIComponent(requireFileId(fileId));
    // One authorization covers the metadata read and the transfer that follows.
    const metadata = await this.fetchMetadata(access, fileId);
    requireCurrent(signal, 'Google Drive download');
    if (metadata.mimeType.startsWith(GOOGLE_NATIVE_MIME_PREFIX)) {
      throw new DriveTransferError('DRIVE_FILE_UNSUPPORTED', 'Google Docs editors files cannot be downloaded directly; they have to be exported.');
    }
    if (metadata.canDownload === false) throw new DriveTransferError('DRIVE_FILE_UNSUPPORTED', 'Google Drive reports that this file cannot be downloaded.');
    if (metadata.size !== undefined && metadata.size > limit) throw new DriveTransferError('DRIVE_FILE_TOO_LARGE', 'Google Drive download exceeds the application transfer limit.');
    const response = await this.fetchMedia(access.fetch, `${DRIVE_API}/files/${id}?alt=media`, signal);
    const content = await readBinaryResponse(response, 'Google Drive download', limit, signal);
    return { metadata, mimeType: content.mimeType, bytes: content.bytes, size: content.bytes.byteLength };
  }

  async exportFile(fileId: string, mimeType: string, options: GoogleDriveTransferOptions = {}): Promise<GoogleDriveContent> {
    const limit = transferLimit(options.maxBytes);
    requireCurrent(options.signal, 'Google Drive export');
    const access = await this.oauth.authorize('drive.files.app.read');
    const id = encodeURIComponent(requireFileId(fileId));
    const type = requireText(mimeType, 'export MIME type', DRIVE_LIMITS.maxExportMimeTypeLength);
    const response = await this.fetchMedia(access.fetch, `${DRIVE_API}/files/${id}/export?mimeType=${encodeURIComponent(type)}`, options.signal);
    return readBinaryResponse(response, 'Google Drive export', limit, options.signal);
  }

  async createFile(input: GoogleDriveCreateInput, options: GoogleDriveMutationOptions = {}): Promise<GoogleDriveFileSummary> {
    requireMutationCurrent(options, 'Google Drive create');
    const access = await this.oauth.authorize('drive.files.app.write');
    requireMutationCurrent(options, 'Google Drive create');
    const body: Record<string, unknown> = { name: requireText(input.name, 'file name') };
    if (input.mimeType?.trim()) body.mimeType = requireText(input.mimeType, 'MIME type', DRIVE_LIMITS.maxExportMimeTypeLength);
    if (input.parents?.length) {
      // Collapse duplicates: the same parent id twice is still one parent.
      body.parents = Array.from(new Set(input.parents.map((parent) => requireFileId(parent))));
    }

    const response = await access.fetch(`${DRIVE_API}/files?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    }, providerMutationGuard(options, 'Google Drive create'));
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  /**
   * Conditional metadata write: the caller must present the ETag it read, and
   * the provider rejects the write if the file changed in between. Trashing is
   * deliberately absent from this ordinary-write patch; {@link trashFile} is the
   * one explicit path that moves a file to trash.
   */
  async updateFile(fileId: string, etag: string, patch: { name?: string; description?: string; starred?: boolean }, options: GoogleDriveMutationOptions = {}): Promise<GoogleDriveFileSummary> {
    const headers = { 'content-type': 'application/json', ...conditionalHeaders(etag) };
    requireMutationCurrent(options, 'Google Drive update');
    const access = await this.oauth.authorize('drive.files.app.write');
    requireMutationCurrent(options, 'Google Drive update');
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = requireText(patch.name, 'file name');
    if (patch.description !== undefined) body.description = patch.description.slice(0, DRIVE_LIMITS.maxDescriptionLength);
    if (patch.starred !== undefined) body.starred = patch.starred;
    if (!Object.keys(body).length) throw new Error('Google Drive update requires at least one field.');

    const response = await access.fetch(`${DRIVE_API}/files/${encodeURIComponent(requireFileId(fileId))}?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    }, providerMutationGuard(options, 'Google Drive update'));
    if (!response.ok) throwMutationFailure(response, 'update');
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  /**
   * Move a file by adding one parent and optionally removing another. Drive
   * files may have several parents: when `previousParentId` is omitted the file
   * stays in its current folder as well as appearing in the destination.
   */
  async moveFile(fileId: string, etag: string, parentId: string, previousParentId?: string, options: GoogleDriveMutationOptions = {}): Promise<GoogleDriveFileSummary> {
    const destination = requireFileId(parentId);
    const previous = previousParentId?.trim() ? requireFileId(previousParentId) : undefined;
    if (previous && previous === destination) {
      throw new Error('Google Drive move cannot remove and add the same parent.');
    }
    const headers = conditionalHeaders(etag);
    requireMutationCurrent(options, 'Google Drive move');
    const access = await this.oauth.authorize('drive.files.app.write');
    requireMutationCurrent(options, 'Google Drive move');
    const params = new URLSearchParams({
      addParents: destination,
      fields: DRIVE_FILE_FIELDS,
    });
    if (previous) params.set('removeParents', previous);

    const response = await access.fetch(`${DRIVE_API}/files/${encodeURIComponent(requireFileId(fileId))}?${params.toString()}`, {
      method: 'PATCH',
      headers,
      ...(options.signal ? { signal: options.signal } : {}),
    }, providerMutationGuard(options, 'Google Drive move'));
    if (!response.ok) throwMutationFailure(response, 'move');
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  /**
   * Move one file to trash under a conditional write. Elara never permanently
   * deletes a Drive file: trash is the model-visible end state, and the provider
   * keeps the file recoverable.
   */
  async trashFile(fileId: string, etag: string, options: GoogleDriveMutationOptions = {}): Promise<GoogleDriveFileSummary> {
    // The validator is checked before any authorization or request, exactly like
    // the other conditional writes.
    const headers = { 'content-type': 'application/json', ...conditionalHeaders(etag) };
    requireMutationCurrent(options, 'Google Drive trash');
    const access = await this.oauth.authorize('drive.files.app.write');
    requireMutationCurrent(options, 'Google Drive trash');
    const response = await access.fetch(`${DRIVE_API}/files/${encodeURIComponent(requireFileId(fileId))}?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ trashed: true }),
      ...(options.signal ? { signal: options.signal } : {}),
    }, providerMutationGuard(options, 'Google Drive trash'));
    if (!response.ok) throwMutationFailure(response, 'trash');
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  private async listFilesFor(
    capability: 'drive.files.app.read' | 'drive.library.read',
    options: GoogleDriveListOptions,
    library: boolean,
  ): Promise<GoogleDriveListResult> {
    const access = await this.oauth.authorize(capability);
    const pageSize = Math.max(1, Math.min(DRIVE_LIMITS.maxPageSize, Math.trunc(options.pageSize ?? 25)));
    const params = new URLSearchParams({
      pageSize: String(pageSize),
      fields: `nextPageToken,files(${DRIVE_FILE_FIELDS})`,
      spaces: 'drive',
    });
    if (library) params.set('corpora', 'user');
    const query = driveQueryWithTrashBoundary(options.query, options.showTrashed === true);
    if (query) params.set('q', query);
    const pageToken = boundedParameter(options.pageToken, 'page token', DRIVE_LIMITS.maxPageTokenLength);
    if (pageToken) params.set('pageToken', pageToken);

    const response = await access.fetch(`${DRIVE_API}/files?${params.toString()}`);
    const payload = await this.readJson<DriveListResponse>(response);
    const rawFiles = Array.isArray(payload.files) ? payload.files : [];
    const files = rawFiles.slice(0, pageSize).flatMap((file) => {
      try {
        return [asFileSummary(file)];
      } catch {
        return [];
      }
    });
    const nextPageToken = typeof payload.nextPageToken === 'string' && payload.nextPageToken.length <= DRIVE_LIMITS.maxPageTokenLength
      ? payload.nextPageToken
      : undefined;
    const truncated = rawFiles.length > pageSize
      || files.length < Math.min(rawFiles.length, pageSize)
      || (typeof payload.nextPageToken === 'string' && !nextPageToken);
    return {
      trust: 'untrusted-external',
      source: 'drive',
      files,
      ...(nextPageToken ? { nextPageToken } : {}),
      ...(truncated ? { truncated: true } : {}),
    };
  }

  private async fetchMetadata(access: Awaited<ReturnType<GoogleOAuthAuthority['authorize']>>, fileId: string): Promise<GoogleDriveFileSummary> {
    const id = encodeURIComponent(requireFileId(fileId));
    const fields = encodeURIComponent(DRIVE_FILE_FIELDS);
    const response = await access.fetch(`${DRIVE_API}/files/${id}?fields=${fields}`);
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  /**
   * A transport failure is a transfer failure, not a silent empty result. The
   * transfer still runs on the capability-bound fetch the OAuth authority
   * handed out; this adapter never owns global egress.
   */
  private async fetchMedia(transport: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>, url: string, signal?: AbortSignal): Promise<Response> {
    try {
      return await transport(url, signal ? { signal } : undefined);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      throw new DriveTransferError('DRIVE_TRANSFER_FAILED', 'Google Drive could not be reached for this transfer.', cause);
    }
  }

  private async readJson<T>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(`Google Drive request failed (${response.status}).`);
    return readBoundedProviderJson<T>(response, { operation: 'Google Drive request', maxBytes: MAX_PROVIDER_JSON_BYTES });
  }
}
