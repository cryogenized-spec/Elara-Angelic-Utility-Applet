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
  getYouTubeApiKey,
  getYouTubeLockboxStatus,
  clearYouTubeApiKey,
  saveYouTubeApiKey,
  isGeminiLockboxPin,
  lockGeminiApiKey,
  saveGeminiApiKey,
  unlockGeminiApiKey,
  unlockGeminiApiKeyWithPin,
  type LockboxSecretStatus,
} from '../../persistence/gemini-api-key';
import { changeGeminiLockboxPin, switchGeminiLockboxToPin } from '../../persistence/gemini-lockbox-settings';
import {
  hasGeminiPasskey,
  isGeminiPlatformAuthenticatorAvailable,
  isGeminiPasskeySupported,
  registerGeminiPasskey,
  removeGeminiPasskey,
  unlockGeminiApiKeyWithPasskey,
} from '../../persistence/gemini-passkey';
import { validateYouTubeApiKey, type YouTubeKeyValidationResult } from '../../media/youtube/validate';
import './worker-health.css';

type LockboxState = 'loading' | 'empty' | 'locked' | 'unlocked';
type LockboxMode = 'password' | 'pin' | 'passkey' | 'off';

type YouTubeValidationState = 'idle' | 'validating' | 'valid' | 'quota-exhausted' | 'invalid' | 'network-error';

export function GeminiApiLockbox() {
  const [status, setStatus] = useState<LockboxState>('loading');
  const [mode, setMode] = useState<LockboxMode>('pin');
  const [hasPasskey, setHasPasskey] = useState(false);
  const [passkeyAvailable, setPasskeyAvailable] = useState(false);
  const [detail, setDetail] = useState('');
  const [youtubeStatus, setYoutubeStatus] = useState<LockboxSecretStatus>('empty');
  const [youtubeValidation, setYoutubeValidation] = useState<YouTubeValidationState>('idle');
  const [youtubeValidationMessage, setYoutubeValidationMessage] = useState('');
  const keyRef = useRef<HTMLInputElement>(null);
  const youtubeKeyRef = useRef<HTMLInputElement>(null);
  const youtubeCredentialRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const pinRef = useRef<HTMLInputElement>(null);
  const confirmPinRef = useRef<HTMLInputElement>(null);
  const currentPinRef = useRef<HTMLInputElement>(null);
  const switchPinRef = useRef<HTMLInputElement>(null);
  const newPinRef = useRef<HTMLInputElement>(null);
  const confirmNewPinRef = useRef<HTMLInputElement>(null);
  const upgradePinRef = useRef<HTMLInputElement>(null);
  const unlockPasswordRef = useRef<HTMLInputElement>(null);
  const reenablePinRef = useRef<HTMLInputElement>(null);
  const reenablePinConfirmRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    try {
      const [nextStatus, metadata, nextHasPasskey, nextPasskeyAvailable, nextYoutubeStatus] = await Promise.all([
        getGeminiLockboxStatus(),
        getGeminiLockboxMetadata(),
        hasGeminiPasskey(),
        isGeminiPlatformAuthenticatorAvailable(),
        getYouTubeLockboxStatus(),
      ]);
      setStatus(nextStatus);
      setMode(metadata?.mode ?? 'pin');
      setHasPasskey(nextHasPasskey);
      setPasskeyAvailable(nextPasskeyAvailable);
      setYoutubeStatus(nextYoutubeStatus);
    } catch {
      setStatus('empty');
      setMode('pin');
      setHasPasskey(false);
      setYoutubeStatus('empty');
    }
  }

  useEffect(() => {
    void refresh();
    const handleChange = () => { void refresh(); };
    window.addEventListener('elara-gemini-lockbox-changed', handleChange);
    return () => window.removeEventListener('elara-gemini-lockbox-changed', handleChange);
  }, []);

  useEffect(() => {
    if (status === 'locked' && (mode === 'pin' || mode === 'passkey')) pinRef.current?.focus();
  }, [status, mode]);

  async function runYouTubeValidation(): Promise<void> {
    if (youtubeStatus !== 'unlocked') {
      setYoutubeValidation('idle');
      setYoutubeValidationMessage('');
      return;
    }
    setYoutubeValidation('validating');
    setYoutubeValidationMessage('Checking key with YouTube… (1 quota unit, not your search budget)');
    try {
      const key = await getYouTubeApiKey();
      if (!key) {
        setYoutubeValidation('idle');
        setYoutubeValidationMessage('');
        return;
      }
      const result: YouTubeKeyValidationResult = await validateYouTubeApiKey({ apiKey: key });
      if (result.valid && result.quotaExhausted) {
        setYoutubeValidation('quota-exhausted');
        setYoutubeValidationMessage('Key accepted — quota exhausted (resets midnight Pacific). Search will resume tomorrow.');
      } else if (result.valid) {
        setYoutubeValidation('valid');
        setYoutubeValidationMessage('Key accepted and working — YouTube responded successfully.');
      } else if (result.reason === 'invalid-key') {
        setYoutubeValidation('invalid');
        setYoutubeValidationMessage(result.message);
      } else if (result.reason === 'network') {
        setYoutubeValidation('network-error');
        setYoutubeValidationMessage(result.message + ' Key is stored, but live check failed.');
      } else {
        setYoutubeValidation('invalid');
        setYoutubeValidationMessage(result.message);
      }
    } catch {
      setYoutubeValidation('network-error');
      setYoutubeValidationMessage('Could not validate key — network error. Key remains stored.');
    }
  }

  useEffect(() => {
    if (youtubeStatus === 'unlocked') {
      void runYouTubeValidation();
    } else {
      setYoutubeValidation('idle');
      setYoutubeValidationMessage('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [youtubeStatus]);

  function read(ref: RefObject<HTMLInputElement | null>): string {
    return ref.current?.value.trim() ?? '';
  }

  function clearInputs(...refs: Array<RefObject<HTMLInputElement | null>>): void {
    for (const ref of refs) if (ref.current) ref.current.value = '';
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

  async function changePin() {
    const currentPin = read(currentPinRef);
    const newPin = read(newPinRef);
    const confirmation = read(confirmNewPinRef);
    if (!currentPin || !newPin || !confirmation) return setDetail('Enter your current PIN and the new PIN twice.');
    if (newPin !== confirmation) return setDetail('The new Lockbox PINs do not match.');
    try {
      await changeGeminiLockboxPin(currentPin, newPin);
      clearInputs(currentPinRef, newPinRef, confirmNewPinRef);
      setMode('pin');
      setStatus('unlocked');
      if (hasPasskey) {
        await removeGeminiPasskey();
        setHasPasskey(false);
      }
      setDetail('Lockbox PIN changed. Any previous passkey was removed because it was bound to the old PIN.');
    } catch (error) {
      clearInputs(currentPinRef, newPinRef, confirmNewPinRef);
      setDetail(error instanceof Error ? error.message : 'Could not change the Lockbox PIN.');
    }
  }

  async function switchToPin() {
    const currentPin = read(switchPinRef);
    if (!isGeminiLockboxPin(currentPin)) return setDetail(`Enter the current ${GEMINI_LOCKBOX_PIN_MIN_LENGTH}–${GEMINI_LOCKBOX_PIN_MAX_LENGTH} digit PIN to switch back to PIN mode.`);
    try {
      await switchGeminiLockboxToPin(currentPin);
      await removeGeminiPasskey();
      clearInputs(switchPinRef);
      setMode('pin');
      setStatus('unlocked');
      setHasPasskey(false);
      setDetail('Switched to PIN mode. Your existing PIN remains active.');
    } catch (error) {
      clearInputs(switchPinRef);
      setDetail(error instanceof Error ? error.message : 'Could not switch to PIN mode.');
    }
  }

  async function turnOffSecurity() {
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
      clearInputs(keyRef, passwordRef, confirmPasswordRef, pinRef, confirmPinRef, currentPinRef, switchPinRef, newPinRef, confirmNewPinRef, upgradePinRef, unlockPasswordRef, reenablePinRef, reenablePinConfirmRef, youtubeKeyRef, youtubeCredentialRef);
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

  async function saveYouTubeKey() {
    const value = read(youtubeKeyRef);
    const credential = read(youtubeCredentialRef);
    if (!value) {
      setDetail('Paste a YouTube Data API v3 key first.');
      return;
    }
    if (mode !== 'off' && !credential) {
      setDetail(pinCapable ? 'Enter your current Lockbox PIN to encrypt the YouTube key.' : 'Enter your current Lockbox password to encrypt the YouTube key.');
      return;
    }
    try {
      await saveYouTubeApiKey(value, credential);
      clearInputs(youtubeKeyRef, youtubeCredentialRef);
      await refresh();
      setDetail('YouTube Data API key encrypted in the Lockbox.');
      // Trigger validation immediately; refresh will also trigger via useEffect.
      setYoutubeValidation('validating');
      setYoutubeValidationMessage('Key saved — checking with YouTube…');
      // Small delay to allow unlock to settle, then validate.
      window.setTimeout(() => { void runYouTubeValidation(); }, 300);
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Could not save the YouTube API key.');
    }
  }

  async function clearYouTube() {
    if (!window.confirm('Remove the encrypted YouTube Data API key from this browser?')) return;
    try {
      await clearYouTubeApiKey();
      clearInputs(youtubeKeyRef, youtubeCredentialRef);
      setYoutubeValidation('idle');
      setYoutubeValidationMessage('');
      await refresh();
      setDetail('YouTube Data API key removed from this browser.');
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Could not remove the YouTube API key.');
    }
  }

  async function revalidateYouTubeKey() {
    setDetail('Re-checking YouTube key…');
    await runYouTubeValidation();
  }

  const dataState = status === 'unlocked' ? 'healthy' : status === 'empty' ? 'degraded' : 'unknown';
  const hasPrimaryPasskey = mode === 'passkey' && hasPasskey && isGeminiPasskeySupported();
  const pinCapable = mode === 'pin' || mode === 'passkey';
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

      {status === 'empty' && mode === 'pin' && (
        <>
          <label className="character-field"><span>Gemini API key</span><input ref={keyRef} type="password" aria-label="Gemini API key" placeholder="Paste your Gemini API key" autoComplete="off" spellCheck={false} /></label>
          <label className="character-field"><span>Lockbox PIN</span><input ref={pinRef} type="password" aria-label="Lockbox PIN" placeholder="6–8 digits" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="new-password" onKeyDown={(event) => { if (event.key === 'Enter') void createPinLockbox(); }} /></label>
          <label className="character-field"><span>Confirm PIN</span><input ref={confirmPinRef} type="password" aria-label="Confirm Lockbox PIN" placeholder="Repeat the PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="new-password" onKeyDown={(event) => { if (event.key === 'Enter') void createPinLockbox(); }} /></label>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void createPinLockbox()}>Create PIN Lockbox</button></div>
        </>
      )}

      {status === 'locked' && hasPrimaryPasskey && (
        <>
          <div className="worker-health__endpoint">Encrypted API key present · passkey is primary · PIN remains available as fallback</div>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void unlockWithPasskey()}>Unlock with Passkey</button></div>
          <label className="character-field"><span>PIN fallback</span><input ref={pinRef} type="password" aria-label="Lockbox PIN" placeholder="Enter 6–8 digit PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="current-password" onKeyDown={(event) => { if (event.key === 'Enter') void unlockWithPin(); }} /></label>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void unlockWithPin()}>Unlock with PIN</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()}>Clear Lockbox</button></div>
        </>
      )}

      {status === 'locked' && !hasPrimaryPasskey && pinCapable && (
        <>
          <div className="worker-health__endpoint">Encrypted API key present · key material unavailable until PIN unlock</div>
          <label className="character-field"><span>Lockbox PIN</span><input ref={pinRef} type="password" aria-label="Lockbox PIN" placeholder="Enter 6–8 digit PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="current-password" onKeyDown={(event) => { if (event.key === 'Enter') void unlockWithPin(); }} /></label>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void unlockWithPin()}>Unlock</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()}>Forgot PIN? Clear Lockbox</button></div>
        </>
      )}

      {status === 'locked' && mode === 'password' && (
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

      {status === 'unlocked' && mode === 'pin' && (
        <>
          <div className="worker-health__endpoint">Encrypted at rest · session unlocked · security mode: PIN</div>
          {canUpgradePasskey && <div className="worker-health__endpoint"><strong>Upgrade to Passkey</strong> · use device authentication instead of typing your PIN next time.
            <label className="character-field" style={{ marginTop: '0.6rem' }}><span>Confirm current PIN</span><input ref={upgradePinRef} type="password" aria-label="Confirm current PIN for passkey setup" placeholder="Current PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="current-password" onKeyDown={(event) => { if (event.key === 'Enter') void registerPasskey(); }} /></label>
            <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void registerPasskey()}>Enable Passkey</button></div>
          </div>}
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={lock}>Lock</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void turnOffSecurity()}>Turn Security Off</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()}>Clear Lockbox</button></div>
          <div className="worker-health__endpoint"><strong>Change PIN</strong>
            <label className="character-field" style={{ marginTop: '0.6rem' }}><span>Current PIN</span><input ref={currentPinRef} type="password" aria-label="Current PIN" placeholder="Current PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="current-password" /></label>
            <label className="character-field"><span>New PIN</span><input ref={newPinRef} type="password" aria-label="New PIN" placeholder="New 6–8 digit PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="new-password" /></label>
            <label className="character-field"><span>Confirm new PIN</span><input ref={confirmNewPinRef} type="password" aria-label="Confirm new PIN" placeholder="Repeat new PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="new-password" onKeyDown={(event) => { if (event.key === 'Enter') void changePin(); }} /></label>
            <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void changePin()}>Change PIN</button></div>
          </div>
        </>
      )}

      {status === 'unlocked' && mode === 'passkey' && (
        <>
          <div className="worker-health__endpoint">Encrypted at rest · session unlocked · security mode: Passkey · PIN fallback enabled</div>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={lock}>Lock</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void turnOffSecurity()}>Turn Security Off</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()}>Clear Lockbox</button></div>
          <div className="worker-health__endpoint"><strong>Switch to PIN</strong> · keep the current PIN and remove the device passkey.
            <label className="character-field" style={{ marginTop: '0.6rem' }}><span>Current PIN</span><input ref={switchPinRef} type="password" aria-label="Current PIN for switch to PIN" placeholder="Current PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="current-password" onKeyDown={(event) => { if (event.key === 'Enter') void switchToPin(); }} /></label>
            <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void switchToPin()}>Switch to PIN</button></div>
          </div>
          <div className="worker-health__endpoint"><strong>Change PIN</strong> · changing the PIN also removes the existing passkey because its wrapped secret is bound to the old PIN.
            <label className="character-field" style={{ marginTop: '0.6rem' }}><span>Current PIN</span><input ref={currentPinRef} type="password" aria-label="Current PIN for change" placeholder="Current PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="current-password" /></label>
            <label className="character-field"><span>New PIN</span><input ref={newPinRef} type="password" aria-label="New PIN for change" placeholder="New 6–8 digit PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="new-password" /></label>
            <label className="character-field"><span>Confirm new PIN</span><input ref={confirmNewPinRef} type="password" aria-label="Confirm new PIN for change" placeholder="Repeat new PIN" inputMode="numeric" maxLength={GEMINI_LOCKBOX_PIN_MAX_LENGTH} autoComplete="new-password" onKeyDown={(event) => { if (event.key === 'Enter') void changePin(); }} /></label>
            <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={() => void changePin()}>Change PIN</button></div>
          </div>
        </>
      )}

      {status === 'unlocked' && mode === 'password' && (
        <>
          <div className="worker-health__endpoint">Encrypted at rest · session unlocked · security mode: Password</div>
          <div className="worker-health__actions"><button className="model-settings__button worker-health__button" type="button" onClick={lock}>Lock</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void turnOffSecurity()}>Turn Security Off</button><button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()}>Clear Lockbox</button></div>
        </>
      )}

      {status === 'unlocked' && (
        <>
          <div
            className="worker-health__endpoint"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              borderColor:
                youtubeStatus === 'unlocked' && (youtubeValidation === 'valid' || youtubeValidation === 'quota-exhausted')
                  ? 'rgba(75,190,105,.35)'
                  : youtubeStatus === 'unlocked' && youtubeValidation === 'invalid'
                    ? 'rgba(255,90,90,.35)'
                    : undefined,
              background:
                youtubeStatus === 'unlocked' && (youtubeValidation === 'valid' || youtubeValidation === 'quota-exhausted')
                  ? 'rgba(75,190,105,.07)'
                  : youtubeStatus === 'unlocked' && youtubeValidation === 'invalid'
                    ? 'rgba(255,90,90,.07)'
                    : undefined,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: '9px',
                height: '9px',
                borderRadius: '50%',
                flex: '0 0 auto',
                background:
                  youtubeStatus === 'unlocked' && (youtubeValidation === 'valid' || youtubeValidation === 'quota-exhausted')
                    ? '#4fc26f'
                    : youtubeStatus === 'unlocked' && youtubeValidation === 'validating'
                      ? '#ffd37a'
                      : youtubeStatus === 'unlocked'
                        ? '#9be6b0'
                        : youtubeStatus === 'locked'
                          ? 'rgba(255,255,255,.35)'
                          : youtubeStatus === 'mismatch'
                            ? '#ffbe4b'
                            : 'rgba(255,255,255,.25)',
                boxShadow:
                  youtubeStatus === 'unlocked' && (youtubeValidation === 'valid' || youtubeValidation === 'quota-exhausted')
                    ? '0 0 0 3px rgba(79,194,111,.12)'
                    : '0 0 0 3px rgba(255,255,255,.05)',
              }}
            />
            <span>
              {youtubeStatus === 'unlocked'
                ? youtubeValidation === 'valid'
                  ? 'YouTube Data API · configured · unlocked · key accepted and working'
                  : youtubeValidation === 'quota-exhausted'
                    ? 'YouTube Data API · configured · unlocked · key accepted (quota exhausted)'
                    : youtubeValidation === 'validating'
                      ? 'YouTube Data API · configured · unlocked · validating key…'
                      : youtubeValidation === 'invalid'
                        ? 'YouTube Data API · configured · unlocked · key rejected'
                        : 'YouTube Data API · configured · unlocked'
                : youtubeStatus === 'mismatch'
                  ? 'YouTube Data API · saved under a different credential · re-save'
                  : youtubeStatus === 'locked'
                    ? 'YouTube Data API · configured · locked'
                    : 'YouTube Data API · not configured'}
            </span>
          </div>
          {youtubeStatus === 'unlocked' && youtubeValidationMessage && (
            <div
              className="worker-health__endpoint"
              role="status"
              aria-live="polite"
              style={{
                whiteSpace: 'normal',
                lineHeight: '1.4',
                color:
                  youtubeValidation === 'valid' || youtubeValidation === 'quota-exhausted'
                    ? '#9be6b0'
                    : youtubeValidation === 'invalid'
                      ? '#ff9d9d'
                      : undefined,
              }}
            >
              {youtubeValidationMessage}
              {youtubeValidation === 'valid' || youtubeValidation === 'quota-exhausted' ? ' ✓' : ''}
            </div>
          )}
          <label className="character-field"><span>YouTube API key</span><input ref={youtubeKeyRef} type="password" aria-label="YouTube API key" placeholder="Paste your YouTube Data API v3 key" autoComplete="off" spellCheck={false} /></label>
          {mode !== 'off' && (
            <label className="character-field"><span>{pinCapable ? 'Current Lockbox PIN' : 'Current Lockbox password'}</span><input ref={youtubeCredentialRef} type="password" aria-label="Current Lockbox credential for the YouTube key" placeholder={pinCapable ? 'Current PIN' : 'Current password'} inputMode={pinCapable ? 'numeric' : undefined} maxLength={pinCapable ? GEMINI_LOCKBOX_PIN_MAX_LENGTH : undefined} autoComplete="current-password" onKeyDown={(event) => { if (event.key === 'Enter') void saveYouTubeKey(); }} /></label>
          )}
          <div className="worker-health__actions">
            <button className="model-settings__button worker-health__button" type="button" onClick={() => void saveYouTubeKey()}>{youtubeStatus === 'empty' ? 'Save YouTube Key' : 'Replace YouTube Key'}</button>
            {youtubeStatus !== 'empty' && <button className="model-settings__button worker-health__button" type="button" onClick={() => void clearYouTube()}>Remove YouTube Key</button>}
            {youtubeStatus === 'unlocked' && <button className="model-settings__button worker-health__button" type="button" onClick={() => void revalidateYouTubeKey()}>Test Key</button>}
          </div>
        </>
      )}

      <p className="worker-health__detail" aria-live="polite">{detail || (status === 'locked' ? `Unlock the encrypted API key before using Gemini. ${pinCapable ? 'The PIN field accepts 6–8 digits.' : 'Enter the Lockbox password.'}` : status === 'unlocked' ? mode === 'off' ? 'Security is off; the API key remains encrypted locally.' : 'The decrypted API key is held only in session memory.' : 'Create the Lockbox to encrypt and store your Gemini API key locally.')}</p>
    </div>
  );
}
