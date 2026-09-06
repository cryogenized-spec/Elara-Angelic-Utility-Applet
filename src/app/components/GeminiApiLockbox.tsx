import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  GEMINI_LOCKBOX_PIN_MAX_LENGTH,
  GEMINI_LOCKBOX_PIN_MIN_LENGTH,
  clearGeminiApiKey,
  configureGeminiApiKeyWithPin,
  disableGeminiLockboxSecurity,
  enableGeminiLockboxWithPin,
  getGeminiLockboxMetadata,
  getGeminiLockboxStatus,
  isGeminiLockboxPin,
  lockGeminiApiKey,
  saveGeminiApiKey,
  unlockGeminiApiKey,
  unlockGeminiApiKeyWithPin,
} from '../../persistence/gemini-api-key';
import {
  hasGeminiPasskey,
  isGeminiPlatformAuthenticatorAvailable,
  isGeminiPasskeySupported,
  registerGeminiPasskey,
  removeGeminiPasskey,
  unlockGeminiApiKeyWithPasskey,
} from '../../persistence/gemini-passkey';
import './worker-health.css';

type LockboxState = 'loading' | 'empty' | 'locked' | 'unlocked';
type LockboxMode = 'password' | 'pin' | 'passkey' | 'off';

export function GeminiApiLockbox() {
  const [status, setStatus] = useState<LockboxState>('loading');
  const [mode, setMode] = useState<LockboxMode>('pin');
  const [hasPasskey, setHasPasskey] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [detail, setDetail] = useState('');
  const keyRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const confirmPinRef = useRef<HTMLInputElement>(null);
  const upgradePinRef = useRef<HTMLInputElement>(null);
  const unlockPasswordRef = useRef<HTMLInputElement>(null);
  const reenablePinRef = useRef<HTMLInputElement>(null);
  const reenablePinConfirmRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const [nextStatus, metadata, nextHasPasskey] = await Promise.all([
        getGeminiLockboxStatus(),
        getGeminiLockboxMetadata(),
        hasGeminiPasskey(),
      ]);
      setStatus(nextStatus);
      setMode(metadata?.mode ?? 'pin');
      setHasPasskey(nextHasPasskey);
    } catch {
      setStatus('empty');
      setMode('pin');
      setHasPasskey(false);
    }
  }

  useEffect(() => {
    void refresh();
    void isGeminiPlatformAuthenticatorAvailable().then(setPasskeyAvailable);
    const handleChange = () => { void refresh(); };
    window.addEventListener('elara-gemini-lockbox-changed', handleChange);
    return () => window.removeEventListener('elara-gemini-lockbox-changed', handleChange);
  }, []);

  useEffect(() => {
    if (status === 'locked' && (mode === 'pin' || mode === 'passkey')) pinRef.current?.focus();
  }, [status, mode]);

  function read(ref: RefObject<HTMLInputElement | null>): string {
    return ref.current?.value.trim() ?? '';
  }

  function clearInputs(...refs: Array<RefObject<HTMLInputElement | null>>): void {
    for (const ref of refs) {
      if (ref.current) ref.current.value = '';
    }
  }

  async function createPasswordLockbox() {
    const key = read(keyRef);
    const password = read(passwordRef);
    const confirmation = read(confirmPasswordRef);
    if (!key) return setDetail('Enter the Gemini API key first.');
    if (password.length < 8) return setDetail('Use a Lockbox password of at least 8 characters.');
    if (password !== confirmation) return setDetail('The Lockbox passwords do not match.');
    try {
      await saveGeminiApiKey(key, password);
      clearInputs(keyRef, passwordRef, confirmPasswordRef);
      setStatus('unlocked');
      setMode('password');
      setDetail('Encrypted Gemini API key stored in the local Lockbox.');
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Could not create the Gemini API Lockbox.');
    }
  }

  async function createPinLockbox() {
    const key = read(keyRef);
    const pin = read(pinRef);
    const confirmation = read(confirmPinRef);
    if (!key) return setDetail('Enter the Gemini API key first.');
    if (!isGeminiLockboxPin(pin)) return setDetail(`Use a ${GEMINI_LOCKBOX_PIN_MIN_LENGTH}–${GEMINI_LOCKBOX_PIN_MAX_LENGTH} digit PIN.`);
    if (pin !== confirmation) return setDetail('The Lockbox PINs do not match.');
    try {
      await configureGeminiApiKeyWithPin(key, pin);
      clearInputs(keyRef, pinRef, confirmPinRef);
      setStatus('unlocked');
      setMode('pin');
      setDetail('Encrypted Gemini API key stored in the local Lockbox. PIN is active for this session.');
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Could not create the Gemini API Lockbox.');
    }
  }

  async function unlockWithPin() {
    const pin = read(pinRef);
    if (!pin) return setDetail('Enter your Lockbox PIN.');
    try {
      await unlockGeminiApiKeyWithPin(pin);
      clearInputs(pinRef);
      setStatus('unlocked');
      setDetail('Lockbox unlocked with PIN for this browser session.');
    } catch (error) {
      clearInputs(pinRef);
      setDetail(error instanceof Error ? error.message : 'Could not unlock the Gemini API Lockbox.');
    }
  }

  async function unlockWithPasskey() {
    try {
      await unlockGeminiApiKeyWithPasskey();
      setStatus('unlocked');
      setMode('passkey');
      setDetail('Lockbox unlocked with your device passkey.');
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Passkey unlock failed. Use your PIN instead.');
      pinRef.current?.focus();
    }
  }

  async function unlockWithPassword() {
    const password = read(unlockPasswordRef);
    if (!password) return setDetail('Enter the Lockbox password.');
    try {
      await unlockGeminiApiKey(password);
      clearInputs(unlockPasswordRef);
      setStatus('unlocked');
      setDetail('Lockbox unlocked for this browser session.');
    } catch (error) {
      clearInputs(unlockPasswordRef);
      setDetail(error instanceof Error ? error.message : 'Could not unlock the Gemini API Lockbox.');
    }
  }

  async function registerPasskey() {
    const pin = read(upgradePinRef);
    if (!isGeminiLockboxPin(pin)) return setDetail(`Enter the current ${GEMINI_LOCKBOX_PIN_MIN_LENGTH}–${GEMINI_LOCKBOX_PIN_MAX_LENGTH} digit PIN to authorize passkey setup.`);
    try {
      await registerGeminiPasskey(pin);
      clearInputs(upgradePinRef);
      setMode('passkey');
      setHasPasskey(true);
      setDetail('Passkey enabled. Device authentication is now primary; PIN remains the fallback.');
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Could not enable the passkey. PIN remains available.');
    }
  }

  async function turnOffSecurity() {
    if (mode === 'off') return;
    if (!window.confirm('Turn Lockbox security off? The API key will remain encrypted at rest, but this device will be able to unlock it automatically.')) return;
    try {
      if (hasPasskey) await removeGeminiPasskey();
      await disableGeminiLockboxSecurity();
      setMode('off');
      setStatus('unlocked');
      setHasPasskey(false);
      setDetail('Lockbox security is off. The API key remains encrypted locally and unlocks automatically on this device.');
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Could not turn Lockbox security off.');
    }
  }

  async function turnOnSecurity() {
    const pin = read(reenablePinRef);
    const confirmation = read(reenablePinConfirmRef);
    if (!isGeminiLockboxPin(pin)) return setDetail(`Use a ${GEMINI_LOCKBOX_PIN_MIN_LENGTH}–${GEMINI_LOCKBOX_PIN_MAX_LENGTH} digit PIN.`);
    if (pin !== confirmation) return setDetail('The new Lockbox PINs do not match.');
    try {
      await enableGeminiLockboxWithPin(pin);
      clearInputs(reenablePinRef, reenablePinConfirmRef);
      setMode('pin');
      setStatus('unlocked');
      setDetail('Lockbox security is on. The API key is now protected by the new PIN.');
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Could not turn Lockbox security on.');
    }
  }

  async function clear() {
    if (!window.confirm('Clear the encrypted Gemini API key from this browser? This permanently removes the local recovery path for this Lockbox.')) return;
    try {
      await removeGeminiPasskey();
      await clearGeminiApiKey();
      clearInputs(keyRef, passwordRef, confirmPasswordRef, pinRef, confirmPinRef, upgradePinRef, unlockPasswordRef, reenablePinRef, reenablePinConfirmRef);
      setStatus('empty');
      setMode('pin');
      setHasPasskey(false);
      setDetail('Encrypted Gemini API key and local passkey removed from this browser.');
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Could not clear the Gemini API Lockbox.');
    }
  }

  function lock() {
    lockGeminiApiKey();
    setStatus('locked');
    setDetail('Lockbox locked. The API key is no longer available to the Gemini client.');
  }

  const dataState = status === 'unlocked' ? 'healthy' : status === 'empty' ? 'degraded' : 'unknown';
  const hasPrimaryPasskey = mode === 'passkey' && hasPasskey && isGeminiPasskeySupported();
  const isPin = mode === 'pin' || mode === 'passkey';
  const canUpgradePasskey = status === 'unlocked' && mode === 'pin' && !hasPasskey && passkeyAvailable;

  return (
    <div className="worker-health" data-state={dataState}>
      <div className="worker-health__header">
        <div>
          <span className="panel-kicker">LOCKBOX</span>
          <h2>Gemini API</h2>
          <p>The API key is encrypted locally in Dexie. The unlock secret is never stored.</p>
        </div>
        <span className="worker-health__status" role="status" aria-label={`Gemini Lockbox status: ${status}`}>
          <span className="worker-health__dot" aria-hidden="true" />
          {status === 'unlocked' ? 'Unlocked' : status === 'locked' ? 'Locked' : status === 'empty' ? 'Not configured' : 'Loading…'}
        </span>
      </div>

      {status === 'empty' && isPin && (
        <>
          <label className="character-field"><span>Gemini API key</span><input ref={keyRef} type="password" aria-label="Gemini API key" placeholder="Paste your Gemini API key" autoComplete="off" spellCheck={false} /></label>
          <label className="character-field"><span>Lockbox PIN</span><input ref={pinRef} type="password" aria-label="Lockbox PIN" placeholder="6–8 digits" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="new-password" onKeyDown={(event) => { if (event.key === 'Enter') void createPinLockbox(); }} /></label>
          <label className="character-field"><span>Confirm PIN</span><input ref={confirmPinRef} type="password" aria-label="Confirm Lockbox PIN" placeholder="Repeat the PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="new-password" onKeyDown={(event) => { if (event.key === 'Enter') void createPinLockbox(); }} /></label>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void createPinLockbox()}>Create PIN Lockbox</button></div>
        </>
      )}

      {status === 'empty' && !isPin && (
        <>
          <label className="character-field"><span>Gemini API key</span><input ref={keyRef} type="password" aria-label="Gemini API key" placeholder="Paste your Gemini API key" autoComplete="off" spellCheck={false} /></label>
          <label className="character-field"><span>Lockbox password</span><input ref={passwordRef} type="password" aria-label="Lockbox password" placeholder="Create a Lockbox password" autoComplete="new-password" /></label>
          <label className="character-field"><span>Confirm password</span><input ref={confirmPasswordRef} type="password" aria-label="Confirm Lockbox password" placeholder="Repeat the Lockbox password" autoComplete="new-password" /></label>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void createPasswordLockbox()}>Create Password Lockbox</button></div>
        </>
      )}

      {status === 'locked' && hasPrimaryPasskey && (
        <>
          <div className="worker-health__endpoint">Encrypted API key present · passkey unlock is primary · PIN remains available as fallback</div>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void unlockWithPasskey()}>Unlock with Passkey</button></div>
          <label className="character-field"><span>PIN fallback</span><input ref={pinRef} type="password" aria-label="Lockbox PIN" placeholder="Enter 6–8 digit PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="current-password" onKeyDown={(event) => { if (event.key === 'Enter') void unlockWithPin(); }} /></label>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void unlockWithPin()}>Unlock with PIN</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()}>Clear Lockbox</button></div>
        </>
      )}

      {status === 'locked' && !hasPrimaryPasskey && isPin && (
        <>
          <div className="worker-health__endpoint">Encrypted API key present · key material unavailable until PIN unlock</div>
          <label className="character-field"><span>Lockbox PIN</span><input ref={pinRef} type="password" aria-label="Lockbox PIN" placeholder="Enter 6–8 digit PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="current-password" onKeyDown={(event) => { if (event.key === 'Enter') void unlockWithPin(); }} /></label>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void unlockWithPin()}>Unlock</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()}>Forgot PIN? Clear Lockbox</button></div>
        </>
      )}

      {status === 'locked' && !isPin && (
        <>
          <div className="worker-health__endpoint">Encrypted API key present · key material unavailable until password unlock</div>
          <label className="character-field"><span>Lockbox password</span><input ref={unlockPasswordRef} type="password" aria-label="Lockbox password" placeholder="Enter your Lockbox password" autoComplete="current-password" onKeyDown={(event) => { if (event.key === 'Enter') void unlockWithPassword(); }} /></label>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void unlockWithPassword()}>Unlock</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()}>Clear Lockbox</button></div>
        </>
      )}

      {status === 'unlocked' && mode === 'off' && (
        <>
          <div className="worker-health__endpoint">Security off · API key remains encrypted at rest · this device unlocks it automatically</div>
          <label className="character-field"><span>New Lockbox PIN</span><input ref={reenablePinRef} type="password" aria-label="New Lockbox PIN" placeholder="Choose a 6–8 digit PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="new-password" /></label>
          <label className="character-field"><span>Confirm new PIN</span><input ref={reenablePinConfirmRef} type="password" aria-label="Confirm new Lockbox PIN" placeholder="Repeat the new PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="new-password" onKeyDown={(event) => { if (event.key === 'Enter') void turnOnSecurity(); }} /></label>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void turnOnSecurity()}>Turn Security On</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()}>Clear Lockbox</button></div>
        </>
      )}

      {status === 'unlocked' && mode !== 'off' && (
        <>
          <div className="worker-health__endpoint">•••••••••••••••• · encrypted at rest · available only in session memory · unlock mode: {mode}{mode === 'passkey' ? ' · PIN fallback enabled' : ''}</div>
          {canUpgradePasskey && (
            <div className="worker-health__endpoint"><strong>Upgrade to Passkey</strong> · protect this Lockbox with your device biometric/passkey for faster future unlocks.
              <label className="character-field" style={{ marginTop: '0.6rem' }}><span>Confirm with current PIN</span><input ref={upgradePinRef} type="password" aria-label="Confirm current PIN for passkey setup" placeholder="Enter your current PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="current-password" onKeyDown={(event) => { if (event.key === 'Enter') void registerPasskey(); }} /></label>
              <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void registerPasskey()}>Enable Passkey</button></div>
            </div>
          )}
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={lock}>Lock</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void turnOffSecurity()}>Turn Security Off</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()}>Clear Lockbox</button></div>
        </>
      )}

      <p className="worker-health__detail" aria-live="polite">{detail || (status === 'locked' ? `Unlock the encrypted API key before using Gemini. ${isPin ? 'The PIN field accepts 6–8 digits.' : 'Enter the Lockbox password.'}` : status === 'unlocked' ? mode === 'off' ? 'Security is off; the API key remains encrypted locally.' : 'The decrypted API key is held only in session memory.' : 'Create the Lockbox to encrypt and store your Gemini API key locally.')}</p>
    </div>
  );
}
