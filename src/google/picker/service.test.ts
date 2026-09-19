// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGoogleDrivePickerAuthority } from './service';

type Callback = (data: Record<string, unknown>) => void;
let callback: Callback | undefined;
let oauthToken = '';

class FakeDocsView {
  mimeTypes = '';
  setMimeTypes(value: string) { this.mimeTypes = value; }
}

class FakePickerBuilder {
  setDeveloperKey() { return this; }
  setAppId() { return this; }
  setOAuthToken(value: string) { oauthToken = value; return this; }
  setOrigin() { return this; }
  addView() { return this; }
  enableFeature() { return this; }
  setCallback(value: Callback) { callback = value; return this; }
  build() {
    return {
      setVisible: () => {
        callback?.({
          action: 'picked',
          documents: [
            { id: 'file-1', name: 'Plan', mimeType: 'application/vnd.google-apps.document', url: 'https://docs.google.com/document/d/file-1/edit' },
            { id: 'file-2', name: 'Bad URL metadata', url: 'https://evil.example/file-2' },
          ],
        });
      },
    };
  }
}

beforeEach(() => {
  callback = undefined;
  oauthToken = '';
  vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', 'public-picker-key');
  vi.stubEnv('VITE_GOOGLE_CLOUD_PROJECT_NUMBER', '123456789012');
  Object.assign(window, {
    gapi: { load: (_name: string, options: { callback: () => void }) => options.callback() },
    google: {
      picker: {
        Action: { PICKED: 'picked', CANCEL: 'cancel' },
        Document: { ID: 'id', NAME: 'name', MIMETYPE: 'mimeType', URL: 'url' },
        Feature: { MULTISELECT_ENABLED: 'multi' },
        Response: { ACTION: 'action', DOCUMENTS: 'documents' },
        ViewId: { DOCS: 'docs' },
        PickerBuilder: FakePickerBuilder,
        DocsView: FakeDocsView,
      },
    },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  delete (window as Window & { gapi?: unknown }).gapi;
  delete (window as Window & { google?: unknown }).google;
});

describe('Google Picker adapter', () => {
  it('keeps the OAuth token internal and returns only bounded provider selections', async () => {
    const authority = createGoogleDrivePickerAuthority(async () => 'secret-access-token');
    expect(authority.configured).toBe(true);

    await expect(authority.pick({ multiselect: true })).resolves.toEqual([
      { id: 'file-1', name: 'Plan', mimeType: 'application/vnd.google-apps.document', url: 'https://docs.google.com/document/d/file-1/edit' },
      { id: 'file-2', name: 'Bad URL metadata' },
    ]);
    expect(oauthToken).toBe('secret-access-token');
    expect(JSON.stringify(await authority.pick())).not.toContain('secret-access-token');
  });

  it('reports unavailable configuration without attempting token acquisition', async () => {
    vi.stubEnv('VITE_GOOGLE_PICKER_API_KEY', '');
    let tokenCalls = 0;
    const authority = createGoogleDrivePickerAuthority(async () => { tokenCalls += 1; return 'secret'; });
    expect(authority.configured).toBe(false);
    await expect(authority.pick()).rejects.toThrow(/not configured/i);
    expect(tokenCalls).toBe(0);
  });
});
