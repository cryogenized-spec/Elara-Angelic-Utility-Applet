import type { GoogleOAuthAuthority } from '../oauth/contracts';

export interface GoogleChatMessageSummary { name: string; text?: string; createTime?: string; senderName?: string; }

export class GoogleChatService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listMessages(spaceName: string, pageSize?: number, pageToken?: string, filter?: string): Promise<unknown> {
    const access = await this.oauth.authorize('chat.read');
    const url = new URL('https://chat.googleapis.com/v1/messages');
    url.searchParams.set('parent', spaceName);
    if (pageSize !== undefined) url.searchParams.set('pageSize', String(pageSize));
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    if (filter) url.searchParams.set('filter', filter);
    const response = await access.fetch(url);
    return this.readJson(response);
  }

  async getMessage(messageName: string): Promise<unknown> {
    const access = await this.oauth.authorize('chat.read');
    const response = await access.fetch(`https://chat.googleapis.com/v1/${messageName}`);
    return this.readJson(response);
  }

  async createMessage(spaceName: string, message: Record<string, unknown>, requestId?: string): Promise<unknown> {
    const access = await this.oauth.authorize('chat.write');
    const url = new URL('https://chat.googleapis.com/v1/messages');
    url.searchParams.set('parent', spaceName);
    if (requestId) url.searchParams.set('requestId', requestId);
    const response = await access.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) });
    return this.readJson(response);
  }

  async updateMessage(messageName: string, message: Record<string, unknown>, updateMask: string): Promise<unknown> {
    const access = await this.oauth.authorize('chat.write');
    const url = new URL(`https://chat.googleapis.com/v1/${messageName}`);
    url.searchParams.set('updateMask', updateMask);
    const response = await access.fetch(url, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(message) });
    return this.readJson(response);
  }

  async deleteMessage(messageName: string): Promise<void> {
    const access = await this.oauth.authorize('chat.write');
    const response = await access.fetch(`https://chat.googleapis.com/v1/${messageName}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Google Chat request failed (${response.status}).`);
  }

  private async readJson<T = unknown>(response: Response): Promise<T> {
    if (!response.ok) throw new Error(`Google Chat request failed (${response.status}).`);
    return (await response.json()) as T;
  }
}
