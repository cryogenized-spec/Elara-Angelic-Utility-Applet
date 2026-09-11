// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeminiApiLockbox } from './GeminiApiLockbox';
import {
  clearGeminiApiKey,
  clearYouTubeApiKey,
  disableGeminiLockboxSecurity,
  lockGeminiApiKey,
  saveGeminiApiKey,
  saveYouTubeApiKey,
  unlockGeminiApiKey,
  unlockGeminiApiKeyWithPin,
} from '../../persistence/gemini-api-key';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const GEMINI_KEY = 'test-gemini-key-material';
const YOUTUBE_KEY = 'AIzaSy-test-youtube-data-api-key';
const PASSWORD = 'correct-horse-battery-staple';
const PIN = '284619';

let container: HTMLDivElement;
let root: Root;

async function renderLockbox(): Promise<void> {
  await act(async () => { root.render(<GeminiApiLockbox />); });
  for (let attempt = 0; attempt < 80 && container.textContent?.includes('Loading…'); attempt += 1) {
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 10); }); });
  }
  expect(container.textContent, 'Lockbox screen never left its loading state').not.toContain('Loading…');
}

function youtubeInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[aria-label="YouTube API key"]');
}

function credentialInput(): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>('input[aria-label="Current Lockbox credential for the YouTube key"]');
}

async function quiesce(): Promise<void> {
  let previous = container.textContent ?? '';
  for (let stable = 0, attempt = 0; attempt < 120 && stable < 3; attempt += 1) {
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 10); }); });
    const current = container.textContent ?? '';
    stable = current === previous ? stable + 1 : 0;
    previous = current;
  }
}

async function waitFor(message: string, predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200 && !predicate(); attempt += 1) {
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 10); }); });
  }
  expect(predicate(), message).toBe(true);
}

async function press(label: string): Promise<void> {
  const button = [...container.querySelectorAll('button')].find((node) => node.textContent === label);
  const labels = [...container.querySelectorAll('button')].map((node) => JSON.stringify(node.textContent)).join(', ');
  expect(button, `expected a "${label}" button; found: ${labels}`).toBeTruthy();
  await act(async () => { button!.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  await quiesce();
}

beforeEach(async () => {
  await clearGeminiApiKey();
  await clearYouTubeApiKey();
  window.localStorage.clear();
  window.sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.restoreAllMocks();
});

describe('YouTube credential in the Lockbox screen', () => {
  it('keeps the YouTube controls hidden until the Lockbox is unlocked', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    lockGeminiApiKey();

    await renderLockbox();

    expect(youtubeInput()).toBeNull();
    expect(container.textContent).toContain('Locked');
  });

  it('offers the YouTube controls once the shared Lockbox is open', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);
    lockGeminiApiKey();
    await unlockGeminiApiKey(PASSWORD);

    await renderLockbox();

    expect(youtubeInput()).toBeTruthy();
    expect(container.textContent).toContain('YouTube Data API · configured · unlocked');
  });

  it('never renders the stored YouTube key back into the page', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);
    lockGeminiApiKey();
    await unlockGeminiApiKey(PASSWORD);

    await renderLockbox();

    expect(youtubeInput()!.value).toBe('');
    expect(container.textContent).not.toContain(YOUTUBE_KEY);
    expect(container.innerHTML).not.toContain(YOUTUBE_KEY);
    expect(container.textContent).not.toContain('AIzaSy-test');
  });

  it('saves a pasted YouTube key against the current Lockbox credential', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await unlockGeminiApiKey(PASSWORD);
    await renderLockbox();

    expect(container.textContent).toContain('YouTube Data API · not configured');

    youtubeInput()!.value = YOUTUBE_KEY;
    credentialInput()!.value = PASSWORD;

    await press('Save YouTube Key');

    await waitFor('the saved YouTube key did not show as configured', () => container.textContent!.includes('YouTube Data API · configured · unlocked'));
    await waitFor('the write-only YouTube key field was not cleared', () => youtubeInput()?.value === '');
    await waitFor('the write-only credential field was not cleared', () => credentialInput()?.value === '');
    expect(container.textContent).toContain('YouTube Data API · configured · unlocked');
    expect(container.innerHTML).not.toContain(YOUTUBE_KEY);
  });

  it('refuses to store a YouTube key without the Lockbox credential', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await unlockGeminiApiKey(PASSWORD);
    await renderLockbox();

    youtubeInput()!.value = YOUTUBE_KEY;

    await press('Save YouTube Key');

    await waitFor('the missing-credential warning did not appear', () => container.textContent!.includes('Enter your current Lockbox password to encrypt the YouTube key.'));
    expect(container.textContent).toContain('Enter your current Lockbox password to encrypt the YouTube key.');
    expect(container.textContent).toContain('YouTube Data API · not configured');
  });

  it('asks for the Lockbox password while the Lockbox is password-protected', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await unlockGeminiApiKey(PASSWORD);
    await renderLockbox();

    const field = credentialInput();
    expect(field).toBeTruthy();
    expect(field!.placeholder).toBe('Current password');
    expect(field!.getAttribute('inputmode')).toBeNull();
  });

  it('asks for a numeric PIN once the Lockbox is PIN-protected', async () => {
    const { configureGeminiApiKeyWithPin } = await import('../../persistence/gemini-api-key');
    await configureGeminiApiKeyWithPin(GEMINI_KEY, PIN);
    await unlockGeminiApiKeyWithPin(PIN);
    await renderLockbox();

    const field = credentialInput();
    expect(field).toBeTruthy();
    expect(field!.placeholder).toBe('Current PIN');
    expect(field!.getAttribute('inputmode')).toBe('numeric');
  });

  it('drops the credential field entirely while Lockbox security is off', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);
    await disableGeminiLockboxSecurity();

    await renderLockbox();

    expect(youtubeInput()).toBeTruthy();
    expect(credentialInput()).toBeNull();
    expect(container.textContent).toContain('YouTube Data API · configured · unlocked');
  });

  it('reports a credential mismatch without exposing the stored value', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, 'a-completely-different-passphrase');
    lockGeminiApiKey();
    await unlockGeminiApiKey(PASSWORD);

    await renderLockbox();

    expect(container.textContent).toContain('saved under a different credential');
    expect(container.textContent).toContain('Replace YouTube Key');
    expect(container.innerHTML).not.toContain(YOUTUBE_KEY);
  });

  it('confirms before removing the YouTube credential', async () => {
    await saveGeminiApiKey(GEMINI_KEY, PASSWORD);
    await saveYouTubeApiKey(YOUTUBE_KEY, PASSWORD);
    await unlockGeminiApiKey(PASSWORD);
    await renderLockbox();

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    await press('Remove YouTube Key');

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('YouTube Data API · configured · unlocked');
  });
});
