// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SettingsScreen, type SettingsSection } from './SettingsScreen';
import { DEFAULT_APP_UI, DEFAULT_CHAT_APPEARANCE, DEFAULT_ROLEPLAY } from '../../domain/preferences';
import { DEFAULT_CHARACTER_PROFILE } from '../../domain/character';
import { DEFAULT_GEMINI_MODEL } from '../../gemini/contracts';
import { defaultsForModel } from '../../gemini/settings-engine';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

type HarnessProps = { initial: boolean; section?: SettingsSection };

function Harness({ initial, section = 'chat' }: HarnessProps) {
  const [enterToSend, setEnterToSend] = useState(initial);
  return <SettingsScreen
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
  />;
}

function switch_(): HTMLButtonElement { return container.querySelector('[role="switch"]')!; }
function press(key: string): void {
  act(() => { switch_().dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('Chat settings — Enter sends message', () => {
  it('defaults to ON with switch semantics and a real accessible name', () => {
    act(() => { root.render(<Harness initial />); });
    const control = switch_();
    expect(control.getAttribute('role')).toBe('switch');
    expect(control.getAttribute('type')).toBe('button');
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(control.classList.contains('is-on')).toBe(true);

    // Accessible name/description come from the card copy, not from floating text.
    const labelId = control.getAttribute('aria-labelledby');
    const describedId = control.getAttribute('aria-describedby');
    expect(labelId).toBeTruthy();
    expect(container.querySelector(`#${labelId}`)?.textContent).toBe('Enter sends message');
    expect(container.querySelector(`#${describedId}`)?.textContent).toContain('Enter sends');
  });

  it('reports the default as ON when the caller hands over the stored preference', () => {
    act(() => { root.render(<Harness initial={DEFAULT_APP_UI.enterToSend} />); });
    expect(switch_().getAttribute('aria-checked')).toBe('true');
  });

  it('toggles the preference off and back on', () => {
    act(() => { root.render(<Harness initial />); });
    act(() => { switch_().click(); });
    expect(switch_().getAttribute('aria-checked')).toBe('false');
    expect(switch_().classList.contains('is-on')).toBe(false);
    expect(container.textContent).toContain('Enter inserts a new line');

    act(() => { switch_().click(); });
    expect(switch_().getAttribute('aria-checked')).toBe('true');
    expect(container.textContent).toContain('Enter sends');
  });

  it('toggles with the keyboard (Space and Enter, once per press)', () => {
    act(() => { root.render(<Harness initial />); });
    press(' ');
    expect(switch_().getAttribute('aria-checked')).toBe('false');
    press('Enter');
    expect(switch_().getAttribute('aria-checked')).toBe('true');
    press('a');
    expect(switch_().getAttribute('aria-checked')).toBe('true');
  });

  it('hands the new value to the persistence callback exactly once per toggle', () => {
    const onEnterToSendChange = vi.fn();
    act(() => {
      root.render(<SettingsScreen
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
      />);
    });
    act(() => { switch_().click(); });
    expect(onEnterToSendChange).toHaveBeenCalledTimes(1);
    expect(onEnterToSendChange).toHaveBeenCalledWith(false);
  });
});
