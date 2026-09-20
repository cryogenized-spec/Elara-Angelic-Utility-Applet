import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DurableMemory } from '../../memory/types';
import { listMemories } from '../../memory/store';
import { isSemanticFileStale, selectSemanticFileEvidence } from '../../memory/semantic-evidence';
import { normalizeIdentityDisplay, normalizeIdentityKey, SEMANTIC_CONCEPT_KINDS, SEMANTIC_ALIAS_MAX_LENGTH, SEMANTIC_LABEL_MAX_LENGTH, SEMANTIC_MAX_ALIASES } from '../../memory/semantic-entities';
import {
  SEMANTIC_SUMMARY_MAX_LENGTH,
  deleteSemanticFile,
  listSemanticFiles,
  writeSemanticFile,
  type SemanticMemoryFile,
} from '../../memory/semantic-file';
import { maintainSemanticFiles } from '../../memory/semantic-maintenance';
import { rebuildSemanticFile } from '../../memory/semantic-rebuild';
import { geminiSemanticSynthesisExtractor } from '../../gemini/semantic-synthesis';
import { loadGeminiSettings } from '../../persistence/conversation';
import './semantic-memory-files.css';

const KIND_GROUPS: ReadonlyArray<{ id: 'you' | 'people' | 'projects' | 'areas' | 'topics'; label: string; kinds: SemanticMemoryFile['kind'][] }> = [
  { id: 'you', label: 'You', kinds: ['you-profile', 'you-preferences'] },
  { id: 'people', label: 'People', kinds: ['person'] },
  { id: 'projects', label: 'Projects', kinds: ['project'] },
  { id: 'areas', label: 'Areas', kinds: ['area'] },
  { id: 'topics', label: 'Topics', kinds: ['topic'] },
];

const SEMANTIC_MAX_ALIASES_CHARS = SEMANTIC_MAX_ALIASES * (SEMANTIC_ALIAS_MAX_LENGTH + 2);

const KIND_LABELS: Readonly<Record<SemanticMemoryFile['kind'], string>> = {
  'you-profile': 'Profile',
  'you-preferences': 'Preferences',
  person: 'Person',
  area: 'Area',
  project: 'Project',
  topic: 'Topic',
};

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString([], { dateStyle: 'medium' });
}

interface EditDraft {
  title: string;
  summary: string;
  aliases: string;
}

export function SemanticMemoryFiles() {
  const [files, setFiles] = useState<SemanticMemoryFile[]>([]);
  const [memories, setMemories] = useState<DurableMemory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({ title: '', summary: '', aliases: '' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createKind, setCreateKind] = useState<SemanticMemoryFile['kind']>('topic');
  const [createTitle, setCreateTitle] = useState('');
  const [sweepRunning, setSweepRunning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [storedFiles, storedMemories] = await Promise.all([listSemanticFiles(), listMemories()]);
      setFiles(storedFiles);
      setMemories(storedMemories);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load memory topics.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([listSemanticFiles(), listMemories()]).then(([storedFiles, storedMemories]) => {
      if (!active) return;
      setFiles(storedFiles);
      setMemories(storedMemories);
      setError(null);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load memory topics.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const memoryById = useMemo(() => new Map(memories.map((memory) => [memory.id, memory])), [memories]);
  const staleIds = useMemo(() => new Set(files.filter((file) => isSemanticFileStale(file, memories)).map((file) => file.id)), [files, memories]);

  function openFile(id: string) {
    setEditingId(null);
    setExpandedId((current) => (current === id ? null : id));
  }

  function beginEdit(file: SemanticMemoryFile) {
    setExpandedId(file.id);
    setEditingId(file.id);
    setDraft({ title: file.title, summary: file.summary, aliases: file.aliases.join(', ') });
  }

  async function saveEdit(file: SemanticMemoryFile) {
    try {
      const aliases = [...new Map(draft.aliases.split(',').map(normalizeIdentityDisplay).filter(Boolean)
        .map((alias) => [normalizeIdentityKey(alias), alias])).values()];
      if (aliases.length > SEMANTIC_MAX_ALIASES || aliases.some((alias) => alias.length > SEMANTIC_ALIAS_MAX_LENGTH)) {
        throw new Error(`Use at most ${SEMANTIC_MAX_ALIASES} aliases, each at most ${SEMANTIC_ALIAS_MAX_LENGTH} characters.`);
      }
      const updated: SemanticMemoryFile = {
        ...file,
        title: normalizeIdentityDisplay(draft.title).slice(0, SEMANTIC_LABEL_MAX_LENGTH),
        summary: draft.summary.trim().slice(0, SEMANTIC_SUMMARY_MAX_LENGTH),
        aliases,
        version: file.version + 1,
      };
      if (!updated.title || !updated.summary) throw new Error('A summary file needs both a name and a summary.');
      await writeSemanticFile(updated, file.version);
      setEditingId(null);
      setStatus('Summary updated. Rebuilding regenerates it from the underlying memories.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update that summary.');
    }
  }

  async function handleRebuild(file: SemanticMemoryFile) {
    setBusyId(file.id);
    setStatus(null);
    try {
      const settings = await loadGeminiSettings();
      const liveSource = selectSemanticFileEvidence(file, await listMemories()).memories[0];
      if (!liveSource) throw new Error('No eligible underlying memories remain for this topic.');
      const result = await rebuildSemanticFile({
        proposal: {
          kind: file.kind,
          canonicalLabel: file.title,
          aliases: file.aliases,
          evidenceRef: liveSource.body.slice(0, 500),
        },
        extractor: geminiSemanticSynthesisExtractor(settings.model),
      });
      if (result.status === 'created' || result.status === 'refreshed') setStatus('Summary refreshed from the underlying memories.');
      else if (result.status === 'unchanged') setStatus('Nothing new to add to this summary.');
      await refresh();
      if (result.status === 'rejected' || result.status === 'unavailable') setError('Elara could not refresh this summary right now. The underlying memories are untouched.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Elara could not refresh this summary right now.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleCreate() {
    setBusyId('create');
    setError(null);
    setStatus(null);
    try {
      const title = normalizeIdentityDisplay(createTitle);
      if (!title || title.length > SEMANTIC_LABEL_MAX_LENGTH) throw new Error('Enter a topic name of at most 80 characters.');
      const evidence = selectSemanticFileEvidence({ kind: createKind, title, aliases: [] }, await listMemories()).memories[0];
      if (!evidence) throw new Error('No eligible memories match this topic yet. Save a matching memory in the Memory Bank first.');
      const settings = await loadGeminiSettings();
      const result = await rebuildSemanticFile({
        proposal: { kind: createKind, canonicalLabel: title, aliases: [], evidenceRef: evidence.body.slice(0, 500) },
        extractor: geminiSemanticSynthesisExtractor(settings.model),
      });
      if (!result.file || result.status === 'rejected' || result.status === 'unavailable') {
        throw new Error('Could not create this topic from permitted evidence. Check memory permissions and model settings, then try again.');
      }
      await refresh();
      setExpandedId(result.file.id);
      setCreating(false);
      setCreateTitle('');
      setStatus('Topic ready. The underlying memories are unchanged.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create this topic.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleSweep() {
    setSweepRunning(true);
    setStatus(null);
    setError(null);
    try {
      const settings = await loadGeminiSettings();
      const report = await maintainSemanticFiles(geminiSemanticSynthesisExtractor(settings.model));
      const parts: string[] = [];
      parts.push(report.refreshed > 0 ? `Refreshed ${report.refreshed} stale topic${report.refreshed === 1 ? '' : 's'}.` : 'No stale topics needed refreshing.');
      if (report.unchanged > 0) parts.push(`${report.unchanged} already up to date.`);
      if (report.rejected > 0) parts.push(`${report.rejected} skipped — nothing was changed.`);
      if (report.unavailable > 0) parts.push(`${report.unavailable} could not be processed this time.`);
      if (report.nextRunHasWork) parts.push('The bounded window deferred some stale topics for the next run.');
      setStatus(`Maintenance: ${parts.join(' ')}`);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Memory maintenance could not run right now. The underlying memories are untouched.');
    } finally {
      setSweepRunning(false);
    }
  }

  async function handleClear(file: SemanticMemoryFile) {
    if (!window.confirm(`Remove the "${file.title}" summary file? Only this organized summary is removed — every underlying memory stays in the Memory Bank.`)) return;
    try {
      await deleteSemanticFile(file.id);
      setExpandedId(null);
      setStatus('Summary file removed. The underlying memories are untouched.');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove that summary file.');
    }
  }

  function renderFile(file: SemanticMemoryFile) {
    const expanded = expandedId === file.id && editingId !== file.id;
    const editing = editingId === file.id;
    const liveSources = file.sourceMemoryIds
      .map((id) => memoryById.get(id))
      .filter((memory): memory is DurableMemory => memory !== undefined);
    const stale = staleIds.has(file.id);
    const conflicted = file.openConflicts.length > 0 || liveSources.some((memory) => memory.conflictingMemoryIds.length > 0);
    return <article className={`semantic-files__card${expanded || editing ? ' is-expanded' : ''}`} key={file.id}>
      <button className="semantic-files__card-summary" type="button" onClick={() => openFile(file.id)} aria-expanded={expanded || editing}>
        <span className="semantic-files__card-main">
          <strong>{file.title}{file.aliases.length > 0 ? <small className="semantic-files__aliases"> also {file.aliases.join(', ')}</small> : null}</strong>
          <small>{file.summary}</small>
        </span>
        <span className="semantic-files__chevron" aria-hidden="true">{expanded || editing ? '⌃' : '⌄'}</span>
      </button>
      <div className="semantic-files__meta">
        <span>{KIND_LABELS[file.kind]}</span>
        <span>Last updated {formatDate(file.updatedAt)}</span>
        <span>Built from {liveSources.length} memor{liveSources.length === 1 ? 'y' : 'ies'}</span>
        {stale && <span className="semantic-files__flag">May be out of date</span>}
        {conflicted && <span className="semantic-files__flag">Has conflicting claims</span>}
      </div>
      {(expanded || editing) && <div className="semantic-files__detail">
        {editing ? <div className="semantic-files__edit">
          <p className="semantic-files__edit-note">Editing rewrites this summary only — it never changes the underlying memories. Rebuilding later regenerates it from them.</p>
          <label><span>Name</span><input value={draft.title} maxLength={SEMANTIC_LABEL_MAX_LENGTH} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
          <label><span>Summary</span><textarea value={draft.summary} maxLength={SEMANTIC_SUMMARY_MAX_LENGTH} onChange={(event) => setDraft((current) => ({ ...current, summary: event.target.value }))} /></label>
          <label><span>Also known as (comma separated)</span><input value={draft.aliases} maxLength={SEMANTIC_MAX_ALIASES_CHARS} onChange={(event) => setDraft((current) => ({ ...current, aliases: event.target.value }))} /></label>
          <div className="semantic-files__actions">
            <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
            <button type="button" className="primary" onClick={() => void saveEdit(file)}>Save summary</button>
          </div>
        </div> : <>
          {file.recentObservations.length > 0 && <div className="semantic-files__block"><strong>Recent details</strong><ul>{file.recentObservations.map((span, index) => <li key={index}>{span}</li>)}</ul></div>}
          {file.openConflicts.length > 0 && <div className="semantic-files__block semantic-files__block--conflict"><strong>Unresolved</strong><ul>{file.openConflicts.map((span, index) => <li key={index}>{span}</li>)}</ul></div>}
          {liveSources.length > 0 && <div className="semantic-files__block"><strong>Underlying memories</strong><ul>{liveSources.map((memory) => <li key={memory.id}><span>{memory.title}</span><small>{memory.kind.replace('_', ' ')} · {memory.lifecycle}</small></li>)}</ul><small className="semantic-files__sources-note">Full records, provenance and maintenance live in the Memory Bank below.</small></div>}
          <div className="semantic-files__actions">
            <button type="button" disabled={busyId === file.id} onClick={() => void handleRebuild(file)}>{busyId === file.id ? 'Refreshing…' : 'Refresh from memories'}</button>
            <button type="button" onClick={() => beginEdit(file)}>Edit summary</button>
            <button type="button" className="danger" onClick={() => void handleClear(file)}>Remove file</button>
          </div>
        </>}
      </div>}
    </article>;
  }

  return <section className="semantic-files" aria-labelledby="memory-topics-heading">
    <div className="semantic-files__header">
      <div>
        <strong id="memory-topics-heading">Memory topics</strong>
        <span>Organized summaries of what Elara has noticed — people, projects, areas, topics, and you. Summaries are rebuilt from the underlying memories; they are a map, not a second memory store.</span>
      </div>
      {!loading && staleIds.size > 0 && <button type="button" className="semantic-files__sweep" disabled={sweepRunning} onClick={() => void handleSweep()}>{sweepRunning ? 'Maintaining…' : `Refresh ${staleIds.size} stale topic${staleIds.size === 1 ? '' : 's'}`}</button>}
    </div>
    <button type="button" disabled={loading || busyId !== null || sweepRunning} onClick={() => setCreating(!creating)}>Create topic from memories</button>
    {creating && <form className="semantic-files__edit" onSubmit={(event) => { event.preventDefault(); void handleCreate(); }}>
      <p>Choose a concept already present in your memories. Creation makes one bounded model request; it does not save new facts or run automatically.</p>
      <label><span>Topic kind</span><select aria-label="Topic kind" value={createKind} onChange={(event) => setCreateKind(event.target.value as SemanticMemoryFile['kind'])}>
        {SEMANTIC_CONCEPT_KINDS.map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
      </select></label>
      <label><span>Topic name</span><input value={createTitle} maxLength={SEMANTIC_LABEL_MAX_LENGTH} onChange={(event) => setCreateTitle(event.target.value)} required /></label>
      <button type="submit" disabled={busyId !== null}>{busyId === 'create' ? 'Creating…' : 'Create summary'}</button>
      <button type="button" disabled={busyId !== null} onClick={() => setCreating(false)}>Cancel</button>
    </form>}
    {status && <p className="semantic-files__status" role="status">{status}</p>}
    {error && <div className="semantic-files__error" role="alert">{error}</div>}
    {loading ? <p className="semantic-files__empty">Loading memory topics…</p> : files.length === 0 ? <div className="semantic-files__empty"><strong>No summaries yet.</strong><span>Create a topic from existing memories using the button above. Topics are created and refreshed only when you ask. Every underlying memory stays in the Memory Bank below.</span></div> : KIND_GROUPS.map((group) => {
      const groupFiles = files.filter((file) => group.kinds.includes(file.kind));
      if (!groupFiles.length) return null;
      return <div className="semantic-files__group" key={group.id}>
        <h3>{group.label}</h3>
        {groupFiles.map(renderFile)}
      </div>;
    })}
  </section>;
}
