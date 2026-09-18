import type { GoogleOAuthAuthority } from '../oauth/contracts';

const MAX_DOCUMENT_ID_LENGTH = 500;
const MAX_TITLE_LENGTH = 500;
const MAX_BATCH_REQUESTS = 100;
const MAX_REQUEST_BODY_BYTES = 1_000_000;

type DocumentPayload = {
  documentId?: string;
  title?: string;
  revisionId?: string;
  body?: unknown;
};

export interface GoogleDocumentSummary {
  documentId: string;
  title: string;
  revisionId?: string;
}

function bounded(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Google Docs ${field} is required.`);
  if (normalized.length > maxLength) throw new Error(`Google Docs ${field} is too long.`);
  return normalized;
}

function boundedRequests(requests: readonly Record<string, unknown>[]): readonly Record<string, unknown>[] {
  if (!requests.length) throw new Error('Google Docs batch update requires at least one request.');
  if (requests.length > MAX_BATCH_REQUESTS) throw new Error(`Google Docs batch update is limited to ${MAX_BATCH_REQUESTS} requests.`);
  const body = JSON.stringify({ requests });
  if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BODY_BYTES) throw new Error('Google Docs batch update exceeds the application request limit.');
  return requests;
}

export class GoogleDocsService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async getDocument(documentId: string): Promise<DocumentPayload> {
    const safeDocumentId = bounded(documentId, 'document ID', MAX_DOCUMENT_ID_LENGTH);
    const access = await this.oauth.authorize('docs.read');
    const response = await access.fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(safeDocumentId)}`);
    return this.readJson(response);
  }

  async inspectDocument(documentId: string): Promise<{ documentId: string; title: string; endIndex: number; blocks: readonly Record<string, unknown>[] }> {
    const document = await this.getDocument(documentId);
    return inspectGoogleDocument(document);
  }

  async insertText(documentId: string, index: number, text: string): Promise<unknown> {
    return this.batchUpdate(documentId, [{ insertText: { location: { index }, text } }]);
  }

  async appendParagraph(documentId: string, text: string): Promise<unknown> {
    const inspected = await this.inspectDocument(documentId);
    const index = Math.max(1, inspected.endIndex - 1);
    const content = text.endsWith('\n') ? text : `${text}\n`;
    return this.insertText(documentId, index, content);
  }

  async replaceText(documentId: string, findText: string, replaceText: string, matchCase = false): Promise<unknown> {
    return this.batchUpdate(documentId, [{ replaceAllText: { containsText: { text: findText, matchCase }, replaceText } }]);
  }

  async createDocument(title: string): Promise<GoogleDocumentSummary> {
    const safeTitle = bounded(title, 'document title', MAX_TITLE_LENGTH);
    const access = await this.oauth.authorize('docs.write');
    const response = await access.fetch('https://docs.googleapis.com/v1/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: safeTitle }),
    });
    const payload = await this.readJson(response);
    if (!payload.documentId) throw new Error('Google Docs response did not contain a document ID.');
    return { documentId: payload.documentId, title: payload.title ?? safeTitle, revisionId: payload.revisionId };
  }

  async batchUpdate(documentId: string, requests: readonly Record<string, unknown>[], writeControl?: Record<string, unknown>): Promise<unknown> {
    const safeDocumentId = bounded(documentId, 'document ID', MAX_DOCUMENT_ID_LENGTH);
    const safeRequests = boundedRequests(requests);
    const body = { requests: safeRequests, ...(writeControl ? { writeControl } : {}) };
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > MAX_REQUEST_BODY_BYTES) throw new Error('Google Docs batch update exceeds the application request limit.');
    const access = await this.oauth.authorize('docs.write');
    const response = await access.fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(safeDocumentId)}:batchUpdate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return this.readJson(response);
  }

  private async readJson(response: Response): Promise<DocumentPayload> {
    if (!response.ok) throw new Error(`Google Docs request failed (${response.status}).`);
    return (await response.json()) as DocumentPayload;
  }
}

export function inspectGoogleDocument(document: DocumentPayload): { documentId: string; title: string; endIndex: number; blocks: readonly Record<string, unknown>[] } {
  const content = document.body && typeof document.body === 'object' && !Array.isArray(document.body)
    ? (document.body as { content?: unknown }).content
    : undefined;
  const blocks: Record<string, unknown>[] = [];
  let endIndex = 1;
  if (Array.isArray(content)) {
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
          return typeof (textRun as Record<string, unknown>).content === 'string' ? (textRun as Record<string, unknown>).content as string : '';
        }).join('');
        blocks.push({
          kind: typeof style.namedStyleType === 'string' && String(style.namedStyleType).startsWith('HEADING') ? 'heading' : 'paragraph',
          namedStyleType: typeof style.namedStyleType === 'string' ? style.namedStyleType : 'NORMAL_TEXT',
          startIndex,
          endIndex: itemEnd,
          text: text.replace(/\n$/, ''),
        });
      } else if (item.table) {
        blocks.push({ kind: 'table', startIndex, endIndex: itemEnd });
      }
    }
  }
  return {
    documentId: document.documentId ?? '',
    title: document.title ?? 'Untitled',
    endIndex,
    blocks,
  };
}
