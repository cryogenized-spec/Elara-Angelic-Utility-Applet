import { db, type StoredGooglePickerAdmissions } from './conversation';
import {
  MAX_PICKER_ADMISSIONS,
  MAX_PICKER_FILE_ID_LENGTH,
  MAX_PICKER_MIME_LENGTH,
  MAX_PICKER_NAME_LENGTH,
  MAX_PICKER_URL_LENGTH,
  type GooglePickerAdmission,
  type GooglePickerAdmissionState,
  type GooglePickerFile,
} from '../google/picker/contracts';

const SETTINGS_ID = 'google-picker-admissions' as const;
const MAX_REVOKED_FILE_IDS = 500;

function cleanText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  return text && text.length <= max ? text : undefined;
}

function cleanFile(value: GooglePickerFile, admittedAt: number): GooglePickerAdmission | undefined {
  const id = cleanText(value.id, MAX_PICKER_FILE_ID_LENGTH);
  const name = cleanText(value.name, MAX_PICKER_NAME_LENGTH);
  if (!id || !name) return undefined;
  const mimeType = cleanText(value.mimeType, MAX_PICKER_MIME_LENGTH);
  let url: string | undefined;
  const urlValue = cleanText(value.url, MAX_PICKER_URL_LENGTH);
  if (urlValue) {
    try {
      const parsed = new URL(urlValue);
      if (parsed.protocol === 'https:' && (parsed.hostname === 'drive.google.com' || parsed.hostname === 'docs.google.com')) url = parsed.toString();
    } catch {
      // Optional display metadata only.
    }
  }
  return { id, name, admittedAt, ...(mimeType ? { mimeType } : {}), ...(url ? { url } : {}) };
}

function emptyState(): StoredGooglePickerAdmissions {
  return { id: SETTINGS_ID, files: [], revokedFileIds: [], updatedAt: 0 };
}

function normalizeStored(value: StoredGooglePickerAdmissions | undefined): StoredGooglePickerAdmissions {
  if (!value || value.id !== SETTINGS_ID) return emptyState();
  const seen = new Set<string>();
  const files: GooglePickerAdmission[] = [];
  for (const raw of Array.isArray(value.files) ? value.files : []) {
    const cleaned = cleanFile(raw, Number.isFinite(raw.admittedAt) ? raw.admittedAt : 0);
    if (!cleaned || seen.has(cleaned.id)) continue;
    seen.add(cleaned.id);
    files.push(cleaned);
    if (files.length >= MAX_PICKER_ADMISSIONS) break;
  }
  const revokedFileIds = [...new Set(
    (Array.isArray(value.revokedFileIds) ? value.revokedFileIds : [])
      .map((id) => cleanText(id, MAX_PICKER_FILE_ID_LENGTH))
      .filter((id): id is string => Boolean(id)),
  )].slice(-MAX_REVOKED_FILE_IDS);
  return { id: SETTINGS_ID, files, revokedFileIds, updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : 0 };
}

async function loadStored(): Promise<StoredGooglePickerAdmissions> {
  const value = await db.settings.get(SETTINGS_ID);
  return normalizeStored(value?.id === SETTINGS_ID ? value : undefined);
}

export async function loadGooglePickerAdmissions(): Promise<GooglePickerAdmissionState> {
  const state = await loadStored();
  return { files: state.files, revokedFileIds: state.revokedFileIds };
}

export async function admitGooglePickerFiles(files: readonly GooglePickerFile[], now = Date.now()): Promise<GooglePickerAdmissionState> {
  const current = await loadStored();
  const incoming: GooglePickerAdmission[] = [];
  const incomingIds = new Set<string>();
  for (const file of files) {
    const cleaned = cleanFile(file, now);
    if (!cleaned || incomingIds.has(cleaned.id)) continue;
    incomingIds.add(cleaned.id);
    incoming.push(cleaned);
  }
  const retained = current.files.filter((file) => !incomingIds.has(file.id));
  const nextFiles = [...incoming, ...retained].slice(0, MAX_PICKER_ADMISSIONS);
  const revokedFileIds = current.revokedFileIds.filter((id) => !incomingIds.has(id));
  const next: StoredGooglePickerAdmissions = { id: SETTINGS_ID, files: nextFiles, revokedFileIds, updatedAt: now };
  await db.settings.put(next);
  return { files: next.files, revokedFileIds: next.revokedFileIds };
}

export async function revokeGooglePickerFile(fileId: string, now = Date.now()): Promise<GooglePickerAdmissionState> {
  const id = cleanText(fileId, MAX_PICKER_FILE_ID_LENGTH);
  if (!id) throw new Error('Google Picker file ID is invalid.');
  const current = await loadStored();
  const nextRevoked = [...current.revokedFileIds.filter((value) => value !== id), id].slice(-MAX_REVOKED_FILE_IDS);
  const next: StoredGooglePickerAdmissions = {
    id: SETTINGS_ID,
    files: current.files.filter((file) => file.id !== id),
    revokedFileIds: nextRevoked,
    updatedAt: now,
  };
  await db.settings.put(next);
  return { files: next.files, revokedFileIds: next.revokedFileIds };
}

export async function clearGooglePickerAdmissions(now = Date.now()): Promise<GooglePickerAdmissionState> {
  const current = await loadStored();
  const revokedFileIds = [...new Set([...current.revokedFileIds, ...current.files.map((file) => file.id)])].slice(-MAX_REVOKED_FILE_IDS);
  const next: StoredGooglePickerAdmissions = { id: SETTINGS_ID, files: [], revokedFileIds, updatedAt: now };
  await db.settings.put(next);
  return { files: [], revokedFileIds };
}

export async function assertGooglePickerFileAllowed(fileId: string): Promise<void> {
  const id = cleanText(fileId, MAX_PICKER_FILE_ID_LENGTH);
  if (!id) throw new Error('Google Drive file ID is invalid.');
  const state = await loadStored();
  if (state.revokedFileIds.includes(id)) {
    throw new Error('This Google Drive file was removed from Elara. Choose it again in Google Picker before using it.');
  }
}

export async function filterRevokedGooglePickerFiles<T extends { readonly id: string }>(files: readonly T[]): Promise<T[]> {
  const state = await loadStored();
  if (!state.revokedFileIds.length) return [...files];
  const revoked = new Set(state.revokedFileIds);
  return files.filter((file) => !revoked.has(file.id));
}
