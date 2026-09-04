import type { GoogleOAuthAuthority } from '../oauth/contracts';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';

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

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Google Drive ${field} is required.`);
  if (normalized.length > 500) throw new Error(`Google Drive ${field} is too long.`);
  return normalized;
}

function requireFileId(fileId: string): string {
  return requireText(fileId, 'file ID');
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
    return this.readList(response);
  }

  async getFile(fileId: string, options: { includeContent?: boolean } = {}): Promise<GoogleDriveFileSummary & { content?: string }> {
    const access = await this.oauth.authorize('drive.files.read');
    const id = encodeURIComponent(requireFileId(fileId));
    const fields = options.includeContent ? 'id,name,mimeType,modifiedTime,webViewLink,description' : 'id,name,mimeType,modifiedTime,webViewLink,description';
    const response = await access.fetch(`${DRIVE_API}/files/${id}?fields=${encodeURIComponent(fields)}`);
    const payload = await this.readJson(response);
    return {
      id: requireText(String(payload.id ?? ''), 'file ID'),
      name: String(payload.name ?? ''),
      mimeType: String(payload.mimeType ?? 'application/octet-stream'),
      ...(typeof payload.modifiedTime === 'string' ? { modifiedTime: payload.modifiedTime } : {}),
      ...(typeof payload.webViewLink === 'string' ? { webViewLink: payload.webViewLink } : {}),
      ...(options.includeContent && typeof payload.description === 'string' ? { content: payload.description } : {}),
    };
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
    return this.readFile(response);
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
    return this.readFile(response);
  }

  async moveFile(fileId: string, parentId: string, previousParentId?: string): Promise<GoogleDriveFileSummary> {
    const access = await this.oauth.authorize('drive.files.write');
    const params = new URLSearchParams({
      addParents: requireFileId(parentId),
      fields: 'id,name,mimeType,modifiedTime,webViewLink',
    });
    if (previousParentId?.trim()) params.set('removeParents', requireFileId(previousParentId));

    const response = await access.fetch(`${DRIVE_API}/files/${encodeURIComponent(requireFileId(fileId))}?${params.toString()}`, { method: 'PATCH' });
    return this.readFile(response);
  }

  private async readList(response: Response): Promise<GoogleDriveListResult> {
    const payload = await this.readJson(response);
    const files = Array.isArray(payload.files) ? payload.files.map((file) => ({
      id: requireText(String(file.id ?? ''), 'file ID'),
      name: String(file.name ?? ''),
      mimeType: String(file.mimeType ?? 'application/octet-stream'),
      ...(typeof file.modifiedTime === 'string' ? { modifiedTime: file.modifiedTime } : {}),
      ...(typeof file.webViewLink === 'string' ? { webViewLink: file.webViewLink } : {}),
    })) : [];
    return { files, ...(typeof payload.nextPageToken === 'string' ? { nextPageToken: payload.nextPageToken } : {}) };
  }

  private async readFile(response: Response): Promise<GoogleDriveFileSummary> {
    const payload = await this.readJson(response);
    return {
      id: requireText(String(payload.id ?? ''), 'file ID'),
      name: String(payload.name ?? ''),
      mimeType: String(payload.mimeType ?? 'application/octet-stream'),
      ...(typeof payload.modifiedTime === 'string' ? { modifiedTime: payload.modifiedTime } : {}),
      ...(typeof payload.webViewLink === 'string' ? { webViewLink: payload.webViewLink } : {}),
    };
  }

  private async readJson(response: Response): Promise<Record<string, any>> {
    if (!response.ok) throw new Error(`Google Drive request failed (${response.status}).`);
    return (await response.json()) as Record<string, any>;
  }
}
