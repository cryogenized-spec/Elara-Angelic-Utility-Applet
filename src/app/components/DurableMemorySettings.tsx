import { useEffect, useMemo, useRef, useState } from 'react';
import type { DurableMemory, MemoryKind, MemoryLifecycle } from '../../memory/types';
import { archiveMemory, deleteMemory, listMemories, promoteMemory, reinforceMemory, saveMemory, updateMemory } from '../../memory/store';
import { sourceLabel } from '../../memory/provenance';
import { useFolders } from '../folders/FolderProvider';
import { MarkdownText } from './MarkdownText';
import './durable-memory-settings.css';

const MEMORY_KINDS: MemoryKind[] = ['CORE', 'CONTEXTUAL', 'EPISODIC', 'MICRO_OBSERVATION'];
const MEMORY_LIFECYCLES: MemoryLifecycle[] = ['active', 'dormant', 'archived'];

type MemoryFilter = 'all' | MemoryKind | MemoryLifecycle | 'global';

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

function formatDate(timestamp: number): string { return new Date(timestamp).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); }
function matchesQuery(memory: DurableMemory, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return `${memory.title}\n${memory.body}\n${memory.tags.join(' ')}`.toLocaleLowerCase().includes(needle);
}

export function DurableMemorySettings() {
  const { state: folderState } = useFolders();
  const [memories, setMemories] = useState<DurableMemory[]>([]);
  const [filter, setFilter] = useState<MemoryFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedRef = useRef<HTMLElement | null>(null);
  const [draft, setDraft] = useState({ title: '', body: '', kind: 'CONTEXTUAL' as MemoryKind, folderId: '', importance: '0.5', confidence: '0.7', tags: '' });

  async function refresh() {
    setLoading(true);
    try { setMemories(await listMemories()); setError(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load durable memories.'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(() => memories.filter((memory) => {
    const matchesFilter = filter === 'all'
      || (filter === 'global' && memory.folderId === null)
      || memory.kind === filter
      || memory.lifecycle === filter;
    return matchesFilter && matchesQuery(memory, query);
  }), [filter, memories, query]);

  useEffect(() => {
    if (expandedId && !filtered.some((memory) => memory.id === expandedId)) setExpandedId(null);
  }, [expandedId, filtered]);

  function openRecord(id: string) {
    setExpandedId((current) => current === id ? null : id);
    requestAnimationFrame(() => expandedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }
  function resetDraft() { setDraft({ title: '', body: '', kind: 'CONTEXTUAL', folderId: '', importance: '0.5', confidence: '0.7', tags: '' }); setCreating(false); setEditingId(null); }
  function beginEdit(memory: DurableMemory) {
    setExpandedId(memory.id);
    setEditingId(memory.id); setCreating(false);
    setDraft({ title: memory.title, body: memory.body, kind: memory.kind, folderId: memory.folderId ?? '', importance: String(memory.importance), confidence: String(memory.confidence), tags: memory.tags.join(', ') });
  }
  async function saveDraft() {
    try {
      setError(null);
      const tags = draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
      const confidence = Number(draft.confidence); const importance = Number(draft.importance);
      if (!Number.isFinite(confidence) || !Number.isFinite(importance)) throw new Error('Confidence and importance must be numbers.');
      if (editingId) await updateMemory(editingId, { title: draft.title, body: draft.body, kind: draft.kind, folderId: draft.folderId || null, confidence, importance, tags });
      else await saveMemory({ title: draft.title, body: draft.body, kind: draft.kind, folderId: draft.folderId || null, confidence, importance, tags, source: { source: 'user', createdAt: Date.now() } });
      resetDraft(); await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save that memory.'); }
  }
  async function handleDelete(id: string) {
    if (!window.confirm('Delete this memory permanently? This cannot be undone.')) return;
    try { await deleteMemory(id); setExpandedId((current) => current === id ? null : current); setError(null); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not delete that memory.'); }
  }
  async function handleArchive(id: string) { try { await archiveMemory(id); setError(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not archive that memory.'); } }
  async function handlePromote(id: string) { try { await promoteMemory(id); setError(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not promote that memory.'); } }
  async function handleReinforce(id: string) { try { await reinforceMemory(id); setError(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reinforce that memory.'); } }

  return <div className="memory-settings">
    <div className="memory-settings__header">
      <div><strong>Memory Bank</strong><span>One human-facing view over the canonical durable-memory store. Search and inspection do not create a second memory database.</span></div>
      <button type="button" onClick={() => { resetDraft(); setCreating(true); }}>New memory</button>
    </div>

    <div className="memory-settings__search">
      <label><span>Search memories</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, body, or tags…" type="search" /></label>
      {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear memory search">Clear</button>}
    </div>

    <div className="memory-settings__filters">
      <label><span>Filter</span><select value={filter} onChange={(event) => setFilter(event.target.value as MemoryFilter)}><option value="all">All records</option><optgroup label="Lifecycle">{MEMORY_LIFECYCLES.map((value) => <option key={value} value={value}>{value}</option>)}</optgroup><optgroup label="Kind">{MEMORY_KINDS.map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</optgroup><option value="global">Global scope</option></select></label>
      <small>{filtered.length} shown · {memories.length} stored · canonical store</small>
    </div>

    {error && <div className="memory-settings__error" role="alert">{error}</div>}

    {(creating || editingId) && <div className="memory-editor"><div className="memory-editor__title">{editingId ? 'Edit memory' : 'Create memory'}</div><label><span>Title</span><input value={draft.title} maxLength={160} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label><label><span>Memory body · Markdown supported</span><textarea value={draft.body} maxLength={50000} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} /></label><div className="memory-editor__grid"><label><span>Kind</span><select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as MemoryKind }))}>{MEMORY_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replace('_', ' ')}</option>)}</select></label><label><span>Scope</span><select value={draft.folderId} onChange={(event) => setDraft((current) => ({ ...current, folderId: event.target.value }))}><option value="">Global</option>{folderState.folders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder.id, folderState.folders)}</option>)}</select></label><label><span>Importance</span><input type="number" min="0" max="1" step="0.05" value={draft.importance} onChange={(event) => setDraft((current) => ({ ...current, importance: event.target.value }))} /></label><label><span>Confidence</span><input type="number" min="0" max="1" step="0.05" value={draft.confidence} onChange={(event) => setDraft((current) => ({ ...current, confidence: event.target.value }))} /></label></div><label><span>Tags</span><input value={draft.tags} maxLength={2048} placeholder="identity, preference, project" onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} /></label><div className="memory-editor__actions"><button type="button" onClick={resetDraft}>Cancel</button><button type="button" className="primary" onClick={() => void saveDraft()}>{editingId ? 'Save changes' : 'Create memory'}</button></div></div>}

    {loading ? <p className="memory-settings__empty">Loading durable memories…</p> : filtered.length === 0 ? <div className="memory-settings__empty"><strong>No memories match.</strong><span>Try another search or filter, or create an explicit durable note.</span></div> : <div className="memory-list">{filtered.map((memory) => {
      const expanded = expandedId === memory.id;
      return <article className={`memory-card${expanded ? ' is-expanded' : ''}`} key={memory.id} ref={expanded ? expandedRef : undefined}>
        <button className="memory-card__summary" type="button" onClick={() => openRecord(memory.id)} aria-expanded={expanded}>
          <span className="memory-card__summary-main"><strong>{memory.title}</strong><small>{memory.body.replace(/\s+/g, ' ').slice(0, 180)}{memory.body.length > 180 ? '…' : ''}</small></span>
          <span className="memory-card__chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
        </button>
        <div className="memory-card__meta"><span>{memory.kind.replace('_', ' ')}</span><span>{memory.lifecycle}</span><span>{memory.folderId ? folderPath(memory.folderId, folderState.folders) : 'Global'}</span></div>
        {expanded && <div className="memory-card__detail"><div className="memory-card__markdown"><MarkdownText text={memory.body} /></div>{memory.tags.length > 0 && <div className="memory-card__tags">{memory.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}<div className="memory-card__stats"><small>Confidence {Math.round(memory.confidence * 100)}% · Importance {Math.round(memory.importance * 100)}%</small><small>Recalled {memory.recallCount}× · Reinforced {memory.reinforcementCount}×</small><small>Observed {formatDate(memory.observedAt)} · Updated {formatDate(memory.updatedAt)}</small><small>Source: {sourceLabel(memory.source.source)}</small></div><div className="memory-card__actions"><button type="button" onClick={() => beginEdit(memory)}>Edit</button>{memory.lifecycle === 'archived' ? <button type="button" onClick={() => void handleReinforce(memory.id)}>Restore</button> : <button type="button" onClick={() => void handleArchive(memory.id)}>Archive</button>}<button type="button" onClick={() => void handlePromote(memory.id)}>Promote</button><button type="button" className="danger" onClick={() => void handleDelete(memory.id)}>Delete</button></div></div>}
      </article>;
    })}</div>}
  </div>;
}
