import { expect, test, type Page } from '@playwright/test';

async function installVttBrowserMocks(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class MockTrack { stop() {} }

    class MockStream {
      getTracks() { return [new MockTrack()]; }
    }

    class MockMediaRecorder {
      static isTypeSupported(mimeType: string) {
        return mimeType === 'audio/webm;codecs=opus' || mimeType === 'audio/webm';
      }

      state: 'inactive' | 'recording' = 'inactive';
      ondataavailable: ((event: { data: Blob }) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;

      constructor(_stream: unknown, _options?: unknown) {}
      start() { this.state = 'recording'; }
      stop() {
        if (this.state === 'inactive') return;
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([new Uint8Array(3_000)], { type: 'audio/webm;codecs=opus' }) });
        this.onstop?.();
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

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: async () => new MockStream() },
    });
    Object.defineProperty(window, 'MediaRecorder', { configurable: true, value: MockMediaRecorder });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: MockAudioContext });
    Object.defineProperty(navigator, 'vibrate', { configurable: true, value: () => true });
  });
}

async function setSelection(page: Page, name: string, start: number, end: number): Promise<void> {
  await page.getByRole('textbox', { name }).evaluate((element, range) => {
    const textarea = element as HTMLTextAreaElement;
    textarea.focus();
    textarea.setSelectionRange(range.start, range.end);
  }, { start, end });
}

test.describe('VTT composer flow', () => {
  test.beforeEach(async ({ page }) => {
    await installVttBrowserMocks(page);
    await page.route('**/api/transcribe', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ transcript: 'voice inserted' }),
      });
    });
    await page.goto('');
  });

  test('records, transcribes, and inserts at the captured cursor without sending', async ({ page }) => {
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    await composer.fill('hello world');
    await setSelection(page, 'Message Elara', 5, 5);

    await page.getByRole('button', { name: 'VTT voice input' }).click();
    await expect(page.getByRole('button', { name: 'Stop VTT voice input' })).toBeVisible();
    await page.getByRole('button', { name: 'Stop VTT voice input' }).click();

    await expect(composer).toHaveValue('hello voice inserted world');
    await expect(page.getByRole('button', { name: 'VTT voice input' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send message' })).toBeEnabled();
  });

  test('replaces the captured selection', async ({ page }) => {
    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    await composer.fill('hello cruel world');
    await setSelection(page, 'Message Elara', 6, 11);

    await page.getByRole('button', { name: 'VTT voice input' }).click();
    await page.getByRole('button', { name: 'Stop VTT voice input' }).click();

    await expect(composer).toHaveValue('hello voice inserted world');
  });

  test('uses the expanded editor as the insertion target', async ({ page }) => {
    await page.getByRole('textbox', { name: 'Message Elara' }).fill('expanded draft');
    await page.getByRole('button', { name: 'Expand message editor' }).click();

    const expanded = page.getByRole('textbox', { name: 'Expanded message' });
    await expect(expanded).toBeVisible();
    await setSelection(page, 'Expanded message', 8, 8);

    await page.getByRole('button', { name: 'VTT voice input' }).click();
    await page.getByRole('button', { name: 'Stop VTT voice input' }).click();

    await expect(expanded).toHaveValue('expanded voice inserted draft');
    await expect(page.getByRole('textbox', { name: 'Message Elara' })).not.toBeVisible();
  });

  test('cancels an in-flight transcription and leaves the draft unchanged', async ({ page }) => {
    await page.unroute('**/api/transcribe');
    await page.route('**/api/transcribe', async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    });

    const composer = page.getByRole('textbox', { name: 'Message Elara' });
    await composer.fill('keep this draft');
    await setSelection(page, 'Message Elara', 5, 5);

    await page.getByRole('button', { name: 'VTT voice input' }).click();
    await page.getByRole('button', { name: 'Stop VTT voice input' }).click();
    await expect(page.getByRole('button', { name: 'Cancel voice transcription' })).toBeVisible();

    await page.getByRole('button', { name: 'Cancel voice transcription' }).click();
    await expect(composer).toHaveValue('keep this draft');
    await expect(page.getByRole('status')).toContainText('Voice transcription cancelled.');
    await expect(page.getByRole('button', { name: 'VTT voice input' })).toBeVisible();
  });
});
