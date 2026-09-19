import type { GoogleOAuthAuthority } from '../oauth/contracts';

const MAX_DOCUMENT_ID_LENGTH = 500;
const MAX_TITLE_LENGTH = 500;
const MAX_TAB_ID_LENGTH = 500;
const MAX_REVISION_ID_LENGTH = 1024;
const MAX_TEXT_LENGTH = 20_000;
const MAX_FIND_TEXT_LENGTH = 2_000;
const MAX_BATCH_REQUESTS = 100;
const MAX_REQUEST_BODY_BYTES = 1_000_000;

type DocumentPayload = {
  documentId?: string;
  title?: string;
  revisionId?: string;
  body?: unknown;
  tabs?: unknown;
};

export interface GoogleDocumentSummary {
  documentId: string;
  title: string;
  revisionId?: string;
}

export interface GoogleDocsMutationOptions {
  readonly signal?: AbortSignal;
  readonly isGenerationActive?: () => boolean;
}

export interface GoogleDocumentTabInspection {
  readonly tabId: string;
  readonly title: string;
  readonly parentTabId?: string;
  readonly index?: number;
  readonly nestingLevel?: number;
  readonly endIndex: number;
  readonly blocks: readonly Record<string, unknown>[];
}

export interface GoogleDocumentInspection {
  readonly documentId: string;
  readonly title: string;
  readonly revisionId?: string;
  readonly endIndex: number;
  readonly blocks: readonly Record<string, unknown>[];
  readonly tabs: readonly GoogleDocumentTabInspection[];
  readonly trust: 'untrusted-external';
  readonly source: 'docs';
}

function bounded(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Google Docs ${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`Google Docs ${field} is too long.`);
  return normalized;
}

function boundedText(value: string, field: string, maxLength = MAX_TEXT_LENGTH, allowEmpty = false): string {
  if (typeof value !== 'string') throw new Error(`Google Docs ${field} must be text.`);
  if (!allowEmpty && value.length === 0) throw new Error(`Google Docs ${field} is required.`);
  if (value.length > maxLength) throw new Error(`Google Docs ${field} is too long.`);
  return value;
}

function boundedIndex(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 5_000_000) throw new Error('Google Docs insert index is outside the application bounds.');
  return value;
}

function requireMutationCurrent(options: GoogleDocsMutationOptions, operation: string): void {
  if (options.signal?.aborted || options.isGenerationActive?.() === false) {
    throw new DOMException(`${operation} lost turn authority.`, 'AbortError');
  }
}

function boundedRequests(requests: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  if (!requests.length) throw new Error('Google Docs batch update requires at least one request.');
  if (requests.length > MAX_BATCH_REQUESTS) throw new Error(`Google Docs batch update is limited to ${MAX_BATCH_REQUESTS} requests.`);
  const body = JSON.stringify({ requests });
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BODY_BYTES) throw new Error('Google Docs batch update exceeds the application request limit.');
  return requests;
}

function parseContent(content: unknown, tabId?: string): { endIndex: number; blocks: readonly Record<string, unknown>[] } {
  const blocks: Record<string, unknown>[] = [];
  let endIndex = 1;
  if (!Array.isArray(content)) return { endIndex, blocks };

  for (const raw of content) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    const startIndex = typeof item.startIndex === 'number' ? item.startIndex : undefined;
    const itemEnd = typeof item.endIndex === 'number' ? item.endIndex : undefined;
    if (typeof itemEnd === 'number') endIndex = Math.max(endIndex, itemEnd);

    if (item.paragraph && typeof item.paragraph === 'object' && !Array.isArray(item.paragraph)) {
      const paragraph = item.paragraph as Record<string, unknown>;
      const style = paragraph.paragraphStyle && typeof paragraph.paragraphStyle === 'object' && !Array.isArray(paragraph.paragraphStyle)
        ? paragraph.paragraphStyle as Record<string, unknown>
        : {};
      const elements = Array.isArray(paragraph.elements) ? paragraph.elements : [];
      const text = elements.map((element) => {
        if (!element || typeof element !== 'object' || Array.isArray(element)) return '';
        const textRun = (element as Record<string, unknown>).textRun;
        if (!textRun || typeof textRun !== 'object' || Array.isArray(textRun)) return '';
        return typeof (textRun as Record<string, unknown>).content === 'string'
          ? (textRun as Record<string, unknown>).content as string
          : '';
      }).join('');
      blocks.push({
        kind: typeof style.namedStyleType === 'string' && String(style.namedStyleType).startsWith('HEADING') ? 'heading' : 'paragraph',
        namedStyleType: typeof style.namedStyleType === 'string' ? style.namedStyleType : 'NORMAL_TEXT',
        ...(tabId ? { tabId } : {}),
        startIndex,
        endIndex: itemEnd,
        text: text.replace(/\n$/, ''),
      });
    } else if (item.table) {
      blocks.push({ kind: 'table', ...(tabId ? { tabId } : {}), startIndex, endIndex: itemEnd });
    }
  }

  return { endIndex, blocks };
}

function inspectTabs(rawTabs: unknown): GoogleDocumentTabInspection[] {
  if (!Array.isArray(rawTabs)) return [];
  const result: GoogleDocumentTabInspection[] = [];

  const visit = (raw: unknown): void => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return;
    const tab = raw as Record<string, unknown>;
    const properties = tab.tabProperties && typeof tab.tabProperties === 'object' && !Array.isArray(tab.tabProperties)
      ? tab.tabProperties as Record<string, unknown>
      : {};
    const tabId = typeof properties.tabId === 'string' ? properties.tabId.trim() : '';
    if (!tabId || tabId.length > MAX_TAB_ID_LENGTH) return;

    const documentTab = tab.documentTab && typeof tab.documentTab === 'object' && !Array.isArray(tab.documentTab)
      ? tab.documentTab as Record<string, unknown>
      : {};
    const body = documentTab.body && typeof documentTab.body === 'object' && !Array.isArray(documentTab.body)
      ? documentTab.body as Record<string, unknown>
      : {};
    const parsed = parseContent(body.content, tabId);

    result.push({
      tabId,
      title: typeof properties.title === 'string' && properties.title.trim() ? properties.title.trim().slice(0, MAX_TITLE_LENGTH) : 'Untitled tab',
      ...(typeof properties.parentTabId === 'string' && properties.parentTabId.trim() ? { parentTabId: properties.parentTabId.trim().slice(0, MAX_TAB_ID_LENGTH) } : {}),
      ...(Number.isInteger(properties.index) ? { index: properties.index as number } : {}),
      ...(Number.isInteger(properties.nestingLevel) ? { nestingLevel: properties.nestingLevel as number } : {}),
      endIndex: parsed.endIndex,
      blocks: parsed.blocks,
    });

    if (Array.isArray(tab.childTabs)) tab.childTabs.forEach(visit);
  };

  rawTabs.forEach(visit);
  return result;
}

export class GoogleDocsService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async getDocument(documentId: string): Promise<DocumentPayload> {
    const safeDocumentId = bounded(documentId, 'document ID', MAX_DOCUMENT_ID_LENGTH);
    const access = await this.oauth.authorize('docs.read');
    const response = await access.fetch(
      `https://docs.googleapis.com/v1/documents/${encodeURIComponent(safeDocumentId)}?includeTabsContent=true&suggestionsViewMode=SUGGESTIONS_INLINE`,
    );
    return this.readJson(response);
  }

  async inspectDocument(documentId: string): Promise<GoogleDocumentInspection> {
    return inspectGoogleDocument(await this.getDocument(documentId));
  }

  async insertText(documentId: string, tabId: string, revisionId: string, index: number, text: string, options: GoogleDocsMutationOptions = {}): Promise<unknown> {
    const safeTabId = bounded(tabId, 'tab ID', MAX_TAB_ID_LENGTH);
    const safeRevisionId = bounded(revisionId, 'revision ID', MAX_REVISION_ID_LENGTH);
    const safeText = boundedText(text, 'insert text');
    return this.batchUpdate(
      documentId,
      [{ insertText: { location: { index: boundedIndex(index), tabId: safeTabId }, text: safeText } }],
      { requiredRevisionId: safeRevisionId },
      options,
    );
  }

  async appendParagraph(documentId: string, tabId: string, revisionId: string, text: string, options: GoogleDocsMutationOptions = {}): Promise<unknown> {
    const safeTabId = bounded(tabId, 'tab ID', MAX_TAB_ID_LENGTH);
    const safeRevisionId = bounded(revisionId, 'revision ID', MAX_REVISION_ID_LENGTH);
    const inspected = await this.inspectDocument(documentId);
    if (!inspected.revisionId || inspected.revisionId !== safeRevisionId) {
      throw new Error('Google Docs changed since it was inspected. Re-read the document before appending.');
    }
    const tab = inspected.tabs.find((entry) => entry.tabId === safeTabId);
    if (!tab) throw new Error('Google Docs tab was not found in the latest document inspection.');
    const content = boundedText(text, 'paragraph text');
    return this.batchUpdate(
      documentId,
      [{ insertText: { location: { index: Math.max(1, tab.endIndex - 1), tabId: safeTabId }, text: content.endsWith('\n') ? content : `${content}\n` } }],
      { requiredRevisionId: safeRevisionId },
      options,
    );
  }

  async replaceText(documentId: string, tabId: string, revisionId: string, findText: string, replaceText: string, matchCase = false, options: GoogleDocsMutationOptions = {}): Promise<unknown> {
    const safeTabId = bounded(tabId, 'tab ID', MAX_TAB_ID_LENGTH);
    const safeRevisionId = bounded(revisionId, 'revision ID', MAX_REVISION_ID_LENGTH);
    const safeFind = boundedText(findText, 'find text', MAX_FIND_TEXT_LENGTH);
    const safeReplacement = boundedText(replaceText, 'replacement text', MAX_TEXT_LENGTH, true);
    return this.batchUpdate(
      documentId,
      [{ replaceAllText: { containsText: { text: safeFind, matchCase }, replaceText: safeReplacement, tabsCriteria: { tabIds: [safeTabId] } } }],
      { requiredRevisionId: safeRevisionId },
      options,
    );
  }

  async createDocument(title: string, options: GoogleDocsMutationOptions = {}): Promise<GoogleDocumentSummary> {
    const safeTitle = bounded(title, 'document title', MAX_TITLE_LENGTH);
    requireMutationCurrent(options, 'Google Docs create');
    const access = await this.oauth.authorize('docs.write');
    requireMutationCurrent(options, 'Google Docs create');
    const response = await access.fetch('https://docs.googleapis.com/v1/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: safeTitle }),
      ...(options.signal ? { signal: options.signal } : {}),
    }, () => requireMutationCurrent(options, 'Google Docs create'));
    const payload = await this.readJson(response);
    if (!payload.documentId) throw new Error('Google Docs response did not contain a document ID.');
    return { documentId: payload.documentId, title: payload.title ?? safeTitle, revisionId: payload.revisionId };
  }

  async batchUpdate(documentId: string, requests: readonly Record<string, unknown>[], writeControl?: Record<string, unknown>, options: GoogleDocsMutationOptions = {}): Promise<unknown> {
    const safeDocumentId = bounded(documentId, 'document ID', MAX_DOCUMENT_ID_LENGTH);
    const safeRequests = boundedRequests(requests);
    const body = { requests: safeRequests, ...(writeControl ? { writeControl } : {}) };
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_REQUEST_BODY_BYTES) throw new Error('Google Docs batch update exceeds the application request limit.');
    requireMutationCurrent(options, 'Google Docs update');
    const access = await this.oauth.authorize('docs.write');
    requireMutationCurrent(options, 'Google Docs update');
    const response = await access.fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(safeDocumentId)}:batchUpdate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    }, () => requireMutationCurrent(options, 'Google Docs update'));
    if (response.status === 400 && writeControl && Object.prototype.hasOwnProperty.call(writeControl, 'requiredRevisionId')) {
      throw new Error('Google Docs rejected the write revision. Re-read the document before editing.');
    }
    return this.readJson(response);
  }

  private async readJson(response: Response): Promise<DocumentPayload> {
    if (!response.ok) throw new Error(`Google Docs request failed (${response.status}).`);
    return (await response.json()) as DocumentPayload;
  }
}

export function inspectGoogleDocument(document: DocumentPayload): GoogleDocumentInspection {
  const tabs = inspectTabs(document.tabs);
  const legacyBody = document.body && typeof document.body === 'object' && !Array.isArray(document.body)
    ? document.body as { content?: unknown }
    : undefined;
  const legacy = tabs.length ? { endIndex: 1, blocks: [] as readonly Record<string, unknown>[] } : parseContent(legacyBody?.content);
  const blocks = tabs.length ? tabs.flatMap((tab) => tab.blocks) : legacy.blocks;
  const endIndex = tabs.length ? Math.max(1, ...tabs.map((tab) => tab.endIndex)) : legacy.endIndex;

  return {
    documentId: document.documentId ?? '',
    title: document.title ?? 'Untitled',
    ...(typeof document.revisionId === 'string' && document.revisionId.trim() ? { revisionId: document.revisionId.trim().slice(0, MAX_REVISION_ID_LENGTH) } : {}),
    endIndex,
    blocks,
    tabs,
    trust: 'untrusted-external',
    source: 'docs',
  };
}
