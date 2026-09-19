// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_APP_UI, DEFAULT_CHAT_APPEARANCE, DEFAULT_ROLEPLAY, type GenerationActivityGlyphs } from '../../domain/preferences';
import { DEFAULT_CHARACTER_PROFILE } from '../../domain/character';
import { DEFAULT_GEMINI_MODEL } from '../../gemini/contracts';
import { defaultsForModel } from '../../gemini/settings-engine';
import { SettingsScreen } from './SettingsScreen';

vi.mock('../../ui/noto-emoji', () => ({
  NOTO_EMOJI_PREVIEW_FAMILY: 'Elara Noto Emoji Preview',
  previewNotoEmoji: vi.fn(async () => true),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => { root.unmount(); });
  container.remove();
  vi.useRealTimers();
});

describe('Settings Generation Activity glyph transaction', () => {
  it('keeps glyph edits local until leaving Settings, then returns one final map', () => {
    const onAppearance = vi.fn();
    const onBack = vi.fn<(glyphs: GenerationActivityGlyphs) => void>();

    act(() => {
      root.render(<SettingsScreen
        font={DEFAULT_APP_UI.font}
        onFontChange={() => undefined}
        chatTextSize={DEFAULT_APP_UI.chatTextSize}
        onChatTextSizeChange={() => undefined}
        portraitScale={DEFAULT_APP_UI.portraitScale}
        onPortraitScaleChange={() => undefined}
        portraitBackground={DEFAULT_APP_UI.portraitBackground}
        onPortraitBackgroundChange={() => undefined}
        selectedModel={DEFAULT_GEMINI_MODEL}
        geminiSettings={defaultsForModel(DEFAULT_GEMINI_MODEL)}
        onModelChange={() => undefined}
        onGeminiSettingsChange={() => undefined}
        onResetGeminiSettings={() => undefined}
        character={DEFAULT_CHARACTER_PROFILE}
        onCharacterChange={() => undefined}
        chatAppearance={DEFAULT_CHAT_APPEARANCE}
        onChatAppearanceChange={onAppearance}
        roleplay={DEFAULT_ROLEPLAY}
        onRoleplayChange={() => undefined}
        enterToSend={DEFAULT_APP_UI.enterToSend}
        onEnterToSendChange={() => undefined}
        onBack={onBack}
      />);
    });

    const memorySelect = container.querySelector<HTMLSelectElement>('#activity-glyph-memory');
    if (!memorySelect) throw new Error('expected Memory glyph selector');
    act(() => {
      memorySelect.value = '♥';
      memorySelect.dispatchEvent(new Event('change', { bubbles: true }));
    });

    expect(onAppearance).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();

    const back = container.querySelector<HTMLButtonElement>('button[aria-label="Back to chat"]');
    if (!back) throw new Error('expected Settings back button');
    act(() => { back.click(); });

    expect(onAppearance).not.toHaveBeenCalled();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onBack.mock.calls[0]?.[0].memory).toBe('♥');
  });
});
