import { useEffect, useMemo, useRef, useState } from 'react';
import type { DurableMemory, MemoryKind } from '../../memory/types';
import { archiveMemory, deleteMemory, listMemories, promoteMemory, saveMemory, updateMemory } from '../../memory/store';
import { deleteInvalidMemoryRecord, inspectMemoryStore, type MemoryStoreHealth } from '../../memory/health';
import { buildMemoryMaintenanceReport, filterMemoryRecords, type MemoryInspectionFilter, type MemoryMaintenanceReport } from '../../memory/inspection';
import { memoryProvenanceView } from '../../memory/provenance';
import { sweepMemoryLifecycle } from '../../memory/lifecycle';
import {
  importMemoryArchive,
  MEMORY_ARCHIVE_MAX_BYTES,
  parseMemoryArchiveText,
  serializeMemoryArchive,
  type MemoryArchive,
} from '../../memory/archive';
import { useFolders } from '../folders/FolderProvider';
import { MarkdownText } from './MarkdownText';
import './durable-memory-settings.css';

const MEMORY_GUIDE_URL = 'https://github.com/cryogenized-spec/Elara-Angelic-Utility-Applet/blob/main/documents/memory.md#memory-bank';
const MEMORY_KINDS: MemoryKind[] = ['CORE', 'CONTEXTUAL', 'EPISODIC', 'MICRO_OBSERVATION'];
const MEMORY_LIFECYCLES = ['active', 'dormant', 'archived'] as const;

type ImportPreview = { name: string; archive: MemoryArchive; coreCount: number };

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

function lifecycleReasonLabel(reason: MemoryMaintenanceReport['lifecycleCandidates'][number]['reason']): string {
  switch (reason) {
    case 'superseded': return 'superseded history → dormant';
    case 'expired': return 'expired → dormant';
    case 'stale-organic': return 'stale weak observation → dormant';
    case 'promote-episodic': return 'supported observation → episodic';
    case 'promote-contextual': return 'repeated episodic evidence → contextual';
  }
}

export function DurableMemorySettings() {
  const { state: folderState } = useFolders();
  const [memories, setMemories] = useState<DurableMemory[]>([]);
  const [storeHealth, setStoreHealth] = useState<MemoryStoreHealth | null>(null);
  const [filter, setFilter] = useState<MemoryInspectionFilter>('all');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const expandedRef = useRef<HTMLElement | null>(null);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState({ title: '', body: '', kind: 'CONTEXTUAL' as MemoryKind, folderId: '', importance: '0.5', confidence: '0.7', tags: '' });
  const [maintenanceReport, setMaintenanceReport] = useState<MemoryMaintenanceReport | null>(null);
  const [maintenanceStatus, setMaintenanceStatus] = useState<string | null>(null);
  const [archiveStatus, setArchiveStatus] = useState<string | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importFolderId, setImportFolderId] = useState('');

  async function refresh() {
    setLoading(true);
    try {
      const [records, health] = await Promise.all([listMemories(), inspectMemoryStore()]);
      setMemories(records);
      setStoreHealth(health);
      setMaintenanceReport(null);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load durable memories.'); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    let active = true;
    void Promise.all([listMemories(), inspectMemoryStore()]).then(([records, health]) => {
      if (!active) return;
      setMemories(records);
      setStoreHealth(health);
      setError(null);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load durable memories.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, []);

  const filtered = useMemo(() => filterMemoryRecords(memories, filter, query), [filter, memories, query]);
  const memoryById = useMemo(() => new Map(memories.map((memory) => [memory.id, memory])), [memories]);
  const visibleExpandedId = expandedId && filtered.some((memory) => memory.id === expandedId) ? expandedId : null;

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
  async function handleRemoveInvalid(id: string) {
    if (!window.confirm(`Remove corrupted memory record ${id}? This repair path only accepts rows that fail the canonical memory schema.`)) return;
    try { await deleteInvalidMemoryRecord(id); setError(null); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove that corrupted memory record.'); }
  }
  async function handleArchive(id: string) { try { await archiveMemory(id); setError(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not archive that memory.'); } }
  async function handleRestore(id: string) { try { await updateMemory(id, { lifecycle: 'active' }); setError(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not restore that memory.'); } }
  async function handlePromote(id: string) { try { await promoteMemory(id); setError(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not promote that memory.'); } }
  async function handlePin(memory: DurableMemory) { try { await updateMemory(memory.id, { pinned: memory.pinned !== true }); setError(null); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change landmark state.'); } }

  function runMaintenanceAudit() {
    const report = buildMemoryMaintenanceReport(memories);
    setMaintenanceReport(report);
    setMaintenanceStatus(`Reviewed ${report.reviewed} memories. No changes were made.`);
  }

  async function applyLifecycleMaintenance() {
    if (!maintenanceReport?.lifecycleCandidates.length) return;
    if (!window.confirm(`Apply ${maintenanceReport.lifecycleCandidates.length} lifecycle recommendation${maintenanceReport.lifecycleCandidates.length === 1 ? '' : 's'}? This may promote supported evidence or move stale/superseded/expired memories to dormant. It never deletes records.`)) return;
    try {
      const result = await sweepMemoryLifecycle();
      const records = await listMemories();
      setMemories(records);
      setMaintenanceReport(buildMemoryMaintenanceReport(records));
      setMaintenanceStatus(`Applied lifecycle maintenance: ${result.changed} changed · ${result.promoted} promoted · ${result.dormant} dormant.`);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not apply lifecycle maintenance.'); }
  }

  function exportArchive() {
    try {
      const text = serializeMemoryArchive(memories);
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `elara-memory-bank-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setArchiveStatus(`Exported ${memories.length} memories to a local JSON archive.`);
      setError(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not export the Memory Bank.'); }
  }

  async function selectImportFile(file: File | undefined) {
    if (!file) return;
    try {
      if (file.size > MEMORY_ARCHIVE_MAX_BYTES) throw new Error('Memory archive exceeds the import size limit.');
      const archive = parseMemoryArchiveText(await file.text());
      setImportPreview({ name: file.name, archive, coreCount: archive.memories.filter((memory) => memory.kind === 'CORE').length });
      setArchiveStatus(`${archive.memories.length} memories are ready for review before import.`);
      setError(null);
    } catch (cause) {
      setImportPreview(null);
      setError(cause instanceof Error ? cause.message : 'Could not read that memory archive.');
    }
  }

  async function commitImport() {
    if (!importPreview) return;
    try {
      const result = await importMemoryArchive(importPreview.archive, { folderId: importFolderId || null });
      setImportPreview(null);
      setArchiveStatus(`Imported ${result.imported} memories · ${result.coreDemoted} CORE record${result.coreDemoted === 1 ? '' : 's'} restarted as CONTEXTUAL · ${result.relationshipLinksRestored} relationship links restored.`);
      setError(null);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not import that memory archive.'); }
  }

  return <div className="memory-settings">
    <div className="memory-settings__header">
      <div><strong>Memory Bank</strong><span>One human-facing view over the canonical durable-memory store. Search, audit, landmarks and archives do not create a second memory database.</span></div>
      <button type="button" onClick={() => { resetDraft(); setCreating(true); }}>New memory</button>
    </div>

    <div className="memory-settings__guide">
      <div><strong>New to memory?</strong><span>Read the user guide for how memories are stored, retrieved, scoped, and protected.</span></div>
      <a href={MEMORY_GUIDE_URL} target="_blank" rel="noreferrer">Read the Memory Guide <span aria-hidden="true">↗</span></a>
    </div>

    {storeHealth && storeHealth.invalid > 0 && <section className="memory-maintenance" aria-labelledby="memory-integrity-title">
      <div className="memory-panel__header">
        <div><strong id="memory-integrity-title">Store integrity needs attention</strong><span>{storeHealth.invalid} malformed record{storeHealth.invalid === 1 ? '' : 's'} quarantined. Valid memories remain available; corrupted rows are never repaired or deleted automatically.</span></div>
      </div>
      <div className="memory-maintenance__group"><strong>Corrupted records</strong>{storeHealth.invalidIds.map((id, index) => <p key={`${id}:${index}`}><span>{id}</span>{id === '<unknown>' ? <small>Unknown primary key — automatic removal is disabled.</small> : <button type="button" className="danger" onClick={() => void handleRemoveInvalid(id)}>Remove invalid record</button>}</p>)}</div>
    </section>}

    <section className="memory-maintenance" aria-labelledby="memory-maintenance-title">
      <div className="memory-panel__header">
        <div><strong id="memory-maintenance-title">Audit & maintenance</strong><span>Deterministic review only. Duplicate and contradiction findings are never auto-merged or deleted.</span></div>
        <button type="button" onClick={runMaintenanceAudit}>Audit Memory Bank</button>
      </div>
      {maintenanceStatus && <p className="memory-panel__status" role="status">{maintenanceStatus}</p>}
      {maintenanceReport && <>
        <div className="memory-maintenance__summary" aria-label="Memory maintenance summary">
          <span><strong>{maintenanceReport.duplicateGroups.length}</strong> duplicate group{maintenanceReport.duplicateGroups.length === 1 ? '' : 's'}</span>
          <span><strong>{maintenanceReport.contradictionClusters.length}</strong> contradiction cluster{maintenanceReport.contradictionClusters.length === 1 ? '' : 's'}</span>
          <span><strong>{maintenanceReport.lifecycleCandidates.length}</strong> lifecycle candidate{maintenanceReport.lifecycleCandidates.length === 1 ? '' : 's'}</span>
        </div>
        {maintenanceReport.duplicateGroups.length > 0 && <div className="memory-maintenance__group"><strong>Exact duplicate review</strong>{maintenanceReport.duplicateGroups.map((ids) => <p key={ids.join(':')}>{ids.map((id) => memoryById.get(id)?.title ?? 'Unknown memory').join(' · ')}</p>)}</div>}
        {maintenanceReport.contradictionClusters.length > 0 && <div className="memory-maintenance__group"><strong>Contradiction review</strong>{maintenanceReport.contradictionClusters.map((ids) => <p key={ids.join(':')}>{ids.map((id) => memoryById.get(id)?.title ?? 'Unknown memory').join(' ↔ ')}</p>)}</div>}
        {maintenanceReport.lifecycleCandidates.length > 0 && <div className="memory-maintenance__group"><strong>Lifecycle recommendations</strong>{maintenanceReport.lifecycleCandidates.map((candidate) => <p key={candidate.id}><b>{candidate.title}</b><span>{lifecycleReasonLabel(candidate.reason)}</span></p>)}<button type="button" onClick={() => void applyLifecycleMaintenance()}>Apply lifecycle recommendations</button></div>}
      </>}
    </section>

    <section className="memory-archive" aria-labelledby="memory-archive-title">
      <div className="memory-panel__header">
        <div><strong id="memory-archive-title">Backup & transfer</strong><span>Archives stay local. Imports receive fresh IDs, use your selected scope, and never restore autonomy consent.</span></div>
        <div className="memory-panel__actions"><button type="button" onClick={exportArchive}>Export JSON</button><button type="button" onClick={() => importInputRef.current?.click()}>Choose archive</button></div>
      </div>
      <input className="memory-archive__file" ref={importInputRef} type="file" accept="application/json,.json" onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void selectImportFile(file); }} />
      {archiveStatus && <p className="memory-panel__status" role="status">{archiveStatus}</p>}
      {importPreview && <div className="memory-archive__preview">
        <div><strong>{importPreview.name}</strong><span>{importPreview.archive.memories.length} memories · {importPreview.coreCount} CORE record{importPreview.coreCount === 1 ? '' : 's'} will restart as CONTEXTUAL.</span></div>
        <label><span>Import scope</span><select value={importFolderId} onChange={(event) => setImportFolderId(event.target.value)}><option value="">Global</option>{folderState.folders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder.id, folderState.folders)}</option>)}</select></label>
        <div className="memory-panel__actions"><button type="button" onClick={() => setImportPreview(null)}>Cancel</button><button type="button" className="primary" onClick={() => void commitImport()}>Import {importPreview.archive.memories.length}</button></div>
      </div>}
    </section>

    <div className="memory-settings__search">
      <label><span>Search memories</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, body, or tags…" type="search" /></label>
      {query && <button type="button" onClick={() => setQuery('')} aria-label="Clear memory search">Clear</button>}
    </div>

    <div className="memory-settings__filters">
      <label><span>Filter</span><select value={filter} onChange={(event) => setFilter(event.target.value as MemoryInspectionFilter)}><option value="all">All records</option><option value="pinned">Pinned landmarks</option><optgroup label="Lifecycle">{MEMORY_LIFECYCLES.map((value) => <option key={value} value={value}>{value}</option>)}</optgroup><optgroup label="Kind">{MEMORY_KINDS.map((value) => <option key={value} value={value}>{value.replace('_', ' ')}</option>)}</optgroup><optgroup label="Provenance"><option value="provenance:explicit-user">Explicit user memories</option><option value="provenance:observed-user-evidence">Observed user evidence</option><option value="provenance:elara-managed">Elara-managed memories</option><option value="provenance:imported">Imported archives</option><option value="provenance:migrated">Migrated memories</option></optgroup><option value="global">Global scope</option></select></label>
      <small>{filtered.length} shown · {memories.length} valid · {storeHealth?.total ?? memories.length} stored · canonical store</small>
    </div>

    {error && <div className="memory-settings__error" role="alert">{error}</div>}

    {(creating || editingId) && <div className="memory-editor"><div className="memory-editor__title">{editingId ? 'Edit memory' : 'Create memory'}</div><label><span>Title</span><input value={draft.title} maxLength={160} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label><label><span>Memory body · Markdown supported</span><textarea value={draft.body} maxLength={50000} onChange={(event) => setDraft((current) => ({ ...current, body: event.target.value }))} /><small>Long memories stay intact in the bank and are recalled as bounded excerpts when needed.</small></label><div className="memory-editor__grid"><label><span>Kind</span><select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as MemoryKind }))}>{MEMORY_KINDS.map((kind) => <option key={kind} value={kind}>{kind.replace('_', ' ')}</option>)}</select></label><label><span>Scope</span><select value={draft.folderId} onChange={(event) => setDraft((current) => ({ ...current, folderId: event.target.value }))}><option value="">Global</option>{folderState.folders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder.id, folderState.folders)}</option>)}</select></label><label><span>Importance</span><input type="number" min="0" max="1" step="0.05" value={draft.importance} onChange={(event) => setDraft((current) => ({ ...current, importance: event.target.value }))} /></label><label><span>Confidence</span><input type="number" min="0" max="1" step="0.05" value={draft.confidence} onChange={(event) => setDraft((current) => ({ ...current, confidence: event.target.value }))} /></label></div><label><span>Tags</span><input value={draft.tags} maxLength={2048} placeholder="identity, preference, project" onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} /></label><div className="memory-editor__actions"><button type="button" onClick={resetDraft}>Cancel</button><button type="button" className="primary" onClick={() => void saveDraft()}>{editingId ? 'Save changes' : 'Create memory'}</button></div></div>}

    {loading ? <p className="memory-settings__empty">Loading durable memories…</p> : filtered.length === 0 ? <div className="memory-settings__empty"><strong>No memories match.</strong><span>Try another search or filter, or create an explicit durable note.</span></div> : <div className="memory-list">{filtered.map((memory) => {
      const expanded = visibleExpandedId === memory.id;
      const provenance = memoryProvenanceView(memory);
      return <article className={`memory-card${expanded ? ' is-expanded' : ''}`} key={memory.id} ref={expanded ? expandedRef : undefined}>
        <button className="memory-card__summary" type="button" onClick={() => openRecord(memory.id)} aria-expanded={expanded}>
          <span className="memory-card__summary-main"><strong>{memory.title}</strong><small>{memory.body.replace(/\s+/g, ' ').slice(0, 180)}{memory.body.length > 180 ? '…' : ''}</small></span>
          <span className="memory-card__chevron" aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
        </button>
        <div className="memory-card__meta"><span>{memory.kind.replace('_', ' ')}</span><span>{memory.lifecycle}</span><span>{memory.folderId ? folderPath(memory.folderId, folderState.folders) : 'Global'}</span>{memory.pinned === true && <span>Landmark</span>}</div>
        {expanded && <div className="memory-card__detail"><div className="memory-card__markdown"><MarkdownText text={memory.body} /></div>{memory.tags.length > 0 && <div className="memory-card__tags">{memory.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}<div className="memory-card__stats"><small>Confidence {Math.round(memory.confidence * 100)}% · Importance {Math.round(memory.importance * 100)}%</small><small>Recalled {memory.recallCount}× · Reinforced {memory.reinforcementCount}×</small><small>Observed {formatDate(memory.observedAt)} · Updated {formatDate(memory.updatedAt)}</small><small>Provenance: {provenance.label}</small></div><div className="memory-card__actions"><button type="button" onClick={() => beginEdit(memory)}>Edit</button><button type="button" onClick={() => void handlePin(memory)}>{memory.pinned === true ? 'Unpin landmark' : 'Pin landmark'}</button>{memory.lifecycle === 'archived' ? <button type="button" onClick={() => void handleRestore(memory.id)}>Restore</button> : <button type="button" onClick={() => void handleArchive(memory.id)}>Archive</button>}{memory.kind !== 'CORE' && memory.lifecycle !== 'archived' && <button type="button" onClick={() => void handlePromote(memory.id)}>Promote</button>}<button type="button" className="danger" onClick={() => void handleDelete(memory.id)}>Delete</button></div></div>}
      </article>;
    })}</div>}
  </div>;
}