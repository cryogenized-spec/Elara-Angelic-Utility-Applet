import { expect, test, type Page } from '@playwright/test';

function transformationSse(text: string, interactionId = 'transform-int-1'): string {
  return [
    `event: interaction.created\ndata: ${JSON.stringify({ event_type: 'interaction.created', interaction: { id: interactionId, status: 'in_progress', model: 'gemini-3.8-flash' } })}`,
    `event: step.delta\ndata: ${JSON.stringify({ event_type: 'step.delta', interaction_id: interactionId, index: 0, delta: { type: 'text', text } })}`,
    `event: interaction.completed\ndata: ${JSON.stringify({ event_type: 'interaction.completed', interaction: { id: interactionId, status: 'completed' } })}`,
  ].join('\n\n') + '\n\n';
}

async function installVttBrowserMocks(page: Page, interactionMode: 'default' | 'transform' = 'default'): Promise<void> {
  await page.addInitScript(() => {
    class MockTrack { stop() {} }
    class MockStream { getTracks() { return [new MockTrack()]; } }
    class MockMediaRecorder {
      static isTypeSupported(mimeType: string) { return mimeType === 'audio/webm;codecs=opus' || mimeType === 'audio/webm'; }
      state: 'inactive' | 'recording' = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;
      constructor(_stream: unknown, _options?: unknown) {}
      start() { this.state = 'recording'; }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        window.setTimeout(() => {
          this.ondataavailable?.({ data: new Blob([new Uint8Array(3_000)], { type: 'audio/webm;codecs=opus' }) });
          this.onstop?.();
        }, 650);
      }
    }
    class MockAnalyser {
      fftSize = 256;
      getByteTimeDomainData(data: Uint8Array) { data.fill(128); }
    }
    class MockAudioContext {
      createMediaStreamSource(_stream: unknown) { return { connect() {} }; }
      createAnalyser() { return new MockAnalyser(); }
      close() { return Promise.resolve(); }
    }
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => new MockStream() } });
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: MockMediaRecorder });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: MockAudioContext });
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => true });
  });

  await page.goto('');
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await page.getByRole('button', { name: 'Open settings' }).click();
  await page.getByRole('button', { name: 'Lockbox' }).click();
  await page.getByLabel('Gemini API key').fill('e2e-test-api-key');
  await page.getByRole('textbox', { name: 'Lockbox password', exact: true }).fill('e2e-test-password');
  await page.getByLabel('Confirm Lockbox password').fill('e2e-test-password');
  await page.getByRole('button', { name: 'Create Lockbox' }).click();
  await expect(page.getByRole('status', { name: 'Gemini Lockbox status: unlocked' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to chat' }).click();

  await page.route('**/upload/v1beta/files*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ name: 'files/e2e-audio', uri: 'https://generativelanguage.googleapis.com/v1beta/files/e2e-audio', mimeType: 'audio/webm' }),
    });
  });

  await page.route('**/v1beta/interactions*', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
    if (body.model === 'gemini-3.5-transcribe') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'transcription-int-1', status: 'completed', output_text: 'voice inserted' }),
      });
      return;
    }
    const output = interactionMode === 'transform' ? 'A clear, straightforward message.' : 'voice inserted';
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: transformationSse(output) });
  });
}

async function setSelection(page: Page, name: string, start: number, end: number): Promise<void> {
  await page.getByRole('textbox', { name }).evaluate((element, range) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(range.start, range.end);
  }, { start, end });
}

async function stopRecording(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Stop VTT voice input' })).toBeVisible();
  await page.getByRole('button', { name: 'Stop VTT voice input' }).click();
}

async function openVttModeMenu(page: Page): Promise<void> {
  const mic = page.getByRole('button', { name: 'VTT voice input' });
  const box = await mic.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await expect(page.getByRole('menu', { name: 'Voice transcript mode' })).toBeVisible();
  await page.mouse.up();
}

test.describe('VTT composer flow', () => {
  test('records, transcribes, and inserts at the captured cursor without sending', async ({ page }) => {
    await installVttBrowserMocks(page);
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    await composer.fill('hello world');
    await setSelection(page, 'Message Elara', 5, 5);
    await page.getByRole('button', { name: 'VTT voice input' }).click();
    await stopRecording(page);
    await expect(composer).toHaveValue('hello voice inserted world');
    await expect(composer).toBeFocused();
  });

  test('opens the voice mode picker only after a 300ms long press', async ({ page }) => {
    await installVttBrowserMocks(page);
    await openVttModeMenu(page);
    const menu = page.getByRole('menu', { name: 'Voice transcript mode' });
    await expect(menu.getByRole('menuitemradio', { name: 'Raw', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByRole('button', { name: 'Stop VTT voice input' })).toHaveCount(0);
    await menu.getByRole('menuitemradio', { name: 'Polish', exact: true }).click();
    await expect(page.getByRole('menu', { name: 'Voice transcript mode' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'VTT voice input' })).toHaveAttribute('data-vtt-mode', 'polish');
  });

  test('replaces the captured selection', async ({ page }) => {
    await installVttBrowserMocks(page);
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    await composer.fill('hello cruel world');
    await setSelection(page, 'Message Elara', 6, 11);
    await page.getByRole('button', { name: 'VTT voice input' }).click();
    await stopRecording(page);
    await expect(composer).toHaveValue('hello voice inserted world');
  });

  test('uses the expanded editor as the insertion target', async ({ page }) => {
    await installVttBrowserMocks(page);
    await page.getByRole('textbox', { name: 'Message Elara' }).fill('expanded draft');
    await page.getByRole('button', { name: 'Expand message editor' }).click();
    const expanded = page.getByRole('textbox', { name: 'Expanded message' });
    await expect(expanded).toBeVisible();
    await setSelection(page, 'Expanded message', 8, 8);
    await page.getByRole('button', { name: 'VTT voice input' }).click();
    await stopRecording(page);
    await expect(expanded).toHaveValue('expanded voice inserted draft');
    await expect(expanded).toBeFocused();
  });

  test('supports repeated dictation at the caret left by the prior insertion', async ({ page }) => {
    await installVttBrowserMocks(page);
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    await composer.fill('start');
    for (const expected of ['start voice inserted', 'start voice inserted voice inserted', 'start voice inserted voice inserted voice inserted']) {
      await page.getByRole('button', { name: 'VTT voice input' }).click();
      await stopRecording(page);
      await expect(composer).toHaveValue(expected);
      await expect(composer).toBeFocused();
    }
  });

  test('polishes a transcript through the direct Gemini boundary before insertion', async ({ page }) => {
    await installVttBrowserMocks(page, 'transform');
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    await openVttModeMenu(page);
    await page.getByRole('menuitemradio', { name: 'Polish', exact: true }).click();
    await composer.fill('draft: ');
    await page.getByRole('button', { name: 'VTT voice input' }).click();
    await stopRecording(page);
    await expect(composer).toHaveValue('draft: A clear, straightforward message.');
  });

  test('falls back to the raw transcript when transformation fails', async ({ page }) => {
    await installVttBrowserMocks(page);
    await page.unroute('**/v1beta/interactions*');
    await page.route('**/v1beta/interactions*', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      if (body.model === 'gemini-3.5-transcribe') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'transcription-int-1', status: 'completed', output_text: 'voice inserted' }) });
      } else {
        await route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ message: 'Transformation unavailable.' }) });
      }
    });
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    await openVttModeMenu(page);
    await page.getByRole('menuitemradio', { name: 'Roleplay', exact: true }).click();
    await composer.fill('draft ');
    await page.getByRole('button', { name: 'VTT voice input' }).click();
    await stopRecording(page);
    await expect(composer).toHaveValue('draft voice inserted');
    await expect(page.getByRole('status')).toContainText('Transformation failed; inserted the raw transcript.');
  });

  test('reports microphone denial without changing the draft', async ({ page }) => {
    await installVttBrowserMocks(page);
    await page.evaluate(() => Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => { throw new DOMException('Permission denied', 'NotAllowedError'); } } }));
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    await composer.fill('permission draft');
    await page.getByRole('button', { name: 'VTT voice input' }).click();
    await expect(page.getByRole('status')).toContainText('Permission denied');
    await expect(composer).toHaveValue('permission draft');
  });

  test('reports an empty transcript without altering the draft', async ({ page }) => {
    await installVttBrowserMocks(page);
    await page.unroute('**/v1beta/interactions*');
    await page.route('**/v1beta/interactions*', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      if (body.model === 'gemini-3.5-transcribe') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'transcription-int-1', status: 'completed', output_text: '   ' }) });
      } else {
        await route.fulfill({ status: 200, contentType: 'text/event-stream', body: transformationSse('voice inserted') });
      }
    });
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    await composer.fill('silent draft');
    await page.getByRole('button', { name: 'VTT voice input' }).click();
    await stopRecording(page);
    await expect(page.getByRole('status')).toContainText('No speech detected.');
    await expect(composer).toHaveValue('silent draft');
  });

  test('cancels an in-flight transcription and leaves the draft unchanged', async ({ page }) => {
    await installVttBrowserMocks(page);
    await page.unroute('**/v1beta/interactions*');
    await page.route('**/v1beta/interactions*', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      if (body.model === 'gemini-3.5-transcribe') await new Promise((resolve) => setTimeout(resolve, 2_000));
      else await route.fulfill({ status: 200, contentType: 'text/event-stream', body: transformationSse('voice inserted') });
    });
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    await composer.fill('keep this draft');
    await setSelection(page, 'Message Elara', 5, 5);
    await page.getByRole('button', { name: 'VTT voice input' }).click();
    await stopRecording(page);
    await expect(page.getByRole('button', { name: 'Cancel voice transcription' })).toBeVisible();
    await page.getByRole('button', { name: 'Cancel voice transcription' }).click();
    await expect(composer).toHaveValue('keep this draft');
    await expect(page.getByRole('status')).toContainText('Voice processing cancelled.');
  });
});
