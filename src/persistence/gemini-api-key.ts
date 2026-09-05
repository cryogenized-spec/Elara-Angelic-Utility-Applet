const STORAGE_KEY = 'elara.gemini.api-key';

export async function getGeminiApiKey(): Promise<string> {
  try {
    return window.localStorage.getItem(STORAGE_KEY)?.trim() ?? '';
  } catch {
    return '';
  }
}

export async function saveGeminiApiKey(value: string): Promise<void> {
  const key = value.trim();
  try {
    if (key) window.localStorage.setItem(STORAGE_KEY, key);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    throw new Error('The Gemini API key could not be stored in the local Lockbox.');
  }
}

export async function clearGeminiApiKey(): Promise<void> {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    throw new Error('The Gemini API key could not be removed from the local Lockbox.');
  }
}

export function maskGeminiApiKey(value: string): string {
  const key = value.trim();
  if (!key) return '';
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}
