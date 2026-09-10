import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ConversationState, ConversationThread, ProviderStatus } from '../domain/chat';
import type { Attachment } from '../domain/artifact';
import { artifactRepository } from '../artifacts/repository';
import { createAttachmentFromFile } from '../artifacts/intake';
import { ArtifactError } from '../artifacts/errors';
import { ARTIFACT_LIMITS } from '../artifacts/limits';
import { DEFAULT_CHARACTER_PROFILE, type CharacterProfile } from '../domain/character';
import { DEFAULT_APP_UI, DEFAULT_CHAT_APPEARANCE, DEFAULT_ROLEPLAY, type AppUiPreferences, type ChatAppearancePreferences, type RoleplayPreferences } from '../domain/preferences';
import { archiveThread, createThread, deleteThread, loadConversation, loadGeminiSettings, loadThreads, renameThread, saveConversation, saveGeminiSettings, type StoredGeminiSettings } from '../persistence/conversation';
import { ensureWorkspaceShortcuts, storedShortcutFromDefinition, workspaceShortcutDefinition, type StoredWorkspaceShortcut } from '../persistence/workspace-shortcuts';
import { loadCharacterProfile, saveCharacterProfile } from '../persistence/character';
import { completeOnboarding, hasCompletedOnboarding, loadAppUiPreferences, loadChatAppearance, loadRoleplayPreferences, saveAppUiPreferences, saveChatAppearance, saveRoleplayPreferences } from '../persistence/preferences';
import { localThreadTitlePort } from '../chat/thread-title-port';
import { geminiTurnPort } from '../gemini/provider';
import { streamGoogleToolLoop } from '../gemini/google-tool-loop';
import { DEFAULT_GEMINI_MODEL, type GeminiStreamEvent } from '../gemini/contracts';
import type { NormalizedProviderError } from '../gemini/errors';
import {
  DEFAULT_ABSOLUTE_TURN_TIMEOUT_MS,
  DEFAULT_IDLE_STALL_TIMEOUT_MS,
  createGenerationState,
  generationProtocolError,
  generationTimeoutError,
  isTerminalPhase,
  type GenerationPhase,
  type GenerationState,
} from '../chat/generation-state';
import { canRetryFailedTurn, createGenerationArbiter, dispatchGenerationEvent, isFailedPartialTarget, regenerateBaseFor, type GenerationSyncContext, type FailedTurnAttempt } from '../chat/generation-sync';
import { loadPairing } from '../autonomy/cloud/pairing';
import { fullSync } from '../autonomy/cloud/sync';
import { createTurnWatchdog } from '../chat/turn-watchdog';
import { attachmentsForTurn } from '../chat/turn-lineage';
import type { GoogleToolName } from '../google/tools/contracts';
import { googleGeminiFunctionNames } from '../google/tools/gemini-declarations';
import { defaultsForModel, effectiveGeminiSettings, normalizeGeminiSettings, type GeminiSettings } from '../gemini/settings-engine';
import { getGeminiModel } from '../gemini/model-registry';
import { resolveMasterCharacterInstruction } from '../character/system-instruction';
import { Icon } from '../ui/icons';
import { fontFamilyForCss } from '../ui/fontRegistry';
import { useVisualViewport } from '../ui/useVisualViewport';
import { applyPwaUpdate, initPwaUpdater } from '../pwa';
import { Sidebar } from './components/Sidebar';
import { SettingsScreen, type SettingsSection } from './components/SettingsScreen';
import { TopToolRail } from './components/TopToolRail';
import { PortraitBanner } from './components/PortraitBanner';
import { ConversationSurface } from './components/ConversationSurface';
import { GenerationError } from './components/GenerationError';
import { Composer } from './components/Composer';
import { FirstRunWelcome } from './components/FirstRunWelcome';
import { UpdateToast } from './components/UpdateToast';
import type { WorkspaceShortcutDefinition } from './quick-actions/shortcuts';
import { DEFAULT_QUICK_ACTIONS } from './quick-actions/defaults';
import '../ui/fonts.css';
import './app.css';
import './mobile-viewport.css';
import './quick-action-rail.css';
import './components/composer-layout.css';

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

function loadCustomGoogleFont(stylesheetUrl: string): void {
  if (typeof document === 'undefined') return;
  if (document.querySelector(`link[data-elara-custom-font="${stylesheetUrl}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = stylesheetUrl;
  link.dataset.elaraCustomFont = stylesheetUrl;
  document.head.appendChild(link);
}

export function App() {
  const [conversation, setConversation] = useState<ConversationState>({ id: 'primary', title: DEFAULT_TITLE, createdAt: Date.now(), updatedAt: Date.now(), messages: [] });
  const [threads, setThreads] = useState<ConversationThread[]>([]);
  const [draft, setDraft] = useState('');
  const [draftAttachments, setDraftAttachments] = useState<Attachment[]>([]);
  const [status, setStatus] = useState<ProviderStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [structuredError, setStructuredError] = useState<NormalizedProviderError | null>(null);
  const [generation, setGeneration] = useState<GenerationState | null>(null);
  const [failedAttempt, setFailedAttempt] = useState<FailedTurnAttempt | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance');
  const [firstRunWelcomeOpen, setFirstRunWelcomeOpen] = useState(false);
  const [pwaUpdateAvailable, setPwaUpdateAvailable] = useState(false);
  const [workspaceShortcuts, setWorkspaceShortcuts] = useState<StoredWorkspaceShortcut[]>([]);
  const [uiSettings, setUiSettings] = useState<AppUiPreferences>(DEFAULT_APP_UI);
  const [geminiModel, setGeminiModel] = useState(DEFAULT_GEMINI_MODEL);
  const [geminiPerModelSettings, setGeminiPerModelSettings] = useState<Record<string, GeminiSettings>>({ [DEFAULT_GEMINI_MODEL]: defaultsForModel(DEFAULT_GEMINI_MODEL) });
  const [character, setCharacter] = useState<CharacterProfile>(DEFAULT_CHARACTER_PROFILE);
  const [chatAppearance, setChatAppearance] = useState<ChatAppearancePreferences>(DEFAULT_CHAT_APPEARANCE);
  const [roleplay, setRoleplay] = useState<RoleplayPreferences>(DEFAULT_ROLEPLAY);
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeConversationIdRef = useRef('primary');
  const generationArbiterRef = useRef(createGenerationArbiter());
  const uiSaveQueueRef = useRef(Promise.resolve());

  useVisualViewport();

  useEffect(() => {
    let cancelled = false;
    const initialActiveConversationId = activeConversationIdRef.current;
    void (async () => {
      try {
        const [loadedThreads, savedGeminiSettings, loadedCharacter, loadedAppearance, loadedRoleplay, loadedShortcuts, loadedUi, onboardingComplete] = await Promise.all([loadThreads(), loadGeminiSettings(), loadCharacterProfile(), loadChatAppearance(), loadRoleplayPreferences(), ensureWorkspaceShortcuts(), loadAppUiPreferences(), hasCompletedOnboarding()]);
        if (cancelled) return;
        if (loadedUi.font.kind === 'custom') loadCustomGoogleFont(loadedUi.font.stylesheetUrl);
        const storedActive = window.localStorage.getItem(ACTIVE_THREAD_KEY);
        const activeId = storedActive && loadedThreads.some((thread) => thread.id === storedActive) ? storedActive : (loadedThreads[0]?.id ?? 'primary');
        const loadedConversation = await loadConversation(activeId);
        if (cancelled || activeConversationIdRef.current !== initialActiveConversationId) return;
        activeConversationIdRef.current = activeId;
        setThreads(loadedThreads); setConversation(loadedConversation); setGeminiModel(savedGeminiSettings.model); setGeminiPerModelSettings(savedGeminiSettings.perModel); setCharacter(loadedCharacter); setChatAppearance(loadedAppearance); setRoleplay(loadedRoleplay); setWorkspaceShortcuts(loadedShortcuts); setUiSettings(loadedUi);
        setFirstRunWelcomeOpen(!onboardingComplete);
        window.localStorage.setItem(ACTIVE_THREAD_KEY, activeId);
      } catch { if (!cancelled) setError('Could not load the local application settings.'); }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => () => abortControllerRef.current?.abort(), []);

  useEffect(() => {
    initPwaUpdater(() => setPwaUpdateAvailable(true));
  }, []);

  // App open (design §8.5 sync lifecycle): when the device is paired with an
  // autonomy worker, mirror the configuration, sync the Autonomy Context if
  // its hash changed, and pull scheduler observations into the local run
  // history. Fire-and-forget: local-first — a cloud failure never blocks the
  // app, and the Autonomy panel surfaces sync status when opened.
  useEffect(() => {
    const pairing = loadPairing();
    if (pairing) void fullSync(pairing).catch(() => undefined);
  }, []);
  async function refreshThreads() { setThreads(await loadThreads()); }
  async function handleFilesSelected(files: FileList | null): Promise<void> {
    if (!files?.length) return;
    const selected = Array.from(files);
    if (draftAttachments.length + selected.length > ARTIFACT_LIMITS.maxAttachmentsPerMessage) {
      setError(`You can attach up to ${ARTIFACT_LIMITS.maxAttachmentsPerMessage} files to one message.`);
      return;
    }
    const next: Attachment[] = [...draftAttachments];
    let firstError: string | null = null;
    for (const file of selected) {
      const result = await createAttachmentFromFile(file);
      if (result.attachment) next.push(result.attachment);
      else if (!firstError) firstError = result.error?.userMessage ?? 'The file could not be attached.';
    }
    const totalBytes = next.reduce((sum, attachment) => sum + attachment.size, 0);
    if (totalBytes > ARTIFACT_LIMITS.maxMessageAttachmentBytes) {
      setError('The total attachment size for this message is too large.');
      const added = next.slice(draftAttachments.length);
      await Promise.all(added.map((attachment) => artifactRepository.delete(attachment.id).catch(() => undefined)));
      return;
    }
    setDraftAttachments(next);
    if (firstError) setError(firstError);
    else setError(null);
  }
  async function removeDraftAttachment(id: string): Promise<void> {
    setDraftAttachments((current) => current.filter((attachment) => attachment.id !== id));
    await artifactRepository.delete(id).catch(() => undefined);
  }
  async function switchThread(id: string) {
    cancel();
    activeConversationIdRef.current = id;
    setError(null); setDraft(''); setDraftAttachments([]); setGeneration(null); setFailedAttempt(null);
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
    setError(null); setDraft(''); setDraftAttachments([]); setGeneration(null); setFailedAttempt(null);
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
    if ((!text && draftAttachments.length === 0) || status === 'streaming' || !conversation.id || !activeConversationIdRef.current) return;
    if (draftAttachments.some((attachment) => attachment.status !== 'ready')) {
      setError('Wait for the attachments to finish processing before sending.');
      return;
    }
    const attachmentIds = draftAttachments.map((attachment) => attachment.id);
    const systemInstruction = resolveMasterCharacterInstruction(character.systemInstruction);
    setDraft(''); setError(null); setStructuredError(null); setFailedAttempt(null); setStatus('streaming');
    const controller = new AbortController(); abortControllerRef.current = controller; const conversationId = conversation.id;
    const selectedSettings = geminiPerModelSettings[geminiModel] ?? defaultsForModel(geminiModel);
    const generationConfig = effectiveGeminiSettings(geminiModel, selectedSettings);
    let turnId: string | null = null;
    try {
      const userMessage = makeMessage('user', text, conversationId);
      const withUser = await artifactRepository.appendMessageWithArtifacts(userMessage, conversationId, attachmentIds);
      if (controller.signal.aborted || activeConversationIdRef.current !== conversationId) return;
      let titled = withUser;
      if (withUser.title === DEFAULT_TITLE && text) { try { const generatedTitle = await localThreadTitlePort.generateTitle(text); titled = { ...withUser, title: generatedTitle, updatedAt: Date.now() }; await saveConversation(titled); } catch {} }
      if (controller.signal.aborted || activeConversationIdRef.current !== conversationId) return;
      setConversation((current) => activeConversationIdRef.current === conversationId ? titled : current); setDraftAttachments([]); await refreshThreads();
      if (activeConversationIdRef.current !== conversationId) return;
      turnId = await streamAssistantTurn(text, titled, conversationId, controller, { systemInstruction, generationConfig, tools: DEFAULT_GEMINI_TOOLS, attachments: attachmentIds, inputMessageId: userMessage.id, responseGroupId: userMessage.id, responseVariant: 1 });
    } catch (cause) {
      if (activeConversationIdRef.current !== conversationId) return;
      if (turnId !== null && !generationArbiterRef.current.isActive(turnId)) return;
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) { setStatus('idle'); return; }
      setStatus('failed'); setError(cause instanceof Error ? cause.message : 'The response failed.');
    } finally { if (abortControllerRef.current === controller) abortControllerRef.current = null; }
  }

  async function regenerate(messageId: string) {
    if (status === 'streaming') return;
    // Regenerating the failed partial itself means "redo this response":
    // replace it via retry rather than appending a variant next to it.
    if (isFailedPartialTarget(conversation, failedAttempt, messageId)) { await retryLastTurn(); return; }
    const effectiveBase = regenerateBaseFor(conversation, failedAttempt);
    const targetIndex = effectiveBase.messages.findIndex((message) => message.id === messageId);
    const target = targetIndex >= 0 ? effectiveBase.messages[targetIndex] : undefined;
    if (!target || target.role !== 'assistant') return;
    let groupId = target.responseGroupId;
    let workingConversation = effectiveBase;
    if (!groupId) {
      groupId = target.id;
      const promoted: ConversationState = { ...effectiveBase, updatedAt: Date.now(), messages: effectiveBase.messages.map((message) => message.id === target.id ? { ...message, responseGroupId: groupId, responseVariant: 1 } : message) };
      workingConversation = promoted;
      setConversation(promoted);
      try { await saveConversation(promoted); await refreshThreads(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not prepare that response for regeneration.'); return; }
    }
    const prompt = [...workingConversation.messages.slice(0, targetIndex)].reverse().find((message) => message.role === 'user');
    if (!prompt) { setError('Could not find the original user prompt for this response.'); return; }
    const promptIndex = workingConversation.messages.findIndex((message) => message.id === prompt.id);
    const previousInteractionId = promptIndex >= 0 ? [...workingConversation.messages.slice(0, promptIndex)].reverse().find((message) => message.role === 'assistant' && message.providerTurn)?.providerTurn?.interactionId : undefined;
    const nextVariant = workingConversation.messages.filter((message) => message.role === 'assistant' && (message.responseGroupId ?? message.id) === groupId).length + 1;
    const selectedSettings = geminiPerModelSettings[geminiModel] ?? defaultsForModel(geminiModel);
    const generationConfig = effectiveGeminiSettings(geminiModel, selectedSettings);
    const systemInstruction = resolveMasterCharacterInstruction(character.systemInstruction);
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setError(null); setStructuredError(null); setFailedAttempt(null); setStatus('streaming');
    let turnId: string | null = null;
    try {
      turnId = await streamAssistantTurn(prompt.text, workingConversation, workingConversation.id, controller, { systemInstruction, generationConfig, tools: DEFAULT_GEMINI_TOOLS, previousInteractionId, attachments: prompt.attachments, inputMessageId: prompt.id, responseGroupId: groupId, responseVariant: nextVariant, supersedesGenerationId: target.providerTurn?.generationId });
    } catch (cause) {
      if (activeConversationIdRef.current !== workingConversation.id) return;
      if (turnId !== null && !generationArbiterRef.current.isActive(turnId)) return;
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) { setStatus('idle'); return; }
      setStatus('failed'); setError(cause instanceof Error ? cause.message : 'The regenerated response failed.');
    } finally { if (abortControllerRef.current === controller) abortControllerRef.current = null; }
  }

  async function runWorkspaceShortcut(shortcutRecord: StoredWorkspaceShortcut) {
    if (status === 'streaming') return;
    const shortcut = workspaceShortcutDefinition(shortcutRecord);
    if (!shortcutRecord.enabled) return;
    setError(null); setStructuredError(null); setFailedAttempt(null); setStatus('streaming');
    const controller = new AbortController(); abortControllerRef.current = controller; const conversationId = conversation.id;
    const selectedSettings = geminiPerModelSettings[geminiModel] ?? defaultsForModel(geminiModel);
    const generationConfig = effectiveGeminiSettings(geminiModel, selectedSettings);
    const systemInstruction = resolveMasterCharacterInstruction(character.systemInstruction);
    const hiddenTask = `Execute the saved Workspace shortcut “${shortcut.label}”.\nUser intent: ${shortcut.intent}\nUse only the registered tools supplied for this shortcut.`;
    let turnId: string | null = null;
    try {
      turnId = await streamAssistantTurn(hiddenTask, regenerateBaseFor(conversation, failedAttempt), conversationId, controller, { systemInstruction, generationConfig, tools: shortcut.tools });
    } catch (cause) {
      if (activeConversationIdRef.current !== conversationId) return;
      if (turnId !== null && !generationArbiterRef.current.isActive(turnId)) return;
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) { setStatus('idle'); return; }
      setStatus('failed'); setError(cause instanceof Error ? cause.message : `The ${shortcut.label} shortcut failed.`);
    } finally { if (abortControllerRef.current === controller) abortControllerRef.current = null; }
  }

  async function streamAssistantTurn(input: string, baseConversation: ConversationState, conversationId: string, controller: AbortController, options: { systemInstruction: string; generationConfig: Record<string, unknown>; tools?: readonly GoogleToolName[]; attachments?: readonly string[]; inputMessageId?: string; previousInteractionId?: string; responseGroupId?: string; responseVariant?: number; supersedesGenerationId?: string; watchdog?: { idleStallMs?: number; absoluteMs?: number } }): Promise<string | null> {
    if (activeConversationIdRef.current !== conversationId || controller.signal.aborted) return null;
    const previousInteractionId = options.previousInteractionId ?? [...baseConversation.messages].reverse().find((message) => message.role === 'assistant' && message.providerTurn)?.providerTurn?.interactionId;
    const assistantMessage = { ...makeMessage('assistant', '', conversationId), responseGroupId: options.responseGroupId, responseVariant: options.responseVariant } satisfies ChatMessage;
    const wallStartedAt = Date.now();
    const base = { ...baseConversation, updatedAt: wallStartedAt };
    const isCurrentConversation = () => activeConversationIdRef.current === conversationId;
    if (!isCurrentConversation()) return null;

    // One stable turn identity across every tool continuation in this request.
    // A new interaction-created never resets transcript or trace state.
    // Activating here supersedes any still-in-flight older generation: its
    // late events will fail the shared arbitration check below.
    const generationId = crypto.randomUUID();
    generationArbiterRef.current.activate(generationId);
    const isActiveGeneration = () =>
      activeConversationIdRef.current === conversationId && generationArbiterRef.current.isActive(generationId);
    let assistantInserted = false;
    const ensureAssistant = () => {
      if (assistantInserted || !isActiveGeneration() || controller.signal.aborted) return;
      assistantInserted = true;
      setConversation((current) => current.id === base.id ? { ...base, messages: [...base.messages, assistantMessage] } : current);
    };
    const idleStallMs = options.watchdog?.idleStallMs ?? DEFAULT_IDLE_STALL_TIMEOUT_MS;
    const absoluteMs = options.watchdog?.absoluteMs ?? DEFAULT_ABSOLUTE_TURN_TIMEOUT_MS;
    let terminalWhileActive = false;
    let current = createGenerationState(generationId, { supersedesGenerationId: options.supersedesGenerationId, startedAt: performance.now() });
    setGeneration(current);
    setStructuredError(null);
    const syncContext: GenerationSyncContext = { assistantMessage, base, input, inputMessageId: options.inputMessageId, model: geminiModel, wallStartedAt, supersedesGenerationId: options.supersedesGenerationId, setConversation, setStatus, setError, setStructuredError, save: saveConversation, refreshThreads, isActiveGeneration, ensureAssistant, onFailedAttempt: captureFailedAttempt };

    const dispatch = (event: GeminiStreamEvent) => {
      watchdog.notifyActivity();
      current = dispatchGenerationEvent(current, { generationId, event, receivedAt: performance.now() }, syncContext);
      if (event.type === 'artifact-created' && isActiveGeneration()) {
        const expectedStatus = event.status === 'pending' || event.status === 'processing' || event.status === 'ready' || event.status === 'failed' ? event.status : undefined;
        void artifactRepository.updateMetadata(event.artifactId, { sourceMessageId: assistantMessage.id }, event.operationId && expectedStatus ? { operationId: event.operationId, expectedStatus, isValid: isActiveGeneration } : undefined).catch(() => undefined);
      }
      // The trace panel is application state too: reflect it only while this
      // turn is both elected AND on the current conversation.
      if (isActiveGeneration()) setGeneration(current);
      if (isTerminalPhase(current.phase)) {
        watchdog.dispose();
        if (isActiveGeneration()) {
          terminalWhileActive = true;
          generationArbiterRef.current.release(generationId);
        }
      }
    };
    const failTurn = (error: NormalizedProviderError) => {
      if (isTerminalPhase(current.phase)) return;
      dispatch({ type: 'failed', error });
    };
    const watchdog = createTurnWatchdog({
      idleStallMs,
      absoluteMs,
      onIdleStall: () => {
        // A user-cancelled turn is already terminal by intent: never let a
        // late watchdog firing convert the cancellation into a timeout error.
        if (controller.signal.aborted) return;
        failTurn(generationTimeoutError(`Gemini stopped responding${stallPhaseHint(current.phase)} (no stream activity for ${Math.round(idleStallMs / 1000)}s).`, { interactionId: current.currentInteractionId, durationMs: Date.now() - wallStartedAt }));
        controller.abort();
      },
      onAbsoluteTimeout: () => {
        if (controller.signal.aborted) return;
        failTurn(generationTimeoutError(`Gemini turn exceeded the ${Math.round(absoluteMs / 60000)}-minute limit${stallPhaseHint(current.phase)}.`, { interactionId: current.currentInteractionId, durationMs: Date.now() - wallStartedAt }));
        controller.abort();
      },
    });

    try {
      const request = { model: geminiModel, input, attachments: attachmentsForTurn(base, options.inputMessageId, options.attachments), previousInteractionId, generationConfig: options.generationConfig, systemInstruction: options.systemInstruction, tools: options.tools, generationId, isGenerationActive: isActiveGeneration };
      const stream = options.tools?.length
        ? streamGoogleToolLoop(request, { tools: options.tools, readOnly: false }, controller.signal)
        : geminiTurnPort.streamReply(request, controller.signal);
      for await (const event of stream) {
        // Stop means stop: once the turn is aborted, late provider events
        // (buffered text deltas, tool results) must never reach the transcript.
        // Synthesize the terminal cancellation exactly once, then break so the
        // underlying provider/tool-loop generators are closed via return().
        if (controller.signal.aborted) {
          const interactionId = current.currentInteractionId;
          dispatch({ type: 'cancelled', ...(interactionId ? { interactionId } : {}) });
          break;
        }
        dispatch(event);
        if (event.type === 'cancelled') break;
      }
      // An exhausted iterator is never success: synthesize the missing
      // terminal outcome (cancellation when aborted, protocol failure else).
      if (!isTerminalPhase(current.phase)) {
        if (controller.signal.aborted || !isCurrentConversation()) {
          dispatch({ type: 'cancelled', interactionId: current.currentInteractionId });
        } else {
          failTurn(generationProtocolError('Gemini closed the stream without completing the turn.', { interactionId: current.currentInteractionId, durationMs: Date.now() - wallStartedAt }));
        }
      }
    } finally {
      watchdog.dispose();
      if (terminalWhileActive && current.phase === 'completed') setStatus('idle');
    }
    return generationId;
  }

  async function retryLastTurn() {
    if (status === 'streaming' || !conversation.id || !activeConversationIdRef.current) return;
    // Replace the failed attempt: stream from its exact pre-generation base so
    // a partial assistant can never survive next to the retried answer.
    const attempt = failedAttempt;
    if (!attempt || attempt.base.id !== conversation.id || !attempt.input.trim()) return;
    const systemInstruction = resolveMasterCharacterInstruction(character.systemInstruction);
    setError(null); setStructuredError(null); setFailedAttempt(null); setStatus('streaming');
    setConversation((current) => current.id === attempt.base.id ? attempt.base : current);
    const controller = new AbortController(); abortControllerRef.current = controller; const conversationId = conversation.id;
    const selectedSettings = geminiPerModelSettings[geminiModel] ?? defaultsForModel(geminiModel);
    const generationConfig = effectiveGeminiSettings(geminiModel, selectedSettings);
    let turnId: string | null = null;
    try {
      turnId = await streamAssistantTurn(attempt.input, attempt.base, conversationId, controller, { systemInstruction, generationConfig, tools: DEFAULT_GEMINI_TOOLS, inputMessageId: attempt.inputMessageId, responseGroupId: attempt.responseGroupId, responseVariant: attempt.responseVariant, supersedesGenerationId: attempt.generationId });
    } catch (cause) {
      if (activeConversationIdRef.current !== conversationId) return;
      if (turnId !== null && !generationArbiterRef.current.isActive(turnId)) return;
      if (controller.signal.aborted || (cause instanceof DOMException && cause.name === 'AbortError')) { setStatus('idle'); return; }
      setStatus('failed'); setError(cause instanceof Error ? cause.message : 'The response failed.');
    } finally { if (abortControllerRef.current === controller) abortControllerRef.current = null; }
  }

  function captureFailedAttempt(attempt: FailedTurnAttempt) {
    // Snapshot the message list: the retry base must never observe later mutations.
    setFailedAttempt({ ...attempt, base: { ...attempt.base, messages: [...attempt.base.messages] } });
  }

  function openLockbox() { setSettingsSection('security'); setSettingsOpen(true); }

  function cancel() { abortControllerRef.current?.abort(); setStatus('idle'); setError(null); setStructuredError(null); }
  async function handleRename(id: string, title: string) { try { await renameThread(id, title); await refreshThreads(); if (id === conversation.id && activeConversationIdRef.current === id) setConversation((current) => ({ ...current, title })); } catch (cause) { if (activeConversationIdRef.current === id) setError(cause instanceof Error ? cause.message : 'Could not rename that thread.'); } }
  async function handleArchive(id: string) { try { await archiveThread(id); await refreshThreads(); if (id === conversation.id) await startNewChat(); } catch (cause) { if (activeConversationIdRef.current === id) setError(cause instanceof Error ? cause.message : 'Could not archive that thread.'); } }
  async function handleDelete(id: string) { if (!window.confirm('Delete this conversation? This removes its local messages.')) return; try { await deleteThread(id); await refreshThreads(); if (id === conversation.id) await startNewChat(); } catch (cause) { if (activeConversationIdRef.current === id) { setError(cause instanceof Error ? cause.message : 'Could not delete that conversation.'); } } }
  async function handleQuickShortcut(shortcut: WorkspaceShortcutDefinition) {
    const record = workspaceShortcuts.find((item) => item.id === shortcut.id) ?? storedShortcutFromDefinition(shortcut, workspaceShortcuts.length);
    await runWorkspaceShortcut(record);
  }
  async function handleModelChange(model: string) { const definition = getGeminiModel(model); const settings = normalizeGeminiSettings(model, geminiPerModelSettings[model] ?? defaultsForModel(model)); const nextMap = { ...geminiPerModelSettings, [definition.id]: settings }; setGeminiModel(definition.id); setGeminiPerModelSettings(nextMap); try { const saved: StoredGeminiSettings = await saveGeminiSettings(definition.id, settings, nextMap); setGeminiPerModelSettings(saved.perModel); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save Gemini model settings.'); } }
  async function handleGeminiSettingsChange(settings: GeminiSettings) { const normalized = normalizeGeminiSettings(geminiModel, settings); const nextMap = { ...geminiPerModelSettings, [geminiModel]: normalized }; setGeminiPerModelSettings(nextMap); try { const saved = await saveGeminiSettings(geminiModel, normalized, nextMap); setGeminiPerModelSettings(saved.perModel); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save Gemini settings.'); } }
  async function handleResetGeminiSettings() { await handleGeminiSettingsChange(defaultsForModel(geminiModel)); }
  async function handleCharacterChange(next: CharacterProfile) { setCharacter(next); try { const saved = await saveCharacterProfile(next); setCharacter(saved); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save character settings.'); } }
  async function handleChatAppearanceChange(next: ChatAppearancePreferences) { const safe = { ...DEFAULT_CHAT_APPEARANCE, ...next, chatBackgroundOpacity: Math.max(0, Math.min(1, next.chatBackgroundOpacity)), chatBackgroundOverlay: Math.max(0, Math.min(.9, next.chatBackgroundOverlay)), chatBackgroundBlur: Math.max(0, Math.min(24, next.chatBackgroundBlur)), userSurfaceOpacity: Math.max(.2, Math.min(1, next.userSurfaceOpacity)) }; setChatAppearance(safe); try { setChatAppearance(await saveChatAppearance(safe)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save chat appearance.'); } }
  async function handleRoleplayChange(next: RoleplayPreferences) { setRoleplay(next); try { setRoleplay(await saveRoleplayPreferences(next)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save roleplay settings.'); } }
  function handleUiSettingsChange(patch: Partial<AppUiPreferences>): void {
    const next = { ...uiSettings, ...patch };
    if (next.font.kind === 'custom') loadCustomGoogleFont(next.font.stylesheetUrl);
    setUiSettings(next);
    uiSaveQueueRef.current = uiSaveQueueRef.current.catch(() => undefined).then(async () => {
      try { const saved = await saveAppUiPreferences(next); setUiSettings(saved); }
      catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save application settings.'); }
    });
  }
  async function finishFirstRun(): Promise<void> { await completeOnboarding(); setFirstRunWelcomeOpen(false); }
  const currentGeminiSettings = geminiPerModelSettings[geminiModel] ?? defaultsForModel(geminiModel);
  const appStyle = useMemo(() => ({ '--chat-background': backgroundValue(chatAppearance), '--chat-background-opacity': chatAppearance.chatBackgroundOpacity, '--chat-overlay': chatAppearance.chatBackgroundOverlay, '--chat-blur': `${chatAppearance.chatBackgroundBlur}px`, '--assistant-text-color': chatAppearance.assistantTextColor, '--user-text-color': chatAppearance.userTextColor, '--user-surface-color': chatAppearance.userSurfaceColor, '--user-surface-opacity': chatAppearance.userSurfaceOpacity, '--body-font-size': `${uiSettings.chatTextSize}px` } as React.CSSProperties), [chatAppearance, uiSettings.chatTextSize]);
  const visibleMessages = conversation.messages.filter((message) => message.conversationId === conversation.id);
  const canRetry = canRetryFailedTurn(status, failedAttempt, conversation.id);
  const showLockboxAction = structuredError !== null && (structuredError.category === 'configuration' || structuredError.category === 'authentication' || structuredError.category === 'authorization' || structuredError.code === 'GEMINI_LOCKBOX_LOCKED');
  if (settingsOpen) return <SettingsScreen initialSection={settingsSection} font={uiSettings.font} onFontChange={(value) => handleUiSettingsChange({ font: value })} chatTextSize={uiSettings.chatTextSize} onChatTextSizeChange={(value) => handleUiSettingsChange({ chatTextSize: value })} portraitScale={uiSettings.portraitScale} onPortraitScaleChange={(value: 1 | 2 | 3) => handleUiSettingsChange({ portraitScale: value })} portraitBackground={uiSettings.portraitBackground} onPortraitBackgroundChange={(value) => handleUiSettingsChange({ portraitBackground: value })} selectedModel={geminiModel} geminiSettings={currentGeminiSettings} onModelChange={(model) => void handleModelChange(model)} onGeminiSettingsChange={(settings) => void handleGeminiSettingsChange(settings)} onResetGeminiSettings={() => void handleResetGeminiSettings()} character={character} onCharacterChange={(profile) => void handleCharacterChange(profile)} chatAppearance={chatAppearance} onChatAppearanceChange={(value: ChatAppearancePreferences) => void handleChatAppearanceChange(value)} roleplay={roleplay} onRoleplayChange={(value) => void handleRoleplayChange(value)} enterToSend={uiSettings.enterToSend} onEnterToSendChange={(value) => handleUiSettingsChange({ enterToSend: value })} onBack={() => setSettingsOpen(false)} />;
  return <main className="app-shell" style={{ ...appStyle, fontFamily: fontFamilyForCss(uiSettings.font) } as React.CSSProperties}>
    <div className="app-shell__background" aria-hidden="true" />
    <div className="left-spine" aria-label="Application controls"><button className="glass-menu-button" type="button" aria-label="Open sidebar" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Icon name="menu" size={21} /></button></div>
    <PortraitBanner collapsed={sidebarOpen} scale={uiSettings.portraitScale} background={uiSettings.portraitBackground} artworkMode={character.artworkMode} artwork={character.artwork} characterName={character.name} />
    <TopToolRail tools={DEFAULT_QUICK_ACTIONS} activeId={null} systemInstruction={character.systemInstruction} onAction={(shortcut) => void handleQuickShortcut(shortcut)} />
    <ConversationSurface key={conversation.id} messages={visibleMessages} fontSize={uiSettings.chatTextSize} generation={generation} onRegenerate={(messageId) => void regenerate(messageId)} />
    {error && <GenerationError message={error} structured={structuredError} onRetry={canRetry ? () => void retryLastTurn() : null} onOpenLockbox={showLockboxAction ? () => openLockbox() : null} />}
    <Composer draft={draft} status={status} geminiModel={geminiModel} systemInstruction={resolveMasterCharacterInstruction(character.systemInstruction)} onDraftChange={setDraft} onSend={() => void send()} onCancel={cancel} attachments={draftAttachments} onFilesSelected={(files) => void handleFilesSelected(files)} onRemoveAttachment={(id) => void removeDraftAttachment(id)} enterToSend={uiSettings.enterToSend} />
    {pwaUpdateAvailable && <UpdateToast onRefresh={() => applyPwaUpdate()} onDismiss={() => setPwaUpdateAvailable(false)} />}
    <Sidebar open={sidebarOpen} threads={threads} activeId={conversation.id} onClose={() => setSidebarOpen(false)} onSelect={(id) => void switchThread(id)} onNewChat={() => void startNewChat()} onRename={(id, title) => void handleRename(id, title)} onArchive={(id) => void handleArchive(id)} onDelete={(id) => void handleDelete(id)} onSettings={() => { setSidebarOpen(false); setSettingsSection('appearance'); setSettingsOpen(true); }} />
    {firstRunWelcomeOpen && <FirstRunWelcome character={character} onSaveCharacter={handleCharacterChange} onComplete={finishFirstRun} />}
  </main>;
}

function stallPhaseHint(phase: GenerationPhase): string {
  if (phase === 'thinking') return ' while thinking';
  if (phase === 'tool-working') return ' while using tools';
  if (phase === 'generating') return ' while writing the response';
  return '';
}
