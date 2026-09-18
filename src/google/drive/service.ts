import type { GoogleOAuthAuthority } from '../oauth/contracts';
import { DriveTransferError } from './errors';
import { DRIVE_LIMITS } from './limits';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
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
}

export interface GoogleDriveListResult {
  files: readonly GoogleDriveFileSummary[];
  nextPageToken?: string;
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

function requireText(value: string, field: string, maxLength: number = DRIVE_LIMITS.maxNameLength): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Google Drive ${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`Google Drive ${field} is too long.`);
  return normalized;
}

function requireFileId(fileId: string): string {
  return requireText(fileId, 'file ID', DRIVE_LIMITS.maxFileIdLength);
}

function boundedText(value: unknown): string | undefined {
  return typeof value === 'string' ? value.slice(0, 2_000) : undefined;
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
  const capabilities = typeof file.capabilities === 'object' && file.capabilities !== null ? file.capabilities as Record<string, unknown> : null;
  const canDownload = typeof capabilities?.canDownload === 'boolean' ? capabilities.canDownload : undefined;
  const parents = Array.isArray(file.parents) ? file.parents.filter((parent): parent is string => typeof parent === 'string') : undefined;
  const size = asProviderSize(file.size);
  const description = boundedText(file.description);
  const createdTime = boundedText(file.createdTime);
  const etag = boundedText(file.etag);
  return {
    id: requireText(String(file.id ?? ''), 'file ID', DRIVE_LIMITS.maxFileIdLength),
    name: String(file.name ?? ''),
    mimeType: String(file.mimeType ?? 'application/octet-stream'),
    ...(typeof file.modifiedTime === 'string' ? { modifiedTime: file.modifiedTime } : {}),
    ...(createdTime !== undefined ? { createdTime } : {}),
    ...(typeof file.webViewLink === 'string' ? { webViewLink: file.webViewLink } : {}),
    ...(parents?.length ? { parents } : {}),
    ...(size !== undefined ? { size } : {}),
    ...(typeof file.starred === 'boolean' ? { starred: file.starred } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(typeof file.trashed === 'boolean' ? { trashed: file.trashed } : {}),
    ...(etag !== undefined ? { etag } : {}),
    ...(canDownload !== undefined ? { canDownload } : {}),
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
    throw cause;
  }
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

function transferLimit(maxBytes: number | undefined): number {
  if (maxBytes === undefined || !Number.isFinite(maxBytes)) return DRIVE_LIMITS.maxTransferBytes;
  return Math.max(1, Math.min(DRIVE_LIMITS.maxTransferBytes, Math.trunc(maxBytes)));
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
  if (/\btrashed\b/i.test(trimmed)) return trimmed;
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

  async createFile(input: GoogleDriveCreateInput): Promise<GoogleDriveFileSummary> {
    const access = await this.oauth.authorize('drive.files.app.write');
    const body: Record<string, unknown> = { name: requireText(input.name, 'file name') };
    if (input.mimeType?.trim()) body.mimeType = requireText(input.mimeType, 'MIME type', DRIVE_LIMITS.maxExportMimeTypeLength);
    if (input.parents?.length) body.parents = input.parents.map((parent) => requireFileId(parent));

    const response = await access.fetch(`${DRIVE_API}/files?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  async updateFile(fileId: string, patch: { name?: string; description?: string; starred?: boolean; trashed?: boolean }): Promise<GoogleDriveFileSummary> {
    const access = await this.oauth.authorize('drive.files.app.write');
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = requireText(patch.name, 'file name');
    if (patch.description !== undefined) body.description = patch.description.slice(0, DRIVE_LIMITS.maxDescriptionLength);
    if (patch.starred !== undefined) body.starred = patch.starred;
    if (patch.trashed !== undefined) body.trashed = patch.trashed;
    if (!Object.keys(body).length) throw new Error('Google Drive update requires at least one field.');

    const response = await access.fetch(`${DRIVE_API}/files/${encodeURIComponent(requireFileId(fileId))}?fields=${encodeURIComponent(DRIVE_FILE_FIELDS)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  async moveFile(fileId: string, parentId: string, previousParentId?: string): Promise<GoogleDriveFileSummary> {
    const access = await this.oauth.authorize('drive.files.app.write');
    const params = new URLSearchParams({
      addParents: requireFileId(parentId),
      fields: DRIVE_FILE_FIELDS,
    });
    if (previousParentId?.trim()) params.set('removeParents', requireFileId(previousParentId));

    const response = await access.fetch(`${DRIVE_API}/files/${encodeURIComponent(requireFileId(fileId))}?${params.toString()}`, { method: 'PATCH' });
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  private async listFilesFor(
    capability: 'drive.files.app.read' | 'drive.library.read',
    options: GoogleDriveListOptions,
    library: boolean,
  ): Promise<GoogleDriveListResult> {
    const access = await this.oauth.authorize(capability);
    const params = new URLSearchParams({
      pageSize: String(Math.max(1, Math.min(DRIVE_LIMITS.maxPageSize, Math.trunc(options.pageSize ?? 25)))),
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
    const files = Array.isArray(payload.files) ? payload.files.map(asFileSummary) : [];
    return { files, ...(typeof payload.nextPageToken === 'string' ? { nextPageToken: payload.nextPageToken } : {}) };
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
    return response.json() as Promise<T>;
  }
}
