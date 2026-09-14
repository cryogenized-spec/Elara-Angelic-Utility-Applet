// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsScreen, type SettingsSection } from './SettingsScreen';
import { DEFAULT_APP_UI, DEFAULT_CHAT_APPEARANCE, DEFAULT_ROLEPLAY } from '../../domain/preferences';
import type { MediaPlaybackPreference } from '../../domain/playback';
import { DEFAULT_CHARACTER_PROFILE } from '../../domain/character';
import { DEFAULT_GEMINI_MODEL } from '../../gemini/contracts';
import { defaultsForModel } from '../../gemini/settings-engine';
import { PlaybackProvider, type PlaybackPreferenceStore } from '../../media/playback/PlaybackProvider';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
let savedPreference: MediaPlaybackPreference;
const savePreference = vi.fn<(value: MediaPlaybackPreference) => void>();

const preferenceStore: PlaybackPreferenceStore = {
  load: async () => savedPreference,
  save: async (value) => {
    savePreference(value);
    savedPreference = value;
    return value;
  },
};

type HarnessProps = { initial: boolean; section?: SettingsSection };

function WithPlayback({ children }: { readonly children: ReactNode }) {
  return <PlaybackProvider preferenceStore={preferenceStore}>{children}</PlaybackProvider>;
}

function Harness({ initial, section = 'chat' }: HarnessProps) {
  const [enterToSend, setEnterToSend] = useState(initial);
  return <WithPlayback><SettingsScreen
    font={DEFAULT_APP_UI.font}
    onFontChange={() => {}}
    chatTextSize={DEFAULT_APP_UI.chatTextSize}
    onChatTextSizeChange={() => {}}
    portraitScale={DEFAULT_APP_UI.portraitScale}
    onPortraitScaleChange={() => {}}
    portraitBackground={DEFAULT_APP_UI.portraitBackground}
    onPortraitBackgroundChange={() => {}}
    selectedModel={DEFAULT_GEMINI_MODEL}
    geminiSettings={defaultsForModel(DEFAULT_GEMINI_MODEL)}
    onModelChange={() => {}}
    onGeminiSettingsChange={() => {}}
    onResetGeminiSettings={() => {}}
    character={DEFAULT_CHARACTER_PROFILE}
    onCharacterChange={() => {}}
    chatAppearance={DEFAULT_CHAT_APPEARANCE}
    onChatAppearanceChange={() => {}}
    roleplay={DEFAULT_ROLEPLAY}
    onRoleplayChange={() => {}}
    enterToSend={enterToSend}
    onEnterToSendChange={setEnterToSend}
    initialSection={section}
    onBack={() => {}}
  /></WithPlayback>;
}

function switch_(): HTMLButtonElement { return container.querySelector('[role="switch"]')!; }
function press(key: string): void {
  act(() => { switch_().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
}

async function waitForPlaybackPreferenceReady(): Promise<HTMLButtonElement[]> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const options = [...container.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
    if (options.length === 3 && options.every((button) => !button.disabled)) return options;
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 0); }); });
  }
  throw new Error('Playback preference did not finish loading in the settings test.');
}

beforeEach(() => {
  savedPreference = 'ask';
  savePreference.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Chat settings — Enter sends message', () => {
  it('defaults to ON with switch semantics and a real accessible name', async () => {
    await act(async () => { root.render(<Harness initial />); await Promise.resolve(); });
    const control = switch_();
    expect(control.getAttribute('role')).toBe('switch');
    expect(control.getAttribute('type')).toBe('button');
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(control.classList.contains('is-on')).toBe(true);

    const labelId = control.getAttribute('aria-labelledby');
    const describedId = control.getAttribute('aria-describedby');
    expect(labelId).toBeTruthy();
    expect(container.querySelector(`#${labelId}`)?.textContent).toBe('Enter sends message');
    expect(container.querySelector(`#${describedId}`)?.textContent).toContain('Enter sends');
  });

  it('reports the default as ON when the caller hands over the stored preference', async () => {
    await act(async () => { root.render(<Harness initial={DEFAULT_APP_UI.enterToSend} />); await Promise.resolve(); });
    expect(switch_().getAttribute('aria-checked')).toBe('true');
  });

  it('toggles the preference off and back on', async () => {
    await act(async () => { root.render(<Harness initial />); await Promise.resolve(); });
    act(() => { switch_().click(); });
    expect(switch_().getAttribute('aria-checked')).toBe('false');
    expect(container.textContent).toContain('Enter inserts a new line');
    act(() => { switch_().click(); });
    expect(switch_().getAttribute('aria-checked')).toBe('true');
  });

  it('toggles with the keyboard (Space and Enter, once per press)', async () => {
    await act(async () => { root.render(<Harness initial />); await Promise.resolve(); });
    press(' ');
    expect(switch_().getAttribute('aria-checked')).toBe('false');
    press('Enter');
    expect(switch_().getAttribute('aria-checked')).toBe('true');
    press('a');
    expect(switch_().getAttribute('aria-checked')).toBe('true');
  });

  it('hands the new value to the persistence callback exactly once per toggle', async () => {
    const onEnterToSendChange = vi.fn();
    await act(async () => {
      root.render(<WithPlayback><SettingsScreen
        font={DEFAULT_APP_UI.font}
        onFontChange={() => {}}
        chatTextSize={DEFAULT_APP_UI.chatTextSize}
        onChatTextSizeChange={() => {}}
        portraitScale={DEFAULT_APP_UI.portraitScale}
        onPortraitScaleChange={() => {}}
        portraitBackground={DEFAULT_APP_UI.portraitBackground}
        onPortraitBackgroundChange={() => {}}
        selectedModel={DEFAULT_GEMINI_MODEL}
        geminiSettings={defaultsForModel(DEFAULT_GEMINI_MODEL)}
        onModelChange={() => {}}
        onGeminiSettingsChange={() => {}}
        onResetGeminiSettings={() => {}}
        character={DEFAULT_CHARACTER_PROFILE}
        onCharacterChange={() => {}}
        chatAppearance={DEFAULT_CHAT_APPEARANCE}
        onChatAppearanceChange={() => {}}
        roleplay={DEFAULT_ROLEPLAY}
        onRoleplayChange={() => {}}
        enterToSend
        onEnterToSendChange={onEnterToSendChange}
        initialSection="chat"
        onBack={() => {}}
      /></WithPlayback>);
      await Promise.resolve();
    });
    act(() => { switch_().click(); });
    expect(onEnterToSendChange).toHaveBeenCalledTimes(1);
    expect(onEnterToSendChange).toHaveBeenCalledWith(false);
  });
});

describe('Chat settings — media playback', () => {
  it('shows all three values from the singular playback preference', async () => {
    await act(async () => { root.render(<Harness initial />); await Promise.resolve(); });
    const options = await waitForPlaybackPreferenceReady();
    expect(options.map((button) => button.textContent)).toEqual(expect.arrayContaining([
      expect.stringContaining('Ask each time'),
      expect.stringContaining('Play here'),
      expect.stringContaining('Open YouTube'),
    ]));
    expect(options.find((button) => button.textContent?.includes('Ask each time'))?.getAttribute('aria-checked')).toBe('true');
  });

  it('persists a new route through PlaybackProvider.setPreference', async () => {
    await act(async () => { root.render(<Harness initial />); await Promise.resolve(); });
    const options = await waitForPlaybackPreferenceReady();
    const playHere = options.find((button) => button.textContent?.includes('Play here'))!;

    await act(async () => { playHere.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(savePreference).toHaveBeenCalledTimes(1);
    expect(savePreference).toHaveBeenCalledWith('embedded');
    expect(playHere.getAttribute('aria-checked')).toBe('true');
  });
});
