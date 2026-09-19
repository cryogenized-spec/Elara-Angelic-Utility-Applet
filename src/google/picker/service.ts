import {
  MAX_PICKER_FILE_ID_LENGTH,
  MAX_PICKER_MIME_LENGTH,
  MAX_PICKER_NAME_LENGTH,
  MAX_PICKER_SELECTIONS,
  MAX_PICKER_URL_LENGTH,
  type GoogleDrivePickerAuthority,
  type GoogleDrivePickerOptions,
  type GooglePickerFile,
} from './contracts';

const PICKER_SCRIPT_URL = 'https://apis.google.com/js/api.js';
const PICKER_ORIGIN = 'https://apis.google.com';
const DEFAULT_PICKER_TIMEOUT_MS = 30_000;

interface PickerDocument {
  readonly [key: string]: unknown;
}

interface PickerData {
  readonly [key: string]: unknown;
}

interface PickerBuilderLike {
  addView(view: unknown): PickerBuilderLike;
  enableFeature(feature: unknown): PickerBuilderLike;
  setAppId(value: string): PickerBuilderLike;
  setDeveloperKey(value: string): PickerBuilderLike;
  setOAuthToken(value: string): PickerBuilderLike;
  setOrigin(value: string): PickerBuilderLike;
  setCallback(callback: (data: PickerData) => void): PickerBuilderLike;
  build(): { setVisible(value: boolean): void };
}

interface PickerNamespace {
  readonly Action: { readonly PICKED: unknown; readonly CANCEL: unknown };
  readonly Document: { readonly ID: string; readonly NAME: string; readonly MIMETYPE: string; readonly URL: string };
  readonly Feature: { readonly MULTISELECT_ENABLED: unknown };
  readonly Response: { readonly ACTION: string; readonly DOCUMENTS: string };
  readonly ViewId: { readonly DOCS: unknown };
  readonly PickerBuilder: new () => PickerBuilderLike;
  readonly DocsView: new (viewId?: unknown) => { setMimeTypes(value: string): void };
}

interface GoogleApiLoader {
  load(name: string, options: { callback: () => void; onerror: () => void; timeout: number; ontimeout: () => void }): void;
}

type PickerWindow = Window & typeof globalThis & {
  gapi?: GoogleApiLoader;
  google?: { picker?: PickerNamespace } & Record<string, unknown>;
};

let pickerLoader: Promise<PickerNamespace> | null = null;

function publicConfig(): { developerKey: string; appId: string } {
  const developerKey = (import.meta.env.VITE_GOOGLE_PICKER_API_KEY as string | undefined)?.trim() ?? '';
  const appId = (import.meta.env.VITE_GOOGLE_CLOUD_PROJECT_NUMBER as string | undefined)?.trim() ?? '';
  if (!developerKey || !appId) {
    throw new Error('Google Picker is not configured. Set VITE_GOOGLE_PICKER_API_KEY and VITE_GOOGLE_CLOUD_PROJECT_NUMBER for this self-hosted installation.');
  }
  if (!/^\d{5,30}$/.test(appId)) throw new Error('Google Picker Cloud project number is invalid.');
  if (developerKey.length > 500) throw new Error('Google Picker API key configuration is invalid.');
  return { developerKey, appId };
}

function pickerConfigured(): boolean {
  try {
    publicConfig();
    return true;
  } catch {
    return false;
  }
}

function loadPickerScript(): Promise<void> {
  const win = window as PickerWindow;
  if (win.gapi) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PICKER_SCRIPT_URL}"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Google Picker script could not be loaded.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = PICKER_SCRIPT_URL;
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Google Picker script could not be loaded.')), { once: true });
    document.head.appendChild(script);
  });
}

async function loadPicker(): Promise<PickerNamespace> {
  if (pickerLoader) return pickerLoader;
  pickerLoader = (async () => {
    await loadPickerScript();
    const win = window as PickerWindow;
    if (!win.gapi) throw new Error('Google Picker loader did not initialize.');
    await new Promise<void>((resolve, reject) => {
      win.gapi!.load('picker', {
        callback: resolve,
        onerror: () => reject(new Error('Google Picker library could not be loaded.')),
        timeout: DEFAULT_PICKER_TIMEOUT_MS,
        ontimeout: () => reject(new Error('Google Picker library load timed out.')),
      });
    });
    const picker = win.google?.picker;
    if (!picker?.PickerBuilder || !picker.DocsView) throw new Error('Google Picker library is unavailable.');
    return picker;
  })().catch((error) => {
    pickerLoader = null;
    throw error;
  });
  return pickerLoader;
}

function boundedText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text || text.length > max) return undefined;
  return text;
}

function sanitizePickedDocuments(picker: PickerNamespace, raw: unknown): GooglePickerFile[] {
  if (!Array.isArray(raw)) return [];
  const files: GooglePickerFile[] = [];
  const seen = new Set<string>();
  for (const entry of raw.slice(0, MAX_PICKER_SELECTIONS)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const document = entry as PickerDocument;
    const id = boundedText(document[picker.Document.ID], MAX_PICKER_FILE_ID_LENGTH);
    const name = boundedText(document[picker.Document.NAME], MAX_PICKER_NAME_LENGTH);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const mimeType = boundedText(document[picker.Document.MIMETYPE], MAX_PICKER_MIME_LENGTH);
    const urlValue = boundedText(document[picker.Document.URL], MAX_PICKER_URL_LENGTH);
    let url: string | undefined;
    if (urlValue) {
      try {
        const parsed = new URL(urlValue);
        if (parsed.protocol === 'https:' && (parsed.hostname === 'drive.google.com' || parsed.hostname === 'docs.google.com')) url = parsed.toString();
      } catch {
        // Provider URLs are optional display metadata, never authority.
      }
    }
    files.push({ id, name, ...(mimeType ? { mimeType } : {}), ...(url ? { url } : {}) });
  }
  return files;
}

export function createGoogleDrivePickerAuthority(
  accessToken: () => Promise<string>,
): GoogleDrivePickerAuthority {
  return {
    configured: pickerConfigured(),
    async pick(options: GoogleDrivePickerOptions = {}) {
      const { developerKey, appId } = publicConfig();
      const token = await accessToken();
      if (!token) throw new Error('Google Picker authorization did not return a usable access token.');
      const picker = await loadPicker();
      const view = new picker.DocsView(picker.ViewId.DOCS);
      if (options.mimeTypes?.length) {
        const mimeTypes = options.mimeTypes
          .map((value) => boundedText(value, MAX_PICKER_MIME_LENGTH))
          .filter((value): value is string => Boolean(value))
          .slice(0, 20);
        if (mimeTypes.length) view.setMimeTypes(mimeTypes.join(','));
      }

      return new Promise<readonly GooglePickerFile[]>((resolve, reject) => {
        let settled = false;
        const finish = (value: readonly GooglePickerFile[]) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        try {
          let builder = new picker.PickerBuilder()
            .setDeveloperKey(developerKey)
            .setAppId(appId)
            .setOAuthToken(token)
            .setOrigin(window.location.origin)
            .addView(view)
            .setCallback((data) => {
              const action = data[picker.Response.ACTION];
              if (action === picker.Action.PICKED) {
                finish(sanitizePickedDocuments(picker, data[picker.Response.DOCUMENTS]));
              } else if (action === picker.Action.CANCEL) {
                finish([]);
              }
            });
          if (options.multiselect !== false) builder = builder.enableFeature(picker.Feature.MULTISELECT_ENABLED);
          builder.build().setVisible(true);
        } catch (error) {
          reject(error);
        }
      });
    },
  };
}

export const GOOGLE_PICKER_EXECUTABLE_ORIGIN = PICKER_ORIGIN;
