import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import type { ChatMessage, ConversationState, ConversationThread, ProviderStatus } from '../domain/chat';
import { DEFAULT_CHARACTER_PROFILE, type CharacterProfile } from '../domain/character';
import { DEFAULT_CHAT_APPEARANCE, DEFAULT_ROLEPLAY, type ChatAppearancePreferences, type RoleplayPreferences } from '../domain/preferences';
import { appendMessage, archiveThread, createThread, deleteThread, loadConversation, loadGeminiSettings, loadThreads, renameThread, saveConversation, saveGeminiSettings, type StoredGeminiSettings } from '../persistence/conversation';
import { ensureWorkspaceShortcuts, workspaceShortcutDefinition, type StoredWorkspaceShortcut } from '../persistence/workspace-shortcuts';
import { loadCharacterProfile, saveCharacterProfile } from '../persistence/character';
import { completeOnboarding, hasCompletedOnboarding, loadChatAppearance, loadRoleplayPreferences, saveChatAppearance, saveRoleplayPreferences } from '../persistence/preferences';
import { demoThreadTitlePort } from '../chat/thread-title-port';
import { geminiTurnPort } from '../gemini/provider';
import { streamGoogleToolLoop } from '../gemini/google-tool-loop';
import { DEFAULT_GEMINI_MODEL, type GeminiStreamEvent } from '../gemini/contracts';
import type { GoogleToolName } from '../google/tools/contracts';
import { googleGeminiFunctionNames } from '../google/tools/gemini-declarations';
import { defaultsForModel, effectiveGeminiSettings, normalizeGeminiSettings, type GeminiSettings } from '../gemini/settings-engine';
import { getGeminiModel } from '../gemini/model-registry';
import { Icon } from '../ui/icons';
import { fontFamilyForCss, type FontSelection } from '../ui/fontRegistry';
import { useVisualViewport } from '../ui/useVisualViewport';
import { Sidebar } from './components/Sidebar';
import { SettingsScreen } from './components/SettingsScreen';
import { TopToolRail } from './components/TopToolRail';
import { PortraitBanner } from './components/PortraitBanner';
import { ConversationSurface } from './components/ConversationSurface';
import { Composer } from './components/Composer';
import { FirstRunWelcome } from './components/FirstRunWelcome';
import type { WorkspaceShortcutDefinition } from './quick-actions/shortcuts';
import { DEFAULT_QUICK_ACTIONS } from './quick-actions/defaults';
import '../ui/fonts.css';
import './app.css';
import './mobile-viewport.css';
import './quick-action-rail.css';
import './components/composer-layout.css';
import './button-polish.css';

const ACTIVE_THREAD_KEY = 'elara.active-thread';
const DEFAULT_TITLE = 'New conversation';
const DEFAULT_GEMINI_TOOLS = googleGeminiFunctionNames() as readonly GoogleToolName[];
const makeMessage = (role: ChatMessage['role'], text: string, conversationId: string): ChatMessage => ({ id: `${role}-${crypto.randomUUID()}`, role, text, conversationId, createdAt: Date.now() });

function backgroundValue(preferences: ChatAppearancePreferences): string {
  if (preferences.chatBackgroundMode === 'gradient') {
    if (preferences.chatBackgroundValue === 'violet') return 'linear-gradient(135deg,#0a0a14,#241b37)';
    if (preferences.chatBackgroundValue === 'rose') return 'linear-gradient(135deg,#10090f,#2a1725)';
    return 'linear-gradient(135deg,#070914,#14172a)';
  }
  return preferences.chatBackgroundMode === 'image' ? `url(${preferences.chatBackgroundValue})` : preferences.chatBackgroundValue;
}

function masterCharacterInstruction(character: CharacterProfile): string {
  return character.systemInstruction;
}

export function App() {
  const [conversation, setConversation] = useState<ConversationState>({ id: 'primary', title: DEFAULT_TITLE, createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<ProviderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [firstRunWelcomeOpen, setFirstRunWelcomeOpen] = useState(false);
  const [workspaceShortcuts, setWorkspaceShortcuts] = useState<StoredWorkspaceShortcut[]>([]);
  const [font, setFont] = useState<FontSelection>({ kind: 'built-in', family: 'Inter' });
  const [fontSize, setFontSize] = useState(15);
  const [portraitScale, setPortraitScale] = useState<1 | 2 | 3>(2);
  const [portraitBackground, setPortraitBackground] = useState<'midnight' | 'blue-hour' | 'violet' | 'rose'>('midnight');
  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_MODEL);
  const [geminiPerModelSettings, setGeminiPerModelSettings] = useState<Record<string, GeminiSettings>>({ [DEFAULT_GEMINI_MODEL]: defaultsForModel(DEFAULT_GEMINI_MODEL) });
  const [character, setCharacter] = useState<CharacterProfile>(DEFAULT_CHARACTER_PROFILE);
  const [chatAppearance, setChatAppearance] = useState<ChatAppearancePreferences>(DEFAULT_CHAT_APPEARANCE);
  const [roleplay, setRoleplay] = useState<RoleplayPreferences>(DEFAULT_ROLEPLAY);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeConversationIdRef = useRef('primary');

  useVisualViewport();

  useEffect(() => {
    let cancelled = false;
    const initialActiveConversationId = activeConversationIdRef.current;
    void (async () => {
      try {
        const [loadedThreads, savedGeminiSettings, loadedCharacter, loadedAppearance, loadedRoleplay, loadedShortcuts, onboardingComplete] = await Promise.all([loadThreads(), loadGeminiSettings(), loadCharacterProfile(), loadChatAppearance(), loadRoleplayPreferences(), ensureWorkspaceShortcuts(), hasCompletedOnboarding()]);
        const storedActive = window.localStorage.getItem(ACTIVE_THREAD_KEY);
        const activeId = storedActive && loadedThreads.some((thread) => thread.id === storedActive) ? storedActive : (loadedThreads[0]?.id ?? 'primary');
        const loadedConversation = await loadConversation(activeId);
        if (cancelled || activeConversationIdRef.current !== initialActiveConversationId) return;
        activeConversationIdRef.current = activeId;
        setThreads(loadedThreads); setConversation(loadedConversation); setGeminiModel(savedGeminiSettings.model); setGeminiPerModelSettings(savedGeminiSettings.perModel); setCharacter(loadedCharacter); setChatAppearance(loadedAppearance); setRoleplay(loadedRoleplay); setWorkspaceShortcuts(loadedShortcuts);
        setFirstRunWelcomeOpen(!onboardingComplete);
        window.localStorage.setItem(ACTIVE_THREAD_KEY, activeId);
      } catch { if (!cancelled) setError('Could not load the local application settings.'); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => abortControllerRef.current?.abort(), []);
  async function refreshThreads() { setThreads(await loadThreads()); }
  async function switchThread(id: string) {
    cancel();
    activeConversationIdRef.current = id;
    setError(null); setDraft('');
    try {
      const nextConversation = await loadConversation(id);
      if (activeConversationIdRef.current !== id) return;
      setConversation((current) => activeConversationIdRef.current === id ? nextConversation : current); window.localStorage.setItem(ACTIVE_THREAD_KEY, id); await refreshThreads();
    } catch (cause) { if (activeConversationIdRef.current === id) setError(cause instanceof Error ? cause.message : 'Could not open that conversation.'); }
  }
  async function startNewChat() {
    cancel();
    const pendingConversation: ConversationState = { id: `pending-${crypto.randomUUID()}`, title: DEFAULT_TITLE, createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    activeConversationIdRef.current = pendingConversation.id;
    setError(null); setDraft('');
    setConversation(pendingConversation);
    try {
      const nextConversation = await createThread();
      if (activeConversationIdRef.current !== pendingConversation.id) return;
      activeConversationIdRef.current = nextConversation.id;
      setConversation(nextConversation); window.localStorage.setItem(ACTIVE_THREAD_KEY, nextConversation.id); await refreshThreads(); setSidebarOpen(false);
    } catch (cause) { if (activeConversationIdRef.current === pendingConversation.id) { activeConversationIdRef.current = ''; setError(cause instanceof Error ? cause.message : 'Could not create a new conversation.'); } }
  }

  async function send() {
    const text = draft.trim();
    if (!text || status === 'streaming' || !conversation.id || !activeConversationIdRef.current) return;
    const systemInstruction = masterCharacterInstruction(character);
    setDraft(''); setError(null); setStatus('streaming');
    const controller = new AbortController(); abortControllerRef.current = controller; const conversationId = conversation.id;
    const selectedSettings = geminiPerModelSettings[geminiModel] ?? defaultsForModel(geminiModel);
    const generationConfig = effectiveGeminiSettings(geminiModel, selectedSettings);
    try {
      const userMessage = makeMessage('user', text, conversationId); const withUser = await appendMessage(userMessage, conversationId); if (controller.signal.aborted || activeConversationIdRef.current !== conversationId) return;
      let titled = withUser;
      if (withUser.title === DEFAULT_TITLE) { try { const generatedTitle = await demoThreadTitlePort.generateTitle(text); titled = { ...withUser, title: generatedTitle, updatedAt: Date.now() }; await saveConversation(titled); } catch {} }
      if (controller.signal.aborted || activeConversationIdRef.current !== conversationId) return;
      setConversation((current) => activeConversationIdRef.current === conversationId ? titled : current); await refreshThreads();
      if (activeConversationIdRef.current !== conversationId) return;
      await streamAssistantTurn(text, titled, conversationId, controller, { systemInstruction, generationConfig, tools: DEFAULT_GEMINI_TOOLS, responseGroupId: userMessage.id, responseVariant: 1 });
    } catch (cause) {
      if (activeConversationIdRef.current !== conversationId) return;
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) { setStatus('idle'); return; }
      setStatus('failed'); setError(cause instanceof Error ? cause.message : 'The response failed.');
    } finally { if (abortControllerRef.current === controller) abortControllerRef.current = null; }
  }

  async function regenerate(messageId: string) {
    if (status === 'streaming') return;
    const targetIndex = conversation.messages.findIndex((message) => message.id === messageId);
    const target = targetIndex >= 0 ? conversation.messages[targetIndex] : undefined;
    if (!target || target.role !== 'assistant') return;

    let groupId = target.responseGroupId;
    let workingConversation = conversation;
    if (!groupId) {
      groupId = target.id;
      const promoted: ConversationState = {
        ...conversation,
        updatedAt: Date.now(),
        messages: conversation.messages.map((message) => message.id === target.id ? { ...message, responseGroupId: groupId, responseVariant: 1 } : message),
      };
      workingConversation = promoted;
      setConversation(promoted);
      try { await saveConversation(promoted); await refreshThreads(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not prepare that response for regeneration.'); return; }
    }

    const prompt = [...workingConversation.messages.slice(0, targetIndex)].reverse().find((message) => message.role === 'user');
    if (!prompt) { setError('Could not find the original user prompt for this response.'); return; }
    const promptIndex = workingConversation.messages.findIndex((message) => message.id === prompt.id);
    const previousInteractionId = promptIndex >= 0
      ? [...workingConversation.messages.slice(0, promptIndex)].reverse().find((message) => message.role === 'assistant' && message.providerTurn)?.providerTurn?.interactionId
      : undefined;
    const nextVariant = workingConversation.messages.filter((message) => message.role === 'assistant' && (message.responseGroupId ?? message.id) === groupId).length + 1;
    const selectedSettings = geminiPerModelSettings[geminiModel] ?? defaultsForModel(geminiModel);
    const generationConfig = effectiveGeminiSettings(geminiModel, selectedSettings);
    const systemInstruction = masterCharacterInstruction(character);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setError(null); setStatus('streaming');
    try {
      await streamAssistantTurn(prompt.text, workingConversation, workingConversation.id, controller, { systemInstruction, generationConfig, tools: DEFAULT_GEMINI_TOOLS, previousInteractionId, responseGroupId: groupId, responseVariant: nextVariant });
    } catch (cause) {
      if (activeConversationIdRef.current !== workingConversation.id) return;
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) { setStatus('idle'); return; }
      setStatus('failed'); setError(cause instanceof Error ? cause.message : 'The regenerated response failed.');
    } finally { if (abortControllerRef.current === controller) abortControllerRef.current = null; }
  }

  async function runWorkspaceShortcut(shortcutRecord: StoredWorkspaceShortcut) {
    if (status === 'streaming') return;
    const shortcut = workspaceShortcutDefinition(shortcutRecord);
    if (!shortcutRecord.enabled) return;
    setError(null); setStatus('streaming');
    const controller = new AbortController(); abortControllerRef.current = controller; const conversationId = conversation.id;
    const selectedSettings = geminiPerModelSettings[geminiModel] ?? defaultsForModel(geminiModel);
    const generationConfig = effectiveGeminiSettings(geminiModel, selectedSettings);
    const systemInstruction = masterCharacterInstruction(character);
    const hiddenTask = `Execute the saved Workspace shortcut “${shortcut.label}”.\nUser intent: ${shortcut.intent}\nUse only the registered tools supplied for this shortcut.`;
    try {
      await streamAssistantTurn(hiddenTask, conversation, conversationId, controller, { systemInstruction, generationConfig, tools: shortcut.tools });
    } catch (cause) {
      if (activeConversationIdRef.current !== conversationId) return;
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) { setStatus('idle'); return; }
      setStatus('failed'); setError(cause instanceof Error ? cause.message : `The ${shortcut.label} shortcut failed.`);
    } finally { if (abortControllerRef.current === controller) abortControllerRef.current = null; }
  }

  async function streamAssistantTurn(input: string, baseConversation: ConversationState, conversationId: string, controller: AbortController, options: { systemInstruction: string; generationConfig: Record<string, unknown>; tools?: readonly GoogleToolName[]; previousInteractionId?: string; responseGroupId?: string; responseVariant?: number }) {
    if (activeConversationIdRef.current !== conversationId || controller.signal.aborted) return;
    const previousInteractionId = options.previousInteractionId ?? [...baseConversation.messages].reverse().find((message) => message.role === 'assistant' && message.providerTurn)?.providerTurn?.interactionId;
    const assistantMessage = { ...makeMessage('assistant', '', conversationId), responseGroupId: options.responseGroupId, responseVariant: options.responseVariant } satisfies ChatMessage;
    const liveText = { value: '' }; const startedAt = Date.now();
    const base = { ...baseConversation, messages: [...baseConversation.messages, assistantMessage], updatedAt: startedAt };
    if (activeConversationIdRef.current !== conversationId) return;
    setConversation((current) => activeConversationIdRef.current === conversationId ? base : current);
    const isCurrentConversation = () => activeConversationIdRef.current === conversationId;

    if (options.tools?.length) {
      const request = { model: geminiModel, input, previousInteractionId, generationConfig: options.generationConfig, systemInstruction: options.systemInstruction, tools: options.tools };
      for await (const event of streamGoogleToolLoop(request, { tools: options.tools, readOnly: false }, controller.signal)) {
        handleStreamEvent(event, { assistantMessage, base, setConversation, setStatus, setError, save: saveConversation, refreshThreads, startedAt, model: geminiModel, liveText, isCurrentConversation });
        if (event.type === 'interaction-created') liveText.value = '';
        if (event.type === 'cancelled') return;
      }
    } else {
      const request = { model: geminiModel, input, previousInteractionId, generationConfig: options.generationConfig, systemInstruction: options.systemInstruction };
      for await (const event of geminiTurnPort.streamReply(request, controller.signal)) {
        handleStreamEvent(event, { assistantMessage, base, setConversation, setStatus, setError, save: saveConversation, refreshThreads, startedAt, model: geminiModel, liveText, isCurrentConversation });
        if (event.type === 'interaction-created') liveText.value = '';
        if (event.type === 'cancelled') return;
      }
    }
    if (!controller.signal.aborted && isCurrentConversation()) setStatus('idle');
  }

  function cancel() { abortControllerRef.current?.abort(); setStatus('idle'); setError(null); }
  async function handleRename(id: string, title: string) { try { await renameThread(id, title); await refreshThreads(); if (id === conversation.id && activeConversationIdRef.current === id) setConversation((current) => ({ ...current, title })); } catch (cause) { if (activeConversationIdRef.current === id) setError(cause instanceof Error ? cause.message : 'Could not rename that thread.'); } }
  async function handleArchive(id: string) { try { await archiveThread(id); await refreshThreads(); if (id === conversation.id) await startNewChat(); } catch (cause) { if (activeConversationIdRef.current === id) setError(cause instanceof Error ? cause.message : 'Could not archive that conversation.'); } }
  async function handleDelete(id: string) { if (!window.confirm('Delete this conversation? This removes its local messages.')) return; try { await deleteThread(id); await refreshThreads(); if (id === conversation.id) await startNewChat(); } catch (cause) { if (activeConversationIdRef.current === id) setError(cause instanceof Error ? cause.message : 'Could not delete that conversation.'); } }
  async function handleQuickShortcut(shortcut: WorkspaceShortcutDefinition) { const record = workspaceShortcuts.find((item) => item.id === shortcut.id); if (!record) { setError('That Workspace shortcut is not available.'); return; } await runWorkspaceShortcut(record); }
  async function handleModelChange(model: string) { const definition = getGeminiModel(model); const settings = normalizeGeminiSettings(model, geminiPerModelSettings[model] ?? defaultsForModel(model)); const nextMap = { ...geminiPerModelSettings, [definition.id]: settings }; setGeminiModel(definition.id); setGeminiPerModelSettings(nextMap); try { const saved: StoredGeminiSettings = await saveGeminiSettings(definition.id, settings, nextMap); setGeminiPerModelSettings(saved.perModel); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save Gemini model settings.'); } }
  async function handleGeminiSettingsChange(settings: GeminiSettings) { const normalized = normalizeGeminiSettings(geminiModel, settings); const nextMap = { ...geminiPerModelSettings, [geminiModel]: normalized }; setGeminiPerModelSettings(nextMap); try { const saved = await saveGeminiSettings(geminiModel, normalized, nextMap); setGeminiPerModelSettings(saved.perModel); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save Gemini settings.'); } }
  async function handleResetGeminiSettings() { await handleGeminiSettingsChange(defaultsForModel(geminiModel)); }
  async function handleCharacterChange(next: CharacterProfile) { setCharacter(next); try { const saved = await saveCharacterProfile(next); setCharacter(saved); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save character settings.'); } }
  async function handleChatAppearanceChange(next: ChatAppearancePreferences) { const safe = { ...DEFAULT_CHAT_APPEARANCE, ...next, chatBackgroundOpacity: Math.max(0, Math.min(1, next.chatBackgroundOpacity)), chatBackgroundOverlay: Math.max(0, Math.min(.9, next.chatBackgroundOverlay)), chatBackgroundBlur: Math.max(0, Math.min(24, next.chatBackgroundBlur)), userSurfaceOpacity: Math.max(.2, Math.min(1, next.userSurfaceOpacity)) }; setChatAppearance(safe); try { setChatAppearance(await saveChatAppearance(safe)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save chat appearance.'); } }
  async function handleRoleplayChange(next: RoleplayPreferences) { setRoleplay(next); try { setRoleplay(await saveRoleplayPreferences(next)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save roleplay settings.'); } }
  async function finishFirstRun(): Promise<void> { await completeOnboarding(); setFirstRunWelcomeOpen(false); }
  const currentGeminiSettings = geminiPerModelSettings[geminiModel] ?? defaultsForModel(geminiModel);
  const appStyle = useMemo(() => ({ '--chat-background': backgroundValue(chatAppearance), '--chat-background-opacity': chatAppearance.chatBackgroundOpacity, '--chat-overlay': chatAppearance.chatBackgroundOverlay, '--chat-blur': `${chatAppearance.chatBackgroundBlur}px`, '--assistant-text-color': chatAppearance.assistantTextColor, '--user-text-color': chatAppearance.userTextColor, '--user-surface-color': chatAppearance.userSurfaceColor, '--user-surface-opacity': chatAppearance.userSurfaceOpacity } as React.CSSProperties), [chatAppearance]);
  const visibleMessages = conversation.messages.filter((message) => message.conversationId === conversation.id);

  if (settingsOpen) return <SettingsScreen font={font} onFontChange={setFont} fontSize={fontSize} onFontSizeChange={setFontSize} portraitScale={portraitScale} onPortraitScaleChange={setPortraitScale} portraitBackground={portraitBackground} onPortraitBackgroundChange={setPortraitBackground} selectedModel={geminiModel} geminiSettings={currentGeminiSettings} onModelChange={(model) => void handleModelChange(model)} onGeminiSettingsChange={(settings) => void handleGeminiSettingsChange(settings)} onResetGeminiSettings={() => void handleResetGeminiSettings()} character={character} onCharacterChange={(profile) => void handleCharacterChange(profile)} chatAppearance={chatAppearance} onChatAppearanceChange={(value) => void handleChatAppearanceChange(value)} roleplay={roleplay} onRoleplayChange={(value) => void handleRoleplayChange(value)} onBack={() => setSettingsOpen(false)} />;

  return <main className="app-shell" style={{ ...appStyle, fontFamily: fontFamilyForCss(font), '--body-font-size': `${fontSize}px` } as React.CSSProperties}>
    <div className="app-shell__background" aria-hidden="true" />
    <div className="left-spine" aria-label="Application controls"><button className="glass-menu-button" type="button" aria-label="Open sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Icon name="menu" size={21} /></button></div>
    <PortraitBanner collapsed={sidebarOpen} scale={portraitScale} background={portraitBackground} artworkMode={character.artworkMode} artwork={character.artwork} characterName={character.name} />
    <TopToolRail tools={DEFAULT_QUICK_ACTIONS} activeId={null} onAction={(shortcut) => void handleQuickShortcut(shortcut)} />
    <ConversationSurface key={conversation.id} messages={visibleMessages} fontSize={fontSize} onRegenerate={(messageId) => void regenerate(messageId)} />
    {error && <div className="error" role="alert">{error}</div>}
    <Composer draft={draft} status={status} geminiModel={geminiModel} systemInstruction={masterCharacterInstruction(character)} onDraftChange={setDraft} onSend={() => void send()} onCancel={cancel} />
    <Sidebar open={sidebarOpen} threads={threads} activeId={conversation.id} onClose={() => setSidebarOpen(false)} onSelect={(id) => void switchThread(id)} onNewChat={() => void startNewChat()} onRename={(id, title) => void handleRename(id, title)} onArchive={(id) => void handleArchive(id)} onDelete={(id) => void handleDelete(id)} onSettings={() => { setSidebarOpen(false); setSettingsOpen(true); }} />
    {firstRunWelcomeOpen && <FirstRunWelcome character={character} onSaveCharacter={handleCharacterChange} onComplete={finishFirstRun} />}
  </main>;
}

type StreamContext = { assistantMessage: ChatMessage; base: ConversationState; setConversation: Dispatch<SetStateAction<ConversationState>>; setStatus: (status: ProviderStatus) => void; setError: (error: string | null) => void; save: (conversation: ConversationState) => Promise<void>; refreshThreads: () => Promise<void>; startedAt: number; model: string; liveText: { value: string }; isCurrentConversation: () => boolean };

function handleStreamEvent(event: GeminiStreamEvent, context: StreamContext) {
  const { assistantMessage, base, setConversation, isCurrentConversation } = context;
  if (event.type === 'text-delta') {
    context.liveText.value += event.text;
    const liveText = context.liveText.value;
    if (!isCurrentConversation()) return;
    setConversation((current) => current.id === base.id ? { ...base, messages: base.messages.map((message) => message.id === assistantMessage.id ? { ...message, text: liveText } : message) } : current);
  }
  else if (event.type === 'completed') {
    const completedAt = Date.now();
    const live = context.liveText.value;
    const completed: ConversationState = { ...base, updatedAt: completedAt, messages: base.messages.map((message) => message.id === assistantMessage.id ? { ...message, text: live, providerTurn: { provider: 'gemini' as const, model: context.model, interactionId: event.interactionId, startedAt: context.startedAt, completedAt, durationMs: event.durationMs, usage: event.usage }, executionSummary: { id: crypto.randomUUID(), steps: ['Applied the user-configured system instruction when present.', 'Accepted the request through the canonical Gemini provider boundary.', 'Executed any requested Google capability through the registered tool executor.', 'Finalized and persisted the assistant turn.'], durationMs: event.durationMs } } : message) };
    void context.save(completed).then(context.refreshThreads).then(() => { if (isCurrentConversation()) setConversation((current) => current.id === completed.id ? completed : current); }).catch((cause) => { if (isCurrentConversation()) context.setError(cause instanceof Error ? cause.message : 'Could not save the assistant response.'); });
  }
  else if (event.type === 'failed') { if (isCurrentConversation()) { context.setStatus('failed'); context.setError(`${event.error.message} [${event.error.code}]`); } }
  else if (event.type === 'cancelled') { if (isCurrentConversation()) context.setStatus('idle'); }
}