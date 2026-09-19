import {
  GEMINI_LOCKBOX_NEW_PIN_MIN_LENGTH,
  GEMINI_LOCKBOX_PIN_MAX_LENGTH,
  GEMINI_LOCKBOX_PIN_MIN_LENGTH,
  configureGeminiApiKeyWithPin,
  getGeminiApiKey,
  isGeminiLockboxPin,
  isStrongGeminiLockboxPin,
  setGeminiLockboxSecurityMode,
  unlockGeminiApiKeyWithPin,
} from './gemini-api-key';

function validateExistingPin(pin: string): string {
  const value = pin.trim();
  if (!isGeminiLockboxPin(value)) {
    throw new Error(`Use the existing ${GEMINI_LOCKBOX_PIN_MIN_LENGTH}–${GEMINI_LOCKBOX_PIN_MAX_LENGTH} digit PIN.`);
  }
  return value;
}

function validateNewPin(pin: string): string {
  const value = pin.trim();
  if (!isStrongGeminiLockboxPin(value)) {
    throw new Error(`Use a ${GEMINI_LOCKBOX_NEW_PIN_MIN_LENGTH}–${GEMINI_LOCKBOX_PIN_MAX_LENGTH} digit PIN for new Lockbox protection.`);
  }
  return value;
}

async function getUnlockedApiKeyWithPin(pin: string): Promise<string> {
  const current = validateExistingPin(pin);
  await unlockGeminiApiKeyWithPin(current);
  const apiKey = await getGeminiApiKey();
  if (!apiKey) throw new Error('The Gemini API Lockbox is not configured.');
  return apiKey;
}

export async function changeGeminiLockboxPin(currentPin: string, newPin: string): Promise<void> {
  const current = validateExistingPin(currentPin);
  const next = validateNewPin(newPin);
  if (current === next) throw new Error('Choose a different Lockbox PIN.');
  const apiKey = await getUnlockedApiKeyWithPin(current);
  await configureGeminiApiKeyWithPin(apiKey, next);
}

export async function switchGeminiLockboxToPin(currentPin: string): Promise<void> {
  const current = validateExistingPin(currentPin);
  await getUnlockedApiKeyWithPin(current);
  // Passkey mode wraps the existing PIN; switching modes does not create new
  // PIN protection and therefore must not strand a legacy 6–8 digit record.
  await setGeminiLockboxSecurityMode('pin');
}
