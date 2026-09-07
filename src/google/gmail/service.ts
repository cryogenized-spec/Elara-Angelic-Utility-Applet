import type { GoogleOAuthAuthority } from '../oauth/contracts';

export interface GmailMessageSummary {
  id: string;
  threadId?: string;
  labelIds: string[];
  snippet?: string;
}

export interface GmailThreadSummary {
  id: string;
  historyId?: string;
  messageIds: string[];
}

type GmailListResponse = { messages?: Array<{ id?: string; threadId?: string }>; threads?: Array<{ id?: string; historyId?: string }>; nextPageToken?: string; resultSizeEstimate?: number };
const MAX_LIST_RESULTS = 500;
const MAX_QUERY_LENGTH = 2_000;
const MAX_PAGE_TOKEN_LENGTH = 5_000;
const MAX_RAW_MESSAGE_BYTES = 8 * 1024 * 1024;

function boundedListSize(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIST_RESULTS) throw new Error(`Gmail maxResults must be an integer from 1 to ${MAX_LIST_RESULTS}.`);
  return value;
}

function boundedPageToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length > MAX_PAGE_TOKEN_LENGTH) throw new Error('Gmail page token is too long.');
  return normalized || undefined;
}

function boundedQuery(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length > MAX_QUERY_LENGTH) throw new Error('Gmail search query is too long.');
  return normalized || undefined;
}

export class GoogleGmailService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listMessages(query?: string, pageToken?: string, maxResults?: number, includeSpamTrash?: boolean): Promise<GmailListResponse> {
    const access = await this.oauth.authorize('gmail.read');
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    const safeQuery = boundedQuery(query);
    const safePageToken = boundedPageToken(pageToken);
    const safeMaxResults = boundedListSize(maxResults);
    if (safeQuery) url.searchParams.set('q', safeQuery);
    if (safePageToken) url.searchParams.set('pageToken', safePageToken);
    if (safeMaxResults !== undefined) url.searchParams.set('maxResults', String(safeMaxResults));
    if (includeSpamTrash !== undefined) url.searchParams.set('includeSpamTrash', String(includeSpamTrash));
    const response = await access.fetch(url);
    return this.readJson<GmailListResponse>(response);
  }

  async getMessage(messageId: string, format: 'minimal' | 'full' | 'raw' | 'metadata' = 'full', metadataHeaders?: readonly string[]): Promise<unknown> {
    const access = await this.oauth.authorize('gmail.read');
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}`);
    url.searchParams.set('format', format);
    for (const header of metadataHeaders ?? []) url.searchParams.append('metadataHeaders', header);
    const response = await access.fetch(url);
    return this.readJson(response);
  }

  async listThreads(query?: string, pageToken?: string, maxResults?: number, includeSpamTrash?: boolean): Promise<GmailListResponse> {
    const access = await this.oauth.authorize('gmail.read');
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/threads');
    const safeQuery = boundedQuery(query);
    const safePageToken = boundedPageToken(pageToken);
    const safeMaxResults = boundedListSize(maxResults);
    if (safeQuery) url.searchParams.set('q', safeQuery);
    if (safePageToken) url.searchParams.set('pageToken', safePageToken);
    if (safeMaxResults !== undefined) url.searchParams.set('maxResults', String(safeMaxResults));
    if (includeSpamTrash !== undefined) url.searchParams.set('includeSpamTrash', String(includeSpamTrash));
    const response = await access.fetch(url);
    return this.readJson<GmailListResponse>(response);
  }

  async getThread(threadId: string, format: 'minimal' | 'full' | 'metadata' = 'full', metadataHeaders?: readonly string[]): Promise<unknown> {
    const access = await this.oauth.authorize('gmail.read');
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`);
    url.searchParams.set('format', format);
    for (const header of metadataHeaders ?? []) url.searchParams.append('metadataHeaders', header);
    const response = await access.fetch(url);
    return this.readJson(response);
  }

  async modifyMessage(messageId: string, addLabelIds: readonly string[] = [], removeLabelIds: readonly string[] = []): Promise<unknown> {
    const access = await this.oauth.authorize('gmail.modify');
    return this.sendJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/modify`, {
      addLabelIds, removeLabelIds,
    }, 'POST', access);
  }

  async modifyThread(threadId: string, addLabelIds: readonly string[] = [], removeLabelIds: readonly string[] = []): Promise<unknown> {
    const access = await this.oauth.authorize('gmail.modify');
    return this.sendJson(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}/modify`, {
      addLabelIds, removeLabelIds,
    }, 'POST', access);
  }

  async trashMessage(messageId: string): Promise<unknown> { return this.postWrite('gmail.modify', `messages/${encodeURIComponent(messageId)}/trash`); }
  async untrashMessage(messageId: string): Promise<unknown> { return this.postWrite('gmail.modify', `messages/${encodeURIComponent(messageId)}/untrash`); }
  async trashThread(threadId: string): Promise<unknown> { return this.postWrite('gmail.modify', `threads/${encodeURIComponent(threadId)}/trash`); }
  async untrashThread(threadId: string): Promise<unknown> { return this.postWrite('gmail.modify', `threads/${encodeURIComponent(threadId)}/untrash`); }

  async listLabels(): Promise<unknown> {
    const access = await this.oauth.authorize('gmail.read');
    return this.readJson(await access.fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels'));
  }

  async getLabel(labelId: string): Promise<unknown> {
    const access = await this.oauth.authorize('gmail.read');
    return this.readJson(await access.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`));
  }

  async createLabel(label: Record<string, unknown>): Promise<unknown> {
    return this.sendJson('https://gmail.googleapis.com/gmail/v1/users/me/labels', label, 'POST', await this.oauth.authorize('gmail.labels'));
  }

  async updateLabel(labelId: string, label: Record<string, unknown>): Promise<unknown> {
    return this.sendJson(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`, label, 'PUT', await this.oauth.authorize('gmail.labels'));
  }

  async deleteLabel(labelId: string): Promise<void> {
    const access = await this.oauth.authorize('gmail.labels');
    const response = await access.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Gmail request failed (${response.status}).`);
  }

  async sendMessage(rawRfc822: string): Promise<unknown> {
    const encoded = rawRfc822ToBase64Url(rawRfc822);
    if (new TextEncoder().encode(rawRfc822).byteLength > MAX_RAW_MESSAGE_BYTES) throw new Error('Gmail message exceeds the application size limit.');
    return this.sendJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: encoded }, 'POST', await this.oauth.authorize('gmail.send'));
  }

  private async postWrite(capability: 'gmail.modify', path: string): Promise<unknown> {
    const access = await this.oauth.authorize(capability);
    return this.sendJson(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, undefined, 'POST', access);
  }

  private async sendJson(url: string, body: unknown, method: 'POST' | 'PUT', access: Awaited<ReturnType<GoogleOAuthAuthority['authorize']>>): Promise<unknown> {
    const response = await access.fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return this.readJson(response);
  }

  private async readJson<T = unknown>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(`Gmail request failed (${response.status}).`);
    return (await response.json()) as T;
  }
}

function rawRfc822ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
