import {
  GEMINI_LOCKBOX_PIN_MAX_LENGTH,
  GEMINI_LOCKBOX_PIN_MIN_LENGTH,
  configureGeminiApiKeyWithPin,
  getGeminiApiKey,
  isGeminiLockboxPin,
  unlockGeminiApiKeyWithPin,
} from './gemini-api-key';

function validatePin(pin: string): string {
  const value = pin.trim();
  if (!isGeminiLockboxPin(value)) {
    throw new Error(`Use a ${GEMINI_LOCKBOX_PIN_MIN_LENGTH}–${GEMINI_LOCKBOX_PIN_MAX_LENGTH} digit PIN.`);
  }
  return value;
}

async function getUnlockedApiKeyWithPin(pin: string): Promise<string> {
  const current = validatePin(pin);
  await unlockGeminiApiKeyWithPin(current);
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('The Gemini API Lockbox is not configured.');
  return apiKey;
}

export async function changeGeminiLockboxPin(currentPin: string, newPin: string): Promise<void> {
  const current = validatePin(currentPin);
  const next = validatePin(newPin);
  if (current === next) throw new Error('Choose a different Lockbox PIN.');
  const apiKey = await getUnlockedApiKeyWithPin(current);
  await configureGeminiApiKeyWithPin(apiKey, next);
}

export async function switchGeminiLockboxToPin(currentPin: string): Promise<void> {
  const current = validatePin(currentPin);
  const apiKey = await getUnlockedApiKeyWithPin(current);
  await configureGeminiApiKeyWithPin(apiKey, current);
}
