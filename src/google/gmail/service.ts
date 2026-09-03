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

export class GoogleGmailService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listMessages(query?: string, pageToken?: string, maxResults?: number, includeSpamTrash?: boolean): Promise<GmailListResponse> {
    const access = await this.oauth.authorize('gmail.read');
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    if (query) url.searchParams.set('q', query);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    if (maxResults !== undefined) url.searchParams.set('maxResults', String(maxResults));
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
    if (query) url.searchParams.set('q', query);
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    if (maxResults !== undefined) url.searchParams.set('maxResults', String(maxResults));
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

  async trashMessage(messageId: string): Promise<unknown> {
    return this.postWrite('gmail.modify', `messages/${encodeURIComponent(messageId)}/trash`);
  }

  async untrashMessage(messageId: string): Promise<unknown> {
    return this.postWrite('gmail.modify', `messages/${encodeURIComponent(messageId)}/untrash`);
  }

  async trashThread(threadId: string): Promise<unknown> {
    return this.postWrite('gmail.modify', `threads/${encodeURIComponent(threadId)}/trash`);
  }

  async untrashThread(threadId: string): Promise<unknown> {
    return this.postWrite('gmail.modify', `threads/${encodeURIComponent(threadId)}/untrash`);
  }

  async listLabels(): Promise<unknown> {
    const access = await this.oauth.authorize('gmail.read');
    const response = await access.fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels');
    return this.readJson(response);
  }

  async getLabel(labelId: string): Promise<unknown> {
    const access = await this.oauth.authorize('gmail.read');
    const response = await access.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`);
    return this.readJson(response);
  }

  async createLabel(label: Record<string, unknown>): Promise<unknown> {
    return this.sendJson('https://gmail.googleapis.com/gmail/v1/users/me/labels', label, 'POST', await this.oauth.authorize('gmail.modify'));
  }

  async updateLabel(labelId: string, label: Record<string, unknown>): Promise<unknown> {
    return this.sendJson(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`, label, 'PUT', await this.oauth.authorize('gmail.modify'));
  }

  async deleteLabel(labelId: string): Promise<void> {
    const access = await this.oauth.authorize('gmail.modify');
    const response = await access.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(labelId)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Gmail request failed (${response.status}).`);
  }

  async sendMessage(rawRfc822: string): Promise<unknown> {
    return this.sendJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: rawRfc822822ToBase64Url(rawRfc822) }, 'POST', await this.oauth.authorize('gmail.send'));
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

function rawRfc822822ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
