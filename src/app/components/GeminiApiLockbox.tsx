import { useEffect, useRef, useState } from 'react';
import { clearGeminiApiKey, getGeminiApiKey, getGeminiLockboxStatus, lockGeminiApiKey, saveGeminiApiKey, unlockGeminiApiKey } from '../../persistence/gemini-api-key';
import './worker-health.css';

type LockboxState = 'loading' | 'empty' | 'locked' | 'unlocked';

export function GeminiApiLockbox() {
  const [status, setStatus] = useState<LockboxState>('loading');
  const [detail, setDetail] = useState('');
  const keyRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmPasswordRef = useRef<HTMLInputElement>(null);
  const unlockPasswordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void getGeminiLockboxStatus().then(setStatus).catch(() => setStatus('empty'));
  }, []);

  function read(ref: React.RefObject<HTMLInputElement | null>): string {
    return ref.current?.value.trim() ?? '';
  }

  function clearInputs(...refs: Array<React.RefObject<HTMLInputElement | null>>): void {
    for (const ref of refs) {
      if (ref.current) ref.current.value = '';
    }
  }

  async function createLockbox() {
    const key = read(keyRef);
    const password = read(passwordRef);
    const confirmation = read(confirmPasswordRef);
    if (!key) {
      setDetail('Enter the Gemini API key first.');
      return;
    }
    if (password.length < 8) {
      setDetail('Use a Lockbox password of at least 8 characters.');
      return;
    }
    if (password !== confirmation) {
      setDetail('The Lockbox passwords do not match.');
      return;
    }
    try {
      await saveGeminiApiKey(key, password);
      clearInputs(keyRef, passwordRef, confirmPasswordRef);
      setStatus('unlocked');
      setDetail('Encrypted Gemini API key stored in the local Lockbox. Unlocked for this session.');
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Could not create the Gemini API Lockbox.');
    }
  }

  async function unlock() {
    const password = read(unlockPasswordRef);
    if (!password) {
      setDetail('Enter the Lockbox password.');
      return;
    }
    try {
      await unlockGeminiApiKey(password);
      clearInputs(unlockPasswordRef);
      setStatus('unlocked');
      setDetail('Lockbox unlocked for this browser session.');
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Could not unlock the Gemini API Lockbox.');
    }
  }

  function lock() {
    lockGeminiApiKey();
    setStatus('locked');
    setDetail('Lockbox locked. The API key is no longer available to the Gemini client.');
  }

  async function clear() {
    if (!window.confirm('Clear the encrypted Gemini API key from this browser?')) return;
    try {
      await clearGeminiApiKey();
      clearInputs(keyRef, passwordRef, confirmPasswordRef, unlockPasswordRef);
      setStatus('empty');
      setDetail('Encrypted Gemini API key removed from this browser.');
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Could not clear the Gemini API Lockbox.');
    }
  }

  const dataState = status === 'unlocked' ? 'healthy' : status === 'empty' ? 'degraded' : 'unknown';

  return (
    <div className="worker-health" data-state={dataState}>
      <div className="worker-health__header">
        <div>
          <span className="panel-kicker">LOCKBOX</span>
          <h2>Gemini API</h2>
          <p>The API key is encrypted locally in Dexie. The Lockbox password is never stored.</p>
        </div>
        <span className="worker-health__status" role="status" aria-label={`Gemini Lockbox status: ${status}`}>
          <span className="worker-health__dot" aria-hidden="true" />
          {status === 'unlocked' ? 'Unlocked' : status === 'locked' ? 'Locked' : status === 'empty' ? 'Not configured' : 'Loading…'}
        </span>
      </div>

      {status === 'empty' && (
        <>
          <label className="character-field">
            <span>Gemini API key</span>
            <input ref={keyRef} type="password" aria-label="Gemini API key" placeholder="Paste your Gemini API key" autoComplete="off" spellCheck={false} />
          </label>
          <label className="character-field">
            <span>Lockbox password</span>
            <input ref={passwordRef} type="password" aria-label="Lockbox password" placeholder="Create a Lockbox password" autoComplete="new-password" />
          </label>
          <label className="character-field">
            <span>Confirm password</span>
            <input ref={confirmPasswordRef} type="password" aria-label="Confirm Lockbox password" placeholder="Repeat the Lockbox password" autoComplete="new-password" />
          </label>
          <div className="worker-health__actions">
            <button className="model-settings__button worker-health__button" type="button" onClick={() => void createLockbox()}>Create Lockbox</button>
          </div>
        </>
      )}

      {status === 'locked' && (
        <>
          <div className="worker-health__endpoint">Encrypted API key present · key material unavailable until unlock</div>
          <label className="character-field">
            <span>Lockbox password</span>
            <input ref={unlockPasswordRef} type="password" aria-label="Lockbox password" placeholder="Enter your Lockbox password" autoComplete="current-password" onKeyDown={(event) => { if (event.key === 'Enter') void unlock(); }} />
          </label>
          <div className="worker-health__actions">
            <button className="model-settings__button worker-health__button" type="button" onClick={() => void unlock()}>Unlock</button>
            <button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()}>Clear Lockbox</button>
          </div>
        </>
      )}

      {status === 'unlocked' && (
        <>
          <div className="worker-health__endpoint">•••••••••••••••• · encrypted at rest · available only in session memory</div>
          <div className="worker-health__actions">
            <button className="model-settings__button worker-health__button" type="button" onClick={lock}>Lock</button>
            <button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()}>Clear Lockbox</button>
          </div>
        </>
      )}

      <p className="worker-health__detail" aria-live="polite">{detail || (status === 'locked' ? 'Unlock the encrypted API key before using Gemini.' : status === 'unlocked' ? 'The decrypted API key is held only in session memory.' : 'Create the Lockbox to encrypt and store your Gemini API key locally.')}</p>
    </div>
  );
}
