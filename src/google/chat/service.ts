import type { GoogleOAuthAuthority } from '../oauth/contracts';

const MAX_SPACE_NAME_LENGTH = 500;
const MAX_MESSAGE_NAME_LENGTH = 500;
const MAX_PAGE_TOKEN_LENGTH = 5_000;
const MAX_FILTER_LENGTH = 2_000;
const MAX_PAGE_SIZE = 100;
const MAX_REQUEST_ID_LENGTH = 1_024;
const MAX_UPDATE_MASK_LENGTH = 2_000;
const MAX_REQUEST_BODY_BYTES = 1_000_000;

export interface GoogleChatMessageSummary { name: string; text?: string; createTime?: string; senderName?: string; }

function bounded(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Google Chat ${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`Google Chat ${field} is too long.`);
  return normalized;
}

function optionalBounded(value: string | undefined, field: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`Google Chat ${field} is too long.`);
  return normalized || undefined;
}

function boundedPageSize(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) throw new Error(`Google Chat pageSize must be an integer from 1 to ${MAX_PAGE_SIZE}.`);
  return value;
}

function boundedBody(body: Record<string, unknown>): Record<string, unknown> {
  if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_REQUEST_BODY_BYTES) throw new Error('Google Chat request body exceeds the application request limit.');
  return body;
}

export class GoogleChatService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listMessages(spaceName: string, pageSize?: number, pageToken?: string, filter?: string): Promise<unknown> {
    const safeSpaceName = bounded(spaceName, 'space name', MAX_SPACE_NAME_LENGTH);
    const safePageSize = boundedPageSize(pageSize);
    const safePageToken = optionalBounded(pageToken, 'page token', MAX_PAGE_TOKEN_LENGTH);
    const safeFilter = optionalBounded(filter, 'filter', MAX_FILTER_LENGTH);
    const access = await this.oauth.authorize('chat.read');
    const url = new URL('https://chat.googleapis.com/v1/messages');
    url.searchParams.set('parent', safeSpaceName);
    if (safePageSize !== undefined) url.searchParams.set('pageSize', String(safePageSize));
    if (safePageToken) url.searchParams.set('pageToken', safePageToken);
    if (safeFilter) url.searchParams.set('filter', safeFilter);
    const response = await access.fetch(url);
    return this.readJson(response);
  }

  async getMessage(messageName: string): Promise<unknown> {
    const safeMessageName = bounded(messageName, 'message name', MAX_MESSAGE_NAME_LENGTH);
    const access = await this.oauth.authorize('chat.read');
    const response = await access.fetch(`https://chat.googleapis.com/v1/${safeMessageName}`);
    return this.readJson(response);
  }

  async createMessage(spaceName: string, message: Record<string, unknown>, requestId?: string): Promise<unknown> {
    const safeSpaceName = bounded(spaceName, 'space name', MAX_SPACE_NAME_LENGTH);
    const safeRequestId = optionalBounded(requestId, 'request ID', MAX_REQUEST_ID_LENGTH);
    const safeMessage = boundedBody(message);
    const access = await this.oauth.authorize('chat.write');
    const url = new URL('https://chat.googleapis.com/v1/messages');
    url.searchParams.set('parent', safeSpaceName);
    if (safeRequestId) url.searchParams.set('requestId', safeRequestId);
    const response = await access.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(safeMessage) });
    return this.readJson(response);
  }

  async updateMessage(messageName: string, message: Record<string, unknown>, updateMask: string): Promise<unknown> {
    const safeMessageName = bounded(messageName, 'message name', MAX_MESSAGE_NAME_LENGTH);
    const safeUpdateMask = bounded(updateMask, 'update mask', MAX_UPDATE_MASK_LENGTH);
    const safeMessage = boundedBody(message);
    const access = await this.oauth.authorize('chat.write');
    const url = new URL(`https://chat.googleapis.com/v1/${safeMessageName}`);
    url.searchParams.set('updateMask', safeUpdateMask);
    const response = await access.fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(safeMessage) });
    return this.readJson(response);
  }

  async deleteMessage(messageName: string): Promise<void> {
    const safeMessageName = bounded(messageName, 'message name', MAX_MESSAGE_NAME_LENGTH);
    const access = await this.oauth.authorize('chat.write');
    const response = await access.fetch(`https://chat.googleapis.com/v1/${safeMessageName}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Google Chat request failed (${response.status}).`);
  }

  private async readJson<T = unknown>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(`Google Chat request failed (${response.status}).`);
    return (await response.json()) as T;
  }
}
