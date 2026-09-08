import type { AttachmentKind } from '../domain/artifact';
import { ArtifactError } from './errors';
import { ARTIFACT_LIMITS } from './limits';

export const SUPPORTED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/bmp',
]);

export const SUPPORTED_DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/javascript',
  'text/javascript',
  'text/css',
  'text/html',
  'application/xml',
  'text/xml',
]);

export const SUPPORTED_MIME_TYPES = new Set([
  ...SUPPORTED_IMAGE_MIME_TYPES,
  ...SUPPORTED_DOCUMENT_MIME_TYPES,
]);

const EXTENSION_MIME_TYPES: Record<string, string> = {
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.js': 'application/javascript',
  '.ts': 'text/plain',
  '.tsx': 'text/plain',
  '.jsx': 'text/plain',
  '.py': 'text/plain',
  '.css': 'text/css',
  '.html': 'text/html',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
};

export interface ValidatedFile {
  file: File;
  name: string;
  mimeType: string;
  kind: AttachmentKind;
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function normalizedName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return (cleaned || 'untitled-file').slice(0, ARTIFACT_LIMITS.maxFilenameLength);
}

function kindForMime(mimeType: string): AttachmentKind {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/javascript') return 'text';
  if (mimeType === 'application/pdf' || mimeType.startsWith('application/')) return 'document';
  return 'unknown';
}

async function header(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, 16).arrayBuffer());
}

function startsWithBytes(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function hasCompatibleSignature(mimeType: string, bytes: Uint8Array): boolean {
  if (mimeType === 'application/pdf') return startsWithBytes(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (mimeType === 'image/png') return startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mimeType === 'image/jpeg') return startsWithBytes(bytes, [0xff, 0xd8, 0xff]);
  if (mimeType === 'image/gif') return startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38]);
  if (mimeType === 'image/webp') return startsWithBytes(bytes, [0x52, 0x49, 0x46, 0x46]) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (mimeType === 'image/avif') return bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && (bytes[8] === 0x61 || bytes[8] === 0x6d);
  return true;
}

export async function validateFile(file: File | null | undefined): Promise<ValidatedFile> {
  if (!file || typeof file.size !== 'number') throw new ArtifactError('UNSUPPORTED_FILE', 'No file was selected.');
  if (file.size <= 0) throw new ArtifactError('UNSUPPORTED_FILE', 'The selected file is empty.');
  if (file.size > ARTIFACT_LIMITS.maxAttachmentBytes) throw new ArtifactError('FILE_TOO_LARGE', 'This file is too large to add.');

  const name = normalizedName(file.name);
  const extensionMime = EXTENSION_MIME_TYPES[extensionOf(name)];
  const mimeType = (file.type || extensionMime || 'application/octet-stream').toLowerCase();
  if (!SUPPORTED_MIME_TYPES.has(mimeType)) {
    throw new ArtifactError('UNSUPPORTED_FILE', `Files of type ${mimeType} are not supported yet.`);
  }

  const bytes = await header(file);
  if (!hasCompatibleSignature(mimeType, bytes)) {
    throw new ArtifactError('UNSUPPORTED_FILE', 'The selected file does not match its declared type.');
  }

  return { file, name, mimeType, kind: kindForMime(mimeType) };
}
