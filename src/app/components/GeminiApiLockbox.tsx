import { useEffect, useState } from 'react';
import { clearGeminiApiKey, getGeminiApiKey, maskGeminiApiKey, saveGeminiApiKey } from '../../persistence/gemini-api-key';
import './worker-health.css';

export function GeminiApiLockbox() {
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<'loading' | 'empty' | 'stored'>('loading');
  const [showKey, setShowKey] = useState(false);
  const [detail, setDetail] = useState('');

  useEffect(() => {
    void getGeminiApiKey().then((value) => {
      setKey(value);
      setStatus(value ? 'stored' : 'empty');
    });
  }, []);

  async function save() {
    try {
      await saveGeminiApiKey(key);
      setKey(key.trim());
      setStatus(key.trim() ? 'stored' : 'empty');
      setDetail(key.trim() ? 'Gemini API key stored locally in this browser.' : 'Gemini API key cleared.');
    } catch (error) {
      setDetail(error instanceof Error ? error.message : 'Could not save the Gemini API key.');
    }
  }

  async function clear() {
    await clearGeminiApiKey();
    setKey('');
    setStatus('empty');
    setShowKey(false);
    setDetail('Gemini API key removed from this browser.');
  }

  return (
    <div className="worker-health" data-state={status === 'stored' ? 'healthy' : status === 'empty' ? 'degraded' : 'unknown'}>
      <div className="worker-health__header">
        <div>
          <span className="panel-kicker">LOCKBOX</span>
          <h2>Gemini API</h2>
          <p>The app connects directly to Gemini. No Cloudflare Gemini Worker is used for model requests.</p>
        </div>
        <span className="worker-health__status" role="status" aria-label={`Gemini API key status: ${status}`}>
          <span className="worker-health__dot" aria-hidden="true" />
          {status === 'stored' ? 'Configured' : status === 'empty' ? 'Not configured' : 'Loading…'}
        </span>
      </div>
      <div className="worker-health__endpoint">
        {status === 'stored' ? maskGeminiApiKey(key) : 'No Gemini API key stored'}
      </div>
      <label className="character-field">
        <span>Gemini API key</span>
        <input
          value={showKey ? key : (key ? maskGeminiApiKey(key) : '')}
          aria-label="Gemini API key"
          placeholder="Paste your Gemini API key"
          autoComplete="off"
          spellCheck={false}
          onFocus={() => setShowKey(true)}
          onChange={(event) => setKey(event.target.value)}
        />
      </label>
      <div className="worker-health__actions">
        <button className="model-settings__button worker-health__button" type="button" onClick={() => void save()}>Save key</button>
        <button className="model-settings__button worker-health__button" type="button" onClick={() => setShowKey((value) => !value)}>{showKey ? 'Hide key' : 'Show key'}</button>
        <button className="model-settings__button worker-health__button" type="button" onClick={() => void clear()} disabled={!key}>Clear</button>
      </div>
      <p className="worker-health__detail" aria-live="polite">{detail || 'The key is stored only in this browser and is read when Gemini is called.'}</p>
    </div>
  );
}
