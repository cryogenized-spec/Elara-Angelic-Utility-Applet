import type { GoogleOAuthAuthority } from '../oauth/contracts';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

interface DriveFileResponse {
  id?: unknown;
  name?: unknown;
  mimeType?: unknown;
  modifiedTime?: unknown;
  webViewLink?: unknown;
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
  return {
    id: requireText(String(file.id ?? ''), 'file ID'),
    name: String(file.name ?? ''),
    mimeType: String(file.mimeType ?? 'application/octet-stream'),
    ...(typeof file.modifiedTime === 'string' ? { modifiedTime: file.modifiedTime } : {}),
    ...(typeof file.webViewLink === 'string' ? { webViewLink: file.webViewLink } : {}),
  };
}

export class GoogleDriveService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listFiles(options: { query?: string; pageToken?: string; pageSize?: number } = {}): Promise<GoogleDriveListResult> {
    const access = await this.oauth.authorize('drive.files.read');
    const params = new URLSearchParams({
      pageSize: String(Math.max(1, Math.min(100, Math.trunc(options.pageSize ?? 25)))),
      fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,webViewLink)',
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
    const fields = encodeURIComponent('id,name,mimeType,modifiedTime,webViewLink');
    const response = await access.fetch(`${DRIVE_API}/files/${id}?fields=${fields}`);
    return asFileSummary(await this.readJson<DriveFileResponse>(response));
  }

  async downloadFile(fileId: string): Promise<Blob> {
    const access = await this.oauth.authorize('drive.files.read');
    const id = encodeURIComponent(requireFileId(fileId));
    const response = await access.fetch(`${DRIVE_API}/files/${id}?alt=media`);
    if (!response.ok) throw new Error(`Google Drive download failed (${response.status}).`);
    return response.blob();
  }

  async createFile(input: GoogleDriveCreateInput): Promise<GoogleDriveFileSummary> {
    const access = await this.oauth.authorize('drive.files.write');
    const body: Record<string, unknown> = { name: requireText(input.name, 'file name') };
    if (input.mimeType?.trim()) body.mimeType = input.mimeType.trim();
    if (input.parents?.length) body.parents = input.parents.map((parent) => requireFileId(parent));

    const response = await access.fetch(`${DRIVE_API}/files?fields=id,name,mimeType,modifiedTime,webViewLink`, {
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

    const response = await access.fetch(`${DRIVE_API}/files/${encodeURIComponent(requireFileId(fileId))}?fields=id,name,mimeType,modifiedTime,webViewLink`, {
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
      fields: 'id,name,mimeType,modifiedTime,webViewLink',
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
