import type { GoogleOAuthAuthority } from '../oauth/contracts';
import type { GmailOrganizeAction } from '../tools/gmail-schemas';

export type GmailTrust = 'untrusted-external';
export type GmailReadFormat = 'minimal' | 'full' | 'metadata';

export interface GmailMessageView {
  readonly trust: GmailTrust;
  readonly source: 'gmail';
  readonly id: string;
  readonly threadId?: string;
  readonly historyId?: string;
  readonly internalDate?: string;
  readonly labelIds: readonly string[];
  readonly snippet?: string;
  readonly headers: Readonly<{
    from?: string;
    to?: string;
    cc?: string;
    date?: string;
    subject?: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string;
  }>;
  readonly bodyText?: string;
  readonly bodyTruncated?: boolean;
}

export interface GmailThreadView {
  readonly trust: GmailTrust;
  readonly source: 'gmail';
  readonly id: string;
  readonly historyId?: string;
  readonly messages: readonly GmailMessageView[];
  readonly messageCount: number;
  readonly messagesTruncated: boolean;
}

export interface GmailLabelView {
  readonly trust: GmailTrust;
  readonly source: 'gmail';
  readonly id: string;
  readonly name: string;
  readonly type: 'system' | 'user' | 'unknown';
  readonly messagesTotal?: number;
  readonly messagesUnread?: number;
  readonly threadsTotal?: number;
  readonly threadsUnread?: number;
}

interface ProviderHeader { readonly name?: unknown; readonly value?: unknown }
interface ProviderBody { readonly data?: unknown; readonly size?: unknown; readonly attachmentId?: unknown }
interface ProviderPart {
  readonly mimeType?: unknown;
  readonly filename?: unknown;
  readonly headers?: unknown;
  readonly body?: ProviderBody;
  readonly parts?: unknown;
}
interface ProviderMessage extends ProviderPart {
  readonly id?: unknown;
  readonly threadId?: unknown;
  readonly historyId?: unknown;
  readonly internalDate?: unknown;
  readonly labelIds?: unknown;
  readonly snippet?: unknown;
  readonly payload?: ProviderPart;
}
interface ProviderThread {
  readonly id?: unknown;
  readonly historyId?: unknown;
  readonly messages?: unknown;
}
interface ProviderLabel {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly type?: unknown;
  readonly messagesTotal?: unknown;
  readonly messagesUnread?: unknown;
  readonly threadsTotal?: unknown;
  readonly threadsUnread?: unknown;
}

const MAX_LIST_RESULTS = 100;
const MAX_QUERY_LENGTH = 2_000;
const MAX_PAGE_TOKEN_LENGTH = 5_000;
const MAX_ID_LENGTH = 500;
const MAX_HEADER_LENGTH = 4_000;
const MAX_SNIPPET_LENGTH = 2_000;
const MAX_BODY_TEXT_CHARS = 100_000;
const MAX_THREAD_MESSAGES = 20;
const MAX_THREAD_BODY_CHARS = 150_000;
const MAX_RAW_MESSAGE_BYTES = 8 * 1024 * 1024;
const EMAIL_PATTERN = /^[^\s@<>\r\n]+@[^\s@<>\r\n]+\.[^\s@<>\r\n]+$/;
const MESSAGE_ID_PATTERN = /^<[^<>\r\n]+>$/;

function requiredId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_ID_LENGTH) throw new Error(`${label} is invalid.`);
  return normalized;
}
function boundedQuery(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length > MAX_QUERY_LENGTH) throw new Error('Gmail search query is too long.');
  return normalized || undefined;
}
function boundedPageToken(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_PAGE_TOKEN_LENGTH) throw new Error('Gmail page token is invalid.');
  return normalized;
}
function boundedListSize(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1 || value > MAX_LIST_RESULTS) throw new Error(`Gmail maxResults must be an integer from 1 to ${MAX_LIST_RESULTS}.`);
  return value;
}
function boundedHeader(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.split('\0').join('').trim();
  if (!normalized) return undefined;
  return normalized.slice(0, MAX_HEADER_LENGTH);
}
function boundedString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.slice(0, max);
}
function boundedCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined;
}
function stringArray(value: unknown, max = 100): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string').slice(0, max).map((item) => item.slice(0, MAX_ID_LENGTH));
}
function headerMap(headers: unknown): Map<string, string> {
  const result = new Map<string, string>();
  if (!Array.isArray(headers)) return result;
  for (const entry of headers.slice(0, 100)) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, value } = entry as ProviderHeader;
    if (typeof name !== 'string') continue;
    const safe = boundedHeader(value);
    if (safe !== undefined) result.set(name.toLowerCase(), safe);
  }
  return result;
}
function decodeBase64Url(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return undefined;
  }
}
function plainTextParts(part: ProviderPart | undefined, sink: string[]): void {
  if (!part || sink.join('\n').length >= MAX_BODY_TEXT_CHARS) return;
  const mimeType = typeof part.mimeType === 'string' ? part.mimeType.toLowerCase() : '';
  const data = decodeBase64Url(part.body?.data);
  if ((mimeType === 'text/plain' || (!mimeType && data)) && data) sink.push(data);
  if (!Array.isArray(part.parts)) return;
  for (const child of part.parts.slice(0, 100)) {
    if (child && typeof child === 'object') plainTextParts(child as ProviderPart, sink);
    if (sink.join('\n').length >= MAX_BODY_TEXT_CHARS) break;
  }
}
function normalizeMessage(resource: ProviderMessage, includeBody: boolean): GmailMessageView {
  const id = requiredId(typeof resource.id === 'string' ? resource.id : '', 'Gmail message id');
  const headers = headerMap(resource.payload?.headers);
  const chunks: string[] = [];
  if (includeBody) plainTextParts(resource.payload, chunks);
  const joined = chunks.join('\n').split('\0').join('');
  const bodyText = joined ? joined.slice(0, MAX_BODY_TEXT_CHARS) : undefined;
  return {
    trust: 'untrusted-external',
    source: 'gmail',
    id,
    ...(typeof resource.threadId === 'string' && resource.threadId.trim() ? { threadId: resource.threadId.slice(0, MAX_ID_LENGTH) } : {}),
    ...(typeof resource.historyId === 'string' ? { historyId: resource.historyId.slice(0, 128) } : {}),
    ...(typeof resource.internalDate === 'string' ? { internalDate: resource.internalDate.slice(0, 64) } : {}),
    labelIds: stringArray(resource.labelIds),
    ...(boundedString(resource.snippet, MAX_SNIPPET_LENGTH) ? { snippet: boundedString(resource.snippet, MAX_SNIPPET_LENGTH) } : {}),
    headers: Object.freeze({
      ...(headers.get('from') ? { from: headers.get('from') } : {}),
      ...(headers.get('to') ? { to: headers.get('to') } : {}),
      ...(headers.get('cc') ? { cc: headers.get('cc') } : {}),
      ...(headers.get('date') ? { date: headers.get('date') } : {}),
      ...(headers.get('subject') ? { subject: headers.get('subject') } : {}),
      ...(headers.get('message-id') ? { messageId: headers.get('message-id') } : {}),
      ...(headers.get('in-reply-to') ? { inReplyTo: headers.get('in-reply-to') } : {}),
      ...(headers.get('references') ? { references: headers.get('references') } : {}),
    }),
    ...(bodyText !== undefined ? { bodyText, bodyTruncated: joined.length > MAX_BODY_TEXT_CHARS } : {}),
  };
}
function normalizeLabel(resource: ProviderLabel): GmailLabelView {
  const id = requiredId(typeof resource.id === 'string' ? resource.id : '', 'Gmail label id');
  const name = boundedString(resource.name, 500)?.trim();
  if (!name) throw new Error('Gmail label response is missing a name.');
  const providerType = typeof resource.type === 'string' ? resource.type.toUpperCase() : '';
  return {
    trust: 'untrusted-external', source: 'gmail', id, name,
    type: providerType === 'USER' ? 'user' : providerType === 'SYSTEM' ? 'system' : 'unknown',
    ...(boundedCount(resource.messagesTotal) !== undefined ? { messagesTotal: boundedCount(resource.messagesTotal) } : {}),
    ...(boundedCount(resource.messagesUnread) !== undefined ? { messagesUnread: boundedCount(resource.messagesUnread) } : {}),
    ...(boundedCount(resource.threadsTotal) !== undefined ? { threadsTotal: boundedCount(resource.threadsTotal) } : {}),
    ...(boundedCount(resource.threadsUnread) !== undefined ? { threadsUnread: boundedCount(resource.threadsUnread) } : {}),
  };
}
function validateAddress(value: string): string {
  const normalized = value.trim();
  if (normalized.length > 320 || !EMAIL_PATTERN.test(normalized)) throw new Error('Gmail recipient address is invalid.');
  return normalized;
}
function validateRecipients(values: readonly string[] | undefined, required: boolean): string[] {
  if (!values) {
    if (required) throw new Error('Gmail send requires at least one recipient.');
    return [];
  }
  if ((required && values.length < 1) || values.length > 25) throw new Error('Gmail recipient list is outside the application bound.');
  return values.map(validateAddress);
}
function validateSubject(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 500 || /[\r\n]/.test(normalized)) throw new Error('Gmail subject is invalid.');
  return normalized;
}
function validateBody(value: string): string {
  if (!value || value.length > 200_000) throw new Error('Gmail body is outside the application bound.');
  return value;
}
function validateMessageId(value: string): string {
  const normalized = value.trim();
  if (normalized.length > 1_000 || !MESSAGE_ID_PATTERN.test(normalized)) throw new Error('Gmail reply Message-ID is invalid.');
  return normalized;
}
function rawRfc822ToBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function composeRaw(headers: readonly string[], body: string): string {
  const raw = `${headers.join('\r\n')}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: 8bit\r\n\r\n${body}`;
  if (new TextEncoder().encode(raw).byteLength > MAX_RAW_MESSAGE_BYTES) throw new Error('Gmail message exceeds the application size limit.');
  return raw;
}
function actionLabels(action: GmailOrganizeAction, labelId?: string): { addLabelIds: string[]; removeLabelIds: string[] } {
  switch (action) {
    case 'archive': return { addLabelIds: [], removeLabelIds: ['INBOX'] };
    case 'moveToInbox': return { addLabelIds: ['INBOX'], removeLabelIds: [] };
    case 'markRead': return { addLabelIds: [], removeLabelIds: ['UNREAD'] };
    case 'markUnread': return { addLabelIds: ['UNREAD'], removeLabelIds: [] };
    case 'markSpam': return { addLabelIds: ['SPAM'], removeLabelIds: [] };
    case 'markNotSpam': return { addLabelIds: [], removeLabelIds: ['SPAM'] };
    case 'star': return { addLabelIds: ['STARRED'], removeLabelIds: [] };
    case 'unstar': return { addLabelIds: [], removeLabelIds: ['STARRED'] };
    case 'applyLabel': return { addLabelIds: [requiredId(labelId ?? '', 'Gmail user label id')], removeLabelIds: [] };
    case 'removeLabel': return { addLabelIds: [], removeLabelIds: [requiredId(labelId ?? '', 'Gmail user label id')] };
  }
}

export class GoogleGmailSemanticService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async listMessages(query?: string, pageToken?: string, maxResults?: number, includeSpamTrash?: boolean): Promise<unknown> {
    const safeQuery = boundedQuery(query); const safePageToken = boundedPageToken(pageToken); const safeMax = boundedListSize(maxResults);
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    if (safeQuery) url.searchParams.set('q', safeQuery); if (safePageToken) url.searchParams.set('pageToken', safePageToken); if (safeMax) url.searchParams.set('maxResults', String(safeMax)); if (includeSpamTrash !== undefined) url.searchParams.set('includeSpamTrash', String(includeSpamTrash));
    const access = await this.oauth.authorize('gmail.read');
    const data = await this.readJson<Record<string, unknown>>(await access.fetch(url));
    const messages = Array.isArray(data.messages) ? data.messages.slice(0, MAX_LIST_RESULTS).flatMap((item) => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' ? [{ id: requiredId((item as { id: string }).id, 'Gmail message id'), ...(typeof (item as { threadId?: unknown }).threadId === 'string' ? { threadId: String((item as { threadId: string }).threadId).slice(0, MAX_ID_LENGTH) } : {}) }] : []) : [];
    return { trust: 'untrusted-external', source: 'gmail', messages, ...(typeof data.nextPageToken === 'string' ? { nextPageToken: data.nextPageToken.slice(0, MAX_PAGE_TOKEN_LENGTH) } : {}), ...(boundedCount(data.resultSizeEstimate) !== undefined ? { resultSizeEstimate: boundedCount(data.resultSizeEstimate) } : {}) };
  }

  async getMessage(messageId: string, format: GmailReadFormat = 'full', metadataHeaders?: readonly string[]): Promise<GmailMessageView> {
    const id = requiredId(messageId, 'Gmail message id');
    const safeFormat: GmailReadFormat = format === 'minimal' || format === 'metadata' ? format : 'full';
    const safeHeaders = (metadataHeaders ?? []).map((header) => header.trim()).filter(Boolean).slice(0, 50);
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}`); url.searchParams.set('format', safeFormat);
    for (const header of safeHeaders) if (header.length <= 200) url.searchParams.append('metadataHeaders', header);
    const access = await this.oauth.authorize('gmail.read');
    const data = await this.readJson<ProviderMessage>(await access.fetch(url));
    return normalizeMessage(data, safeFormat === 'full');
  }

  async listThreads(query?: string, pageToken?: string, maxResults?: number, includeSpamTrash?: boolean): Promise<unknown> {
    const safeQuery = boundedQuery(query); const safePageToken = boundedPageToken(pageToken); const safeMax = boundedListSize(maxResults);
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/threads');
    if (safeQuery) url.searchParams.set('q', safeQuery); if (safePageToken) url.searchParams.set('pageToken', safePageToken); if (safeMax) url.searchParams.set('maxResults', String(safeMax)); if (includeSpamTrash !== undefined) url.searchParams.set('includeSpamTrash', String(includeSpamTrash));
    const access = await this.oauth.authorize('gmail.read'); const data = await this.readJson<Record<string, unknown>>(await access.fetch(url));
    const threads = Array.isArray(data.threads) ? data.threads.slice(0, MAX_LIST_RESULTS).flatMap((item) => item && typeof item === 'object' && typeof (item as { id?: unknown }).id === 'string' ? [{ id: requiredId((item as { id: string }).id, 'Gmail thread id'), ...(typeof (item as { historyId?: unknown }).historyId === 'string' ? { historyId: String((item as { historyId: string }).historyId).slice(0, 128) } : {}) }] : []) : [];
    return { trust: 'untrusted-external', source: 'gmail', threads, ...(typeof data.nextPageToken === 'string' ? { nextPageToken: data.nextPageToken.slice(0, MAX_PAGE_TOKEN_LENGTH) } : {}), ...(boundedCount(data.resultSizeEstimate) !== undefined ? { resultSizeEstimate: boundedCount(data.resultSizeEstimate) } : {}) };
  }

  async getThread(threadId: string, format: GmailReadFormat = 'full', metadataHeaders?: readonly string[]): Promise<GmailThreadView> {
    const id = requiredId(threadId, 'Gmail thread id'); const safeFormat: GmailReadFormat = format === 'minimal' || format === 'metadata' ? format : 'full';
    const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(id)}`); url.searchParams.set('format', safeFormat);
    for (const header of (metadataHeaders ?? []).slice(0, 50)) if (header.trim() && header.length <= 200) url.searchParams.append('metadataHeaders', header.trim());
    const access = await this.oauth.authorize('gmail.read'); const data = await this.readJson<ProviderThread>(await access.fetch(url));
    const all = Array.isArray(data.messages) ? data.messages.filter((item): item is ProviderMessage => Boolean(item) && typeof item === 'object') : [];
    const selected = all.slice(Math.max(0, all.length - MAX_THREAD_MESSAGES)); let remainingBody = MAX_THREAD_BODY_CHARS;
    const messages = selected.map((item) => { const normalized = normalizeMessage(item, safeFormat === 'full'); if (!normalized.bodyText) return normalized; const text = normalized.bodyText.slice(0, remainingBody); remainingBody -= text.length; return { ...normalized, bodyText: text, bodyTruncated: normalized.bodyTruncated || text.length < normalized.bodyText.length }; });
    return { trust: 'untrusted-external', source: 'gmail', id, ...(typeof data.historyId === 'string' ? { historyId: data.historyId.slice(0, 128) } : {}), messages, messageCount: all.length, messagesTruncated: all.length > messages.length || remainingBody <= 0 };
  }

  async listLabels(): Promise<readonly GmailLabelView[]> {
    const access = await this.oauth.authorize('gmail.read'); const data = await this.readJson<{ labels?: unknown }>(await access.fetch('https://gmail.googleapis.com/gmail/v1/users/me/labels'));
    return Array.isArray(data.labels) ? data.labels.slice(0, 500).flatMap((item) => { try { return item && typeof item === 'object' ? [normalizeLabel(item as ProviderLabel)] : []; } catch { return []; } }) : [];
  }
  async getLabel(labelId: string): Promise<GmailLabelView> { const id = requiredId(labelId, 'Gmail label id'); const access = await this.oauth.authorize('gmail.read'); return normalizeLabel(await this.readJson<ProviderLabel>(await access.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(id)}`))); }

  async organizeMessage(messageId: string, action: GmailOrganizeAction, labelId?: string): Promise<unknown> { return this.organize('messages', requiredId(messageId, 'Gmail message id'), action, labelId); }
  async organizeThread(threadId: string, action: GmailOrganizeAction, labelId?: string): Promise<unknown> { return this.organize('threads', requiredId(threadId, 'Gmail thread id'), action, labelId); }
  async trashMessage(messageId: string): Promise<unknown> { return this.postWrite(`messages/${encodeURIComponent(requiredId(messageId, 'Gmail message id'))}/trash`); }
  async untrashMessage(messageId: string): Promise<unknown> { return this.postWrite(`messages/${encodeURIComponent(requiredId(messageId, 'Gmail message id'))}/untrash`); }
  async trashThread(threadId: string): Promise<unknown> { return this.postWrite(`threads/${encodeURIComponent(requiredId(threadId, 'Gmail thread id'))}/trash`); }
  async untrashThread(threadId: string): Promise<unknown> { return this.postWrite(`threads/${encodeURIComponent(requiredId(threadId, 'Gmail thread id'))}/untrash`); }

  async createLabel(name: string): Promise<GmailLabelView> { const safeName = this.labelName(name); const access = await this.oauth.authorize('gmail.labels'); return normalizeLabel(await this.sendJson<ProviderLabel>('https://gmail.googleapis.com/gmail/v1/users/me/labels', { name: safeName }, 'POST', access)); }
  async updateLabel(labelId: string, name: string): Promise<GmailLabelView> { const id = requiredId(labelId, 'Gmail label id'); const safeName = this.labelName(name); const access = await this.oauth.authorize('gmail.labels'); await this.requireUserLabel(id, access); return normalizeLabel(await this.sendJson<ProviderLabel>(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(id)}`, { name: safeName }, 'PATCH', access)); }
  async deleteLabel(labelId: string): Promise<void> { const id = requiredId(labelId, 'Gmail label id'); const access = await this.oauth.authorize('gmail.labels'); await this.requireUserLabel(id, access); const response = await access.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(id)}`, { method: 'DELETE' }); if (!response.ok) throw new Error(`Gmail request failed (${response.status}).`); }

  async sendMessage(input: { readonly to: readonly string[]; readonly cc?: readonly string[]; readonly subject: string; readonly body: string }): Promise<unknown> {
    const to = validateRecipients(input.to, true); const cc = validateRecipients(input.cc, false); if (to.length + cc.length > 50) throw new Error('Gmail send exceeds the 50-recipient application limit.'); const subject = validateSubject(input.subject); const body = validateBody(input.body);
    const raw = composeRaw([`To: ${to.join(', ')}`, ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []), `Subject: ${subject}`], body);
    return this.sendEncoded(raw);
  }
  async replyMessage(input: { readonly threadId: string; readonly to: string; readonly subject: string; readonly body: string; readonly inReplyTo: string; readonly references?: readonly string[] }): Promise<unknown> {
    const threadId = requiredId(input.threadId, 'Gmail thread id'); const to = validateAddress(input.to); const subject = validateSubject(input.subject); const body = validateBody(input.body); const inReplyTo = validateMessageId(input.inReplyTo); const prior = (input.references ?? []).slice(0, 20).map(validateMessageId); const references = [...new Set([...prior, inReplyTo])];
    const raw = composeRaw([`To: ${to}`, `Subject: ${subject}`, `In-Reply-To: ${inReplyTo}`, `References: ${references.join(' ')}`], body);
    const access = await this.oauth.authorize('gmail.send'); return this.sendJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: rawRfc822ToBase64Url(raw), threadId }, 'POST', access);
  }

  private async organize(kind: 'messages' | 'threads', id: string, action: GmailOrganizeAction, labelId?: string): Promise<unknown> {
    const access = await this.oauth.authorize('gmail.modify'); if ((action === 'applyLabel' || action === 'removeLabel') && labelId) await this.requireUserLabel(requiredId(labelId, 'Gmail user label id'), access); const labels = actionLabels(action, labelId); return this.sendJson(`https://gmail.googleapis.com/gmail/v1/users/me/${kind}/${encodeURIComponent(id)}/modify`, labels, 'POST', access);
  }
  private async requireUserLabel(id: string, access: Awaited<ReturnType<GoogleOAuthAuthority['authorize']>>): Promise<void> { const label = normalizeLabel(await this.readJson<ProviderLabel>(await access.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(id)}`))); if (label.type !== 'user') throw new Error('Gmail custom-label operations require a USER label id.'); }
  private async postWrite(path: string): Promise<unknown> { const access = await this.oauth.authorize('gmail.modify'); return this.sendJson(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, undefined, 'POST', access); }
  private async sendEncoded(raw: string): Promise<unknown> { const access = await this.oauth.authorize('gmail.send'); return this.sendJson('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: rawRfc822ToBase64Url(raw) }, 'POST', access); }
  private labelName(name: string): string { const normalized = name.trim(); if (!normalized || normalized.length > 500 || /[\r\n]/.test(normalized) || normalized.includes('\0')) throw new Error('Gmail label name is invalid.'); return normalized; }
  private async sendJson<T = unknown>(url: string, body: unknown, method: 'POST' | 'PATCH', access: Awaited<ReturnType<GoogleOAuthAuthority['authorize']>>): Promise<T> { const response = await access.fetch(url, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }); return this.readJson<T>(response); }
  private async readJson<T>(response: Response): Promise<T> { if (!response.ok) throw new Error(`Gmail request failed (${response.status}).`); return (await response.json()) as T; }
}
