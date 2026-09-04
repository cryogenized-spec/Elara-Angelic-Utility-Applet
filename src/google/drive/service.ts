import type { GoogleOAuthAuthority } from '../oauth/contracts';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const MAX_TRANSFER_BYTES = 10 * 1024 * 1024;

interface DriveFileResponse {
  id?: unknown;
  name?: unknown;
  mimeType?: unknown;
  modifiedTime?: unknown;
  webViewLink?: unknown;
  parents?: unknown;
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
  webViewLink?: string;
  parents?: readonly string[];
  canDownload?: boolean;
}

export interface GoogleDriveListResult {
  files: readonly GoogleDriveFileSummary[];
  nextPageToken?: string;
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

function requireText(value: string, field: string, maxLength = 500): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Google Drive ${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`Google Drive ${field} is too long.`);
  return normalized;
}

function requireFileId(fileId: string): string {
  return requireText(fileId, 'file ID');
}

function asFileSummary(value: unknown): GoogleDriveFileSummary {
  const file = value as DriveFileResponse;
  const capabilities = typeof file.capabilities === 'object' && file.capabilities !== null ? file.capabilities as Record<string, unknown> : null;
  const canDownload = typeof capabilities?.canDownload === 'boolean' ? capabilities.canDownload : undefined;
  const parents = Array.isArray(file.parents) ? file.parents.filter((parent): parent is string => typeof parent === 'string') : undefined;
  return {
    id: requireText(String(file.id ?? ''), 'file ID'),
    name: String(file.name ?? ''),
    mimeType: String(file.mimeType ?? 'application/octet-stream'),
    ...(typeof file.modifiedTime === 'string' ? { modifiedTime: file.modifiedTime } : {}),
    ...(typeof file.webViewLink === 'string' ? { webViewLink: file.webViewLink } : {}),
    ...(parents?.length ? { parents } : {}),
    ...(canDownload !== undefined ? { canDownload } : {}),
  };
}

async function readBinaryResponse(response: Response, operation: string, limit = MAX_TRANSFER_BYTES): Promise<GoogleDriveContent> {
  if (!response.ok) throw new Error(`${operation} failed (${response.status}).`);
  const contentLength = Number(response.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > limit) throw new Error(`${operation} exceeds the application transfer limit.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > limit) throw new Error(`${operation} exceeds the application transfer limit.`);
  return { mimeType: response.headers.get('content-type')?.split(';', 1)[0] ?? 'application/octet-stream', bytes };
}

export class GoogleDriveService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listFiles(options: { query?: string; pageToken?: string; pageSize?: number } = {}): Promise<GoogleDriveListResult> {
    const access = await this.oauth.authorize('drive.files.read');
    const params = new URLSearchParams({
      pageSize: String(Math.max(1, Math.min(100, Math.trunc(options.pageSize ?? 25)))),
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink,parents,capabilities(canDownload))',
      spaces: 'drive',
    });
    if (options.query?.trim()) params.set('q', options.query.trim());
    if (options.pageToken?.trim()) params.set('pageToken', options.pageToken.trim());

    const response = await access.fetch(`${DRIVE_API}/files?${params.toString()}`);
    const payload = await this.readJson<DriveListResponse>(response);
    const files = Array.isArray(payload.files) ? payload.files.map(asFileSummary) : [];
    return { files, ...(typeof payload.nextPageToken === 'string' ? { nextPageToken: payload.nextPageToken } : {}) };
  }

  async getFile(fileId: string): Promise<GoogleDriveFileSummary> {
    const access = await this.oauth.authorize('drive.files.read');
    const id = encodeURIComponent(requireFileId(fileId));
    const fields = encodeURIComponent('id,name,mimeType,modifiedTime,webViewLink,parents,capabilities(canDownload)');
    const response = await access.fetch(`${DRIVE_API}/files/${id}?fields=${fields}`);
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  async downloadFile(fileId: string, maxBytes = MAX_TRANSFER_BYTES): Promise<GoogleDriveContent> {
    const limit = Math.max(1, Math.min(MAX_TRANSFER_BYTES, Math.trunc(maxBytes)));
    const access = await this.oauth.authorize('drive.files.read');
    const id = encodeURIComponent(requireFileId(fileId));
    const metadata = await this.getFile(fileId);
    if (metadata.canDownload === false) throw new Error('Google Drive reports that this file cannot be downloaded.');
    const response = await access.fetch(`${DRIVE_API}/files/${id}?alt=media`);
    return readBinaryResponse(response, 'Google Drive download', limit);
  }

  async exportFile(fileId: string, mimeType: string): Promise<GoogleDriveContent> {
    const access = await this.oauth.authorize('drive.files.read');
    const id = encodeURIComponent(requireFileId(fileId));
    const type = requireText(mimeType, 'export MIME type', 200);
    const response = await access.fetch(`${DRIVE_API}/files/${id}/export?mimeType=${encodeURIComponent(type)}`);
    return readBinaryResponse(response, 'Google Drive export');
  }

  async createFile(input: GoogleDriveCreateInput): Promise<GoogleDriveFileSummary> {
    const access = await this.oauth.authorize('drive.files.write');
    const body: Record<string, unknown> = { name: requireText(input.name, 'file name') };
    if (input.mimeType?.trim()) body.mimeType = requireText(input.mimeType, 'MIME type', 200);
    if (input.parents?.length) body.parents = input.parents.map((parent) => requireFileId(parent));

    const response = await access.fetch(`${DRIVE_API}/files?fields=id,name,mimeType,modifiedTime,webViewLink,parents,capabilities(canDownload)`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  async updateFile(fileId: string, patch: { name?: string; description?: string; starred?: boolean; trashed?: boolean }): Promise<GoogleDriveFileSummary> {
    const access = await this.oauth.authorize('drive.files.write');
    const body: Record<string, unknown> = {};
    if (patch.name !== undefined) body.name = requireText(patch.name, 'file name');
    if (patch.description !== undefined) body.description = patch.description.slice(0, 2000);
    if (patch.starred !== undefined) body.starred = patch.starred;
    if (patch.trashed !== undefined) body.trashed = patch.trashed;
    if (!Object.keys(body).length) throw new Error('Google Drive update requires at least one field.');

    const response = await access.fetch(`${DRIVE_API}/files/${encodeURIComponent(requireFileId(fileId))}?fields=id,name,mimeType,modifiedTime,webViewLink,parents,capabilities(canDownload)`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  async moveFile(fileId: string, parentId: string, previousParentId?: string): Promise<GoogleDriveFileSummary> {
    const access = await this.oauth.authorize('drive.files.write');
    const params = new URLSearchParams({
      addParents: requireFileId(parentId),
      fields: 'id,name,mimeType,modifiedTime,webViewLink,parents,capabilities(canDownload)',
    });
    if (previousParentId?.trim()) params.set('removeParents', requireFileId(previousParentId));

    const response = await access.fetch(`${DRIVE_API}/files/${encodeURIComponent(requireFileId(fileId))}?${params.toString()}`, { method: 'PATCH' });
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  private async readJson<T>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(`Google Drive request failed (${response.status}).`);
    return response.json() as Promise<T>;
  }
}
