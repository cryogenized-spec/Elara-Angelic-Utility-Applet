import type { GoogleOAuthAuthority } from '../oauth/contracts';

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

export class GoogleDocsService {
  constructor(private readonly oauth: GoogleOAuthAuthority) {}

  async getDocument(documentId: string): Promise<DocumentPayload> {
    const access = await this.oauth.authorize('docs.read');
    const response = await access.fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}`);
    return this.readJson(response);
  }

  async createDocument(title: string): Promise<GoogleDocumentSummary> {
    const access = await this.oauth.authorize('docs.write');
    const response = await access.fetch('https://docs.googleapis.com/v1/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    const payload = await this.readJson(response);
    if (!payload.documentId) throw new Error('Google Docs response did not contain a document ID.');
    return { documentId: payload.documentId, title: payload.title ?? title, revisionId: payload.revisionId };
  }

  async batchUpdate(documentId: string, requests: readonly Record<string, unknown>[], writeControl?: Record<string, unknown>): Promise<unknown> {
    const access = await this.oauth.authorize('docs.write');
    const response = await access.fetch(`https://docs.googleapis.com/v1/documents/${encodeURIComponent(documentId)}:batchUpdate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests, ...(writeControl ? { writeControl } : {}) }),
    });
    return this.readJson(response);
  }

  private async readJson(response: Response): Promise<DocumentPayload> {
    if (!response.ok) throw new Error(`Google Docs request failed (${response.status}).`);
    return (await response.json()) as DocumentPayload;
  }
}
