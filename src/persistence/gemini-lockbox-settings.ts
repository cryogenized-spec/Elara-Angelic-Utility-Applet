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

export async function changeGeminiLockboxPin(currentPin: string, newPin: string): Promise<void> {
  const current = validatePin(currentPin);
  const next = validatePin(newPin);
  if (current === next) throw new Error('Choose a different Lockbox PIN.');

  await unlockGeminiApiKeyWithPin(current);
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('The Gemini API Lockbox is not configured.');
  await configureGeminiApiKeyWithPin(apiKey, next);
}
