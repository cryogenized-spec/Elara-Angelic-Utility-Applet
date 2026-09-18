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

export interface GmailMutationAck {
  readonly changed: true;
  readonly target: 'message' | 'thread';
  readonly id: string;
  readonly action: GmailOrganizeAction | 'trash' | 'untrash';
}

export interface GmailSendAck {
  readonly sent: true;
  readonly threadId?: string;
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
const MAX_BODY_BASE64_CHARS = 600_000;
const MAX_MIME_DEPTH = 20;
const MAX_MIME_PARTS = 500;
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
interface MimeWalkState {
  parts: number;
  chars: number;
  truncated: boolean;
}

function decodeBase64Url(value: unknown): { text?: string; truncated: boolean } {
  if (typeof value !== 'string' || !value) return { truncated: false };
  const clipped = value.length > MAX_BODY_BASE64_CHARS;
  const source = clipped ? value.slice(0, MAX_BODY_BASE64_CHARS - (MAX_BODY_BASE64_CHARS % 4)) : value;
  try {
    const normalized = source.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return { text: new TextDecoder('utf-8', { fatal: false }).decode(bytes), truncated: clipped };
  } catch {
    return { truncated: clipped };
  }
}
function plainTextParts(part: ProviderPart | undefined, sink: string[], state: MimeWalkState, depth = 0): void {
  if (!part || state.chars >= MAX_BODY_TEXT_CHARS) return;
  if (depth > MAX_MIME_DEPTH || state.parts >= MAX_MIME_PARTS) {
    state.truncated = true;
    return;
  }
  state.parts += 1;

  const filename = typeof part.filename === 'string' ? part.filename.trim() : '';
  const attachmentId = typeof part.body?.attachmentId === 'string' ? part.body.attachmentId.trim() : '';
  if (filename || attachmentId) return;

  const mimeType = typeof part.mimeType === 'string' ? part.mimeType.toLowerCase().split(';', 1)[0].trim() : '';
  if (mimeType === 'text/plain') {
    const decoded = decodeBase64Url(part.body?.data);
    if (decoded.truncated) state.truncated = true;
    if (decoded.text) {
      const separator = sink.length ? 1 : 0;
      const remaining = Math.max(0, MAX_BODY_TEXT_CHARS - state.chars - separator);
      const text = decoded.text.slice(0, remaining);
      if (text) {
        sink.push(text);
        state.chars += separator + text.length;
      }
      if (text.length < decoded.text.length) state.truncated = true;
    }
  }

  if (!Array.isArray(part.parts) || state.chars >= MAX_BODY_TEXT_CHARS) return;
  for (const child of part.parts.slice(0, 100)) {
    if (child && typeof child === 'object') plainTextParts(child as ProviderPart, sink, state, depth + 1);
    if (state.truncated && (state.parts >= MAX_MIME_PARTS || depth >= MAX_MIME_DEPTH)) break;
    if (state.chars >= MAX_BODY_TEXT_CHARS) break;
  }
  if (part.parts.length > 100) state.truncated = true;
}
function normalizeMessage(resource: ProviderMessage, includeBody: boolean): GmailMessageView {
  const id = requiredId(typeof resource.id === 'string' ? resource.id : '', 'Gmail message id');
  const headers = headerMap(resource.payload?.headers);
  const chunks: string[] = [];
  const mimeState: MimeWalkState = { parts: 0, chars: 0, truncated: false };
  if (includeBody) plainTextParts(resource.payload, chunks, mimeState);
  const joined = chunks.join('\n').split('\0').join('');
  const bodyText = joined || undefined;
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
    ...(bodyText !== undefined ? { bodyText, bodyTruncated: mimeState.truncated } : mimeState.truncated ? { bodyTruncated: true } : {}),
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
function parseReferenceIds(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(/\s+/).filter((item) => MESSAGE_ID_PATTERN.test(item)).slice(-20);
}
function replySubjectKey(value: string): string {
  return value.trim().replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '').trim().toLocaleLowerCase();
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

export interface GmailTurnGuard {
  readonly signal?: AbortSignal;
  readonly isGenerationActive?: () => boolean;
}

function assertTurnActive(guard: GmailTurnGuard | undefined): void {
  if (guard?.signal?.aborted || guard?.isGenerationActive?.() === false) {
    throw new DOMException('The Gmail operation lost turn authority.', 'AbortError');
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

  async organizeMessage(messageId: string, action: GmailOrganizeAction, labelId?: string, guard?: GmailTurnGuard): Promise<GmailMutationAck> {
    assertTurnActive(guard);
    return this.organize('messages', requiredId(messageId, 'Gmail message id'), action, labelId, guard);
  }
  async organizeThread(threadId: string, action: GmailOrganizeAction, labelId?: string, guard?: GmailTurnGuard): Promise<GmailMutationAck> {
    assertTurnActive(guard);
    return this.organize('threads', requiredId(threadId, 'Gmail thread id'), action, labelId, guard);
  }
  async trashMessage(messageId: string, guard?: GmailTurnGuard): Promise<GmailMutationAck> {
    assertTurnActive(guard);
    const id = requiredId(messageId, 'Gmail message id');
    await this.postWrite(`messages/${encodeURIComponent(id)}/trash`, guard);
    return { changed: true, target: 'message', id, action: 'trash' };
  }
  async untrashMessage(messageId: string, guard?: GmailTurnGuard): Promise<GmailMutationAck> {
    assertTurnActive(guard);
    const id = requiredId(messageId, 'Gmail message id');
    await this.postWrite(`messages/${encodeURIComponent(id)}/untrash`, guard);
    return { changed: true, target: 'message', id, action: 'untrash' };
  }
  async trashThread(threadId: string, guard?: GmailTurnGuard): Promise<GmailMutationAck> {
    assertTurnActive(guard);
    const id = requiredId(threadId, 'Gmail thread id');
    await this.postWrite(`threads/${encodeURIComponent(id)}/trash`, guard);
    return { changed: true, target: 'thread', id, action: 'trash' };
  }
  async untrashThread(threadId: string, guard?: GmailTurnGuard): Promise<GmailMutationAck> {
    assertTurnActive(guard);
    const id = requiredId(threadId, 'Gmail thread id');
    await this.postWrite(`threads/${encodeURIComponent(id)}/untrash`, guard);
    return { changed: true, target: 'thread', id, action: 'untrash' };
  }

  async createLabel(name: string, guard?: GmailTurnGuard): Promise<GmailLabelView> {
    assertTurnActive(guard);
    const safeName = this.labelName(name);
    const access = await this.oauth.authorize('gmail.labels');
    assertTurnActive(guard);
    return normalizeLabel(await this.sendJson<ProviderLabel>('https://gmail.googleapis.com/gmail/v1/users/me/labels', { name: safeName }, 'POST', access, guard));
  }
  async updateLabel(labelId: string, name: string, guard?: GmailTurnGuard): Promise<GmailLabelView> {
    assertTurnActive(guard);
    const id = requiredId(labelId, 'Gmail label id');
    const safeName = this.labelName(name);
    const access = await this.oauth.authorize('gmail.labels');
    await this.requireUserLabel(id, access);
    assertTurnActive(guard);
    return normalizeLabel(await this.sendJson<ProviderLabel>(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(id)}`, { name: safeName }, 'PATCH', access, guard));
  }
  async deleteLabel(labelId: string, guard?: GmailTurnGuard): Promise<void> {
    assertTurnActive(guard);
    const id = requiredId(labelId, 'Gmail label id');
    const access = await this.oauth.authorize('gmail.labels');
    await this.requireUserLabel(id, access);
    assertTurnActive(guard);
    const response = await access.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!response.ok) throw new Error(`Gmail request failed (${response.status}).`);
  }

  async sendMessage(input: { readonly to: readonly string[]; readonly cc?: readonly string[]; readonly subject: string; readonly body: string }, guard?: GmailTurnGuard): Promise<GmailSendAck> {
    assertTurnActive(guard);
    const to = validateRecipients(input.to, true);
    const cc = validateRecipients(input.cc, false);
    if (to.length + cc.length > 50) throw new Error('Gmail send exceeds the 50-recipient application limit.');
    const subject = validateSubject(input.subject);
    const body = validateBody(input.body);
    const raw = composeRaw([`To: ${to.join(', ')}`, ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []), `Subject: ${subject}`], body);
    const access = await this.oauth.authorize('gmail.send');
    assertTurnActive(guard);
    await this.sendAndDiscard('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: rawRfc822ToBase64Url(raw) }, access, guard);
    return { sent: true };
  }
  async replyMessage(input: { readonly threadId: string; readonly to: string; readonly subject: string; readonly body: string; readonly inReplyTo: string }, guard?: GmailTurnGuard): Promise<GmailSendAck> {
    assertTurnActive(guard);
    const threadId = requiredId(input.threadId, 'Gmail thread id');
    const to = validateAddress(input.to);
    const subject = validateSubject(input.subject);
    const body = validateBody(input.body);
    const inReplyTo = validateMessageId(input.inReplyTo);
    const readAccess = await this.oauth.authorize('gmail.read');
    assertTurnActive(guard);
    const threadUrl = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}`);
    threadUrl.searchParams.set('format', 'metadata');
    threadUrl.searchParams.append('metadataHeaders', 'Subject');
    threadUrl.searchParams.append('metadataHeaders', 'Message-ID');
    threadUrl.searchParams.append('metadataHeaders', 'References');
    const thread = await this.readJson<ProviderThread>(await readAccess.fetch(threadUrl));
    assertTurnActive(guard);
    const messages = Array.isArray(thread.messages) ? thread.messages.filter((item): item is ProviderMessage => Boolean(item) && typeof item === 'object') : [];
    const target = messages.find((message) => headerMap(message.payload?.headers).get('message-id') === inReplyTo);
    if (!target) throw new Error('Gmail reply target Message-ID is not present in the selected thread.');
    const targetHeaders = headerMap(target.payload?.headers);
    const providerSubject = targetHeaders.get('subject');
    if (!providerSubject || replySubjectKey(providerSubject) !== replySubjectKey(subject)) throw new Error('Gmail reply subject does not match the selected thread.');
    const references = [...new Set([...parseReferenceIds(targetHeaders.get('references')), inReplyTo])];
    const raw = composeRaw([`To: ${to}`, `Subject: ${subject}`, `In-Reply-To: ${inReplyTo}`, `References: ${references.join(' ')}`], body);
    const sendAccess = await this.oauth.authorize('gmail.send');
    assertTurnActive(guard);
    await this.sendAndDiscard('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { raw: rawRfc822ToBase64Url(raw), threadId }, sendAccess, guard);
    return { sent: true, threadId };
  }

  private async organize(kind: 'messages' | 'threads', id: string, action: GmailOrganizeAction, labelId: string | undefined, guard: GmailTurnGuard | undefined): Promise<GmailMutationAck> {
    const access = await this.oauth.authorize('gmail.modify');
    if ((action === 'applyLabel' || action === 'removeLabel') && labelId) await this.requireUserLabel(requiredId(labelId, 'Gmail user label id'), access);
    assertTurnActive(guard);
    const labels = actionLabels(action, labelId);
    await this.sendAndDiscard(`https://gmail.googleapis.com/gmail/v1/users/me/${kind}/${encodeURIComponent(id)}/modify`, labels, access, guard);
    return { changed: true, target: kind === 'messages' ? 'message' : 'thread', id, action };
  }
  private async requireUserLabel(id: string, access: Awaited<ReturnType<GoogleOAuthAuthority['authorize']>>): Promise<void> {
    const label = normalizeLabel(await this.readJson<ProviderLabel>(await access.fetch(`https://gmail.googleapis.com/gmail/v1/users/me/labels/${encodeURIComponent(id)}`)));
    if (label.type !== 'user') throw new Error('Gmail custom-label operations require a USER label id.');
  }
  private async postWrite(path: string, guard: GmailTurnGuard | undefined): Promise<void> {
    const access = await this.oauth.authorize('gmail.modify');
    assertTurnActive(guard);
    await this.sendAndDiscard(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, undefined, access, guard);
  }
  private labelName(name: string): string { const normalized = name.trim(); if (!normalized || normalized.length > 500 || /[\r\n]/.test(normalized) || normalized.includes('\0')) throw new Error('Gmail label name is invalid.'); return normalized; }
  private async sendAndDiscard(url: string, body: unknown, access: Awaited<ReturnType<GoogleOAuthAuthority['authorize']>>, guard: GmailTurnGuard | undefined): Promise<void> {
    assertTurnActive(guard);
    const response = await access.fetch(url, { method: 'POST', headers: body === undefined ? undefined : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(`Gmail request failed (${response.status}).`);
  }
  private async sendJson<T = unknown>(url: string, body: unknown, method: 'POST' | 'PATCH', access: Awaited<ReturnType<GoogleOAuthAuthority['authorize']>>, guard: GmailTurnGuard | undefined): Promise<T> {
    assertTurnActive(guard);
    const response = await access.fetch(url, { method, headers: body === undefined ? undefined : { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return this.readJson<T>(response);
  }
  private async readJson<T>(response: Response): Promise<T> { if (!response.ok) throw new Error(`Gmail request failed (${response.status}).`); return (await response.json()) as T; }
}
