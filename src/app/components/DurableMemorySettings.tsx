import { useEffect, useMemo, useState } from 'react';
import type { DurableMemory, MemoryKind, MemoryLifecycle } from '../../domain/memory';
import { archiveMemory, createMemory, deleteMemory, listMemories, promoteMemory, reinforceMemory, updateMemory } from '../../persistence/memory';
import { useFolders } from '../folders/FolderProvider';
import './durable-memory-settings.css';

const MEMORY_KINDS: MemoryKind[] = ['CORE', 'CONTEXTUAL', 'EPISODIC', 'MICRO_OBSERVATION'];
const MEMORY_LIFECYCLES: MemoryLifecycle[] = ['active', 'dormant', 'archived'];

function folderPath(folderId: string, folders: ReturnType<typeof useFolders>['state']['folders']): string {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  const visited = new Set<string>();
  let currentId: string | null = folderId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const folder = byId.get(currentId);
    if (!folder) break;
    names.unshift(folder.name);
    currentId = folder.parentId;
  }
  return names.join('/') || 'Unknown folder';
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
}

export function DurableMemorySettings() {
  const { state: folderState } = useFolders();
  const [memories, setMemories] = useState<DurableMemory[]>([]);
  const [scopeFilter, setScopeFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState({ content: '', kind: 'CONTEXTUAL' as MemoryKind, folderId: '', importance: '0.5', confidence: '0.7', tags: '' });

  async function refresh() {
    setLoading(true);
    try {
      setMemories(await listMemories());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load durable memories.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(() => memories.filter((memory) => {
    if (scopeFilter === 'global') return memory.folderId === null;
    if (scopeFilter === 'archived') return memory.lifecycle === 'archived';
    if (scopeFilter === 'active') return memory.lifecycle !== 'archived';
    if (scopeFilter.startsWith('folder:')) return memory.folderId === scopeFilter.slice(7);
    return true;
  }), [memories, scopeFilter]);

  function resetDraft() {
    setDraft({ content: '', kind: 'CONTEXTUAL', folderId: '', importance: '0.5', confidence: '0.7', tags: '' });
    setCreating(false);
    setEditingId(null);
  }

  function beginEdit(memory: DurableMemory) {
    setEditingId(memory.id);
    setCreating(false);
    setDraft({
      content: memory.content,
      kind: memory.kind,
      folderId: memory.folderId ?? '',
      importance: String(memory.importance),
      confidence: String(memory.confidence),
      tags: memory.tags.join(', '),
    });
  }

  async function saveDraft() {
    try {
      setError(null);
      const tags = draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
      const confidence = Number(draft.confidence);
      const importance = Number(draft.importance);
      if (!Number.isFinite(confidence) || !Number.isFinite(importance)) throw new Error('Confidence and importance must be numbers.');
      if (editingId) {
        await updateMemory(editingId, { content: draft.content, kind: draft.kind, folderId: draft.folderId || null, confidence, importance, tags });
      } else {
        await createMemory({ content: draft.content, kind: draft.kind, folderId: draft.folderId || null, confidence, importance, tags, provenance: 'user' });
      }
      resetDraft();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save that memory.');
    }
  }

  async function handleDelete(id: string) {
    try { await deleteMemory(id); setError(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete that memory.'); }
  }

  async function handleArchive(id: string) {
    try { await archiveMemory(id); setError(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not archive that memory.'); }
  }

  async function handlePromote(id: string) {
    try { await promoteMemory(id); setError(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not promote that memory.'); }
  }

  async function handleReinforce(id: string) {
    try { await reinforceMemory(id); setError(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reinforce that memory.'); }
  }

  return <div className="memory-settings">
    <div className="memory-settings__header">
      <div>
        <strong>Durable memory</strong>
        <span>Explicit notes Elara may retrieve during a Gemini interaction. Conversation history remains separate.</span>
      </div>
      <button type="button" onClick={() => { resetDraft(); setCreating(true); }}>New memory</button>
    </div>

    <div className="memory-settings__filters">
      <label><span>View</span><select value={scopeFilter} onChange={(event) => setScopeFilter(event.target.value)}><option value="all">All memories</option><option value="active">Active</option><option value="global">Global only</option><option value="archived">Archived</option>{folderState.folders.map((folder) => <option key={folder.id} value={`folder:${folder.id}`}>{folderPath(folder.id, folderState.folders)}</option>)}</select></label>
      <small>{memories.length} stored · {filtered.length} shown · retrieval is bounded before each request</small>
    </div>

    {error && <div className="memory-settings__error" role="alert">{error}</div>}

    {(creating || editingId) && <div className="memory-editor">
      <div className="memory-editor__title">{editingId ? 'Edit memory' : 'Create memory'}</div>
      <label><span>Memory</span><textarea value={draft.content} maxLength={2000} onChange={(event) => setDraft((current) => ({ ...current, content: event.target.value }))} /></label>
      <div className="memory-editor__grid">
        <label><span>Kind</span><select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as MemoryKind }))}>{MEMORY_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replace('_', ' ')}</option>)}</select></label>
        <label><span>Scope</span><select value={draft.folderId} onChange={(event) => setDraft((current) => ({ ...current, folderId: event.target.value }))}><option value="">Global</option>{folderState.folders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder.id, folderState.folders)}</option>)}</select></label>
        <label><span>Importance</span><input type="number" min="0" max="1" step="0.05" value={draft.importance} onChange={(event) => setDraft((current) => ({ ...current, importance: event.target.value }))} /></label>
        <label><span>Confidence</span><input type="number" min="0" max="1" step="0.05" value={draft.confidence} onChange={(event) => setDraft((current) => ({ ...current, confidence: event.target.value }))} /></label>
      </div>
      <label><span>Tags</span><input value={draft.tags} maxLength={480} placeholder="identity, preference, project" onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} /></label>
      <div className="memory-editor__actions"><button type="button" onClick={resetDraft}>Cancel</button><button type="button" className="primary" onClick={() => void saveDraft()}>{editingId ? 'Save changes' : 'Create memory'}</button></div>
    </div>}

    {loading ? <p className="memory-settings__empty">Loading durable memories…</p> : filtered.length === 0 ? <div className="memory-settings__empty"><strong>No memories here.</strong><span>Create an explicit durable note, or change the filter.</span></div> : <div className="memory-list">
      {filtered.map((memory) => <article className="memory-card" key={memory.id}>
        <div className="memory-card__meta"><span>{memory.kind.replace('_', ' ')}</span><span>{memory.lifecycle}</span><span>{memory.folderId ? folderPath(memory.folderId, folderState.folders) : 'Global'}</span></div>
        <p>{memory.content}</p>
        {memory.tags.length > 0 && <div className="memory-card__tags">{memory.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}
        <small>Confidence {Math.round(memory.confidence * 100)}% · Importance {Math.round(memory.importance * 100)}% · Recalled {memory.recallCount}× · Reinforced {memory.reinforcementCount}×</small>
        <small>Updated {formatDate(memory.updatedAt)} · {MEMORY_LIFECYCLES.includes(memory.lifecycle) ? memory.provenance : 'user'}</small>
        <div className="memory-card__actions">
          <button type="button" onClick={() => beginEdit(memory)}>Edit</button>
          {memory.lifecycle === 'archived' ? <button type="button" onClick={() => void handleReinforce(memory.id)}>Restore</button> : <button type="button" onClick={() => void handleArchive(memory.id)}>Archive</button>}
          <button type="button" onClick={() => void handlePromote(memory.id)}>Promote</button>
          <button type="button" className="danger" onClick={() => void handleDelete(memory.id)}>Delete</button>
        </div>
      </article>)}
    </div>}
  </div>;
}
