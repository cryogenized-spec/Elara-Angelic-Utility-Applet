import { useEffect, useMemo, useState, type DragEvent, type ReactElement } from 'react';
import type { ConversationThread } from '../../domain/chat';
import type { ConversationFolder } from '../../persistence/folders';
import { useFolders } from '../folders/FolderProvider';
import { Icon } from '../../ui/icons';
import './sidebar.css';

function formatThreadTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

type DragPayload = `${'thread' | 'folder'}:${string}`;
type DropTarget = string | 'root' | null;

function dragPayload(kind: 'thread' | 'folder', id: string): DragPayload {
  return `${kind}:${id}`;
}

function parseDragPayload(value: string): { kind: 'thread' | 'folder'; id: string } | null {
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if ((kind !== 'thread' && kind !== 'folder') || !id) return null;
  return { kind, id };
}

export function Sidebar({ open, threads, activeId, onClose, onSelect, onNewChat, onRename, onArchive, onDelete, onSettings }: {
  open: boolean; threads: ConversationThread[]; activeId: string; onClose: () => void; onSelect: (id: string) => void; onNewChat: () => void;
  onRename: (id: string, title: string) => void; onArchive: (id: string) => void; onDelete: (id: string) => void; onSettings: () => void;
}) {
  const { state: folderState, ready: foldersReady, create: createFolder, rename: renameFolder, remove: removeFolder, move: moveFolder, assignThread, setContextScope } = useFolders();
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState('');
  const [creatingUnder, setCreatingUnder] = useState<string | null | undefined>(undefined);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderError, setFolderError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget>(null);

  useEffect(() => {
    if (!open) {
      setQuery(''); setEditingId(null); setEditingFolderId(null); setCreatingUnder(undefined); setNewFolderName(''); setFolderError(null);
      setDragging(null); setDropTarget(null);
    }
  }, [open]);

  const visibleThreads = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return threads;
    return threads.filter((thread) => thread.title.toLocaleLowerCase().includes(normalized));
  }, [query, threads]);

  const allFolders = useMemo(() => {
    const byParent = new Map<string | null, ConversationFolder[]>();
    for (const folder of folderState.folders) {
      const siblings = byParent.get(folder.parentId) ?? [];
      siblings.push(folder);
      byParent.set(folder.parentId, siblings);
    }
    for (const siblings of byParent.values()) siblings.sort((a, b) => a.name.localeCompare(b.name));
    return byParent;
  }, [folderState.folders]);

  function folderPath(folderId: string): string {
    const names: string[] = [];
    let current = folderState.folders.find((folder) => folder.id === folderId);
    let guard = 0;
    while (current && guard < folderState.folders.length + 1) {
      names.unshift(current.name);
      current = current.parentId ? folderState.folders.find((folder) => folder.id === current?.parentId) : undefined;
      guard += 1;
    }
    return names.join('/');
  }

  function beginRename(thread: ConversationThread) { setEditingId(thread.id); setEditingTitle(thread.title); }
  function commitRename() {
    if (!editingId) return;
    const cleaned = editingTitle.trim();
    if (cleaned) onRename(editingId, cleaned);
    setEditingId(null); setEditingTitle('');
  }
  function beginFolderRename(folder: ConversationFolder) { setEditingFolderId(folder.id); setEditingFolderName(folder.name); setFolderError(null); }
  async function commitFolderRename() {
    if (!editingFolderId) return;
    try {
      const cleaned = editingFolderName.trim();
      if (cleaned) await renameFolder(editingFolderId, cleaned);
      setEditingFolderId(null); setEditingFolderName('');
    } catch (cause) {
      setFolderError(cause instanceof Error ? cause.message : 'Could not rename that folder.');
    }
  }
  async function submitFolderCreate() {
    try {
      const cleaned = newFolderName.trim();
      if (!cleaned) return;
      await createFolder(cleaned, creatingUnder ?? null);
      setNewFolderName(''); setCreatingUnder(undefined); setFolderError(null);
    } catch (cause) {
      setFolderError(cause instanceof Error ? cause.message : 'Could not create that folder.');
    }
  }
  async function changeMove(folderId: string, parentId: string | null) {
    try { await moveFolder(folderId, parentId); setFolderError(null); }
    catch (cause) { setFolderError(cause instanceof Error ? cause.message : 'Could not move that folder.'); }
  }
  async function changeScope(folderId: string, scope: ConversationFolder['contextScope']) {
    try { await setContextScope(folderId, scope); setFolderError(null); }
    catch (cause) { setFolderError(cause instanceof Error ? cause.message : 'Could not change memory scope.'); }
  }
  async function changeAssignment(threadId: string, folderId: string | null) {
    try { await assignThread(threadId, folderId); setFolderError(null); }
    catch (cause) { setFolderError(cause instanceof Error ? cause.message : 'Could not move that conversation.'); }
  }
  async function changeDelete(folderId: string) {
    try { await removeFolder(folderId); setFolderError(null); }
    catch (cause) { setFolderError(cause instanceof Error ? cause.message : 'Could not delete that folder.'); }
  }

  function moveTargetOptions(folderId: string): ConversationFolder[] {
    const blocked = new Set<string>([folderId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const folder of folderState.folders) {
        if (folder.parentId && blocked.has(folder.parentId) && !blocked.has(folder.id)) {
          blocked.add(folder.id); changed = true;
        }
      }
    }
    return folderState.folders.filter((folder) => !blocked.has(folder.id));
  }

  const threadMatches = (thread: ConversationThread) => !query.trim() || thread.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const threadsInFolder = (folderId: string) => visibleThreads.filter((thread) => (folderState.assignments[thread.id] ?? null) === folderId);

  function beginDrag(kind: 'thread' | 'folder', id: string, event: DragEvent<HTMLElement>): void {
    if (editingId === id || editingFolderId === id) return;
    const payload = dragPayload(kind, id);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', payload);
    setDragging(payload);
    setDropTarget(null);
  }

  function endDrag(): void {
    setDragging(null); setDropTarget(null);
  }

  function dragOver(target: DropTarget, event: DragEvent<HTMLElement>): void {
    if (!dragging) return;
    const payload = parseDragPayload(dragging);
    if (!payload) return;
    if (payload.kind === 'folder' && target === payload.id) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(target);
  }

  async function dropOn(targetFolderId: string | null, event: DragEvent<HTMLElement>): Promise<void> {
    event.preventDefault();
    const payload = parseDragPayload(event.dataTransfer.getData('text/plain')) ?? (dragging ? parseDragPayload(dragging) : null);
    setDropTarget(null); setDragging(null);
    if (!payload) return;
    try {
      if (payload.kind === 'thread') {
        await assignThread(payload.id, targetFolderId);
      } else {
        await moveFolder(payload.id, targetFolderId);
      }
      setFolderError(null);
    } catch (cause) {
      setFolderError(cause instanceof Error ? cause.message : 'Could not move that item.');
    }
  }

  function renderThread(thread: ConversationThread, nested = false) {
    const payload = dragPayload('thread', thread.id);
    return <div
      className={`thread-row${activeId === thread.id ? ' is-active' : ''}${nested ? ' thread-row--nested' : ''}${dragging === payload ? ' is-dragging' : ''}`}
      key={thread.id}
      draggable={editingId !== thread.id}
      onDragStart={(event) => beginDrag('thread', thread.id, event)}
      onDragEnd={endDrag}
    >
      {editingId === thread.id ? <input className="thread-rename-input" value={editingTitle} maxLength={80} autoFocus aria-label="Thread name" onChange={(event) => setEditingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') commitRename(); if (event.key === 'Escape') { setEditingId(null); setEditingTitle(''); } }} onBlur={commitRename} /> : <button className="thread" type="button" onClick={() => { onSelect(thread.id); onClose(); }}><span className="thread__title">{thread.title}</span><span className="thread__meta">{formatThreadTime(thread.updatedAt)}</span></button>}
      {editingId !== thread.id && <details className="thread-menu" onClick={(event) => event.stopPropagation()}><summary aria-label={`Thread actions for ${thread.title}`}><Icon name="dots" size={17} /></summary><div className="thread-menu__panel"><button type="button" onClick={() => beginRename(thread)}>Rename</button><label className="sidebar-menu-field"><span>Move to</span><select aria-label={`Move ${thread.title} to folder`} value={folderState.assignments[thread.id] ?? ''} onChange={(event) => void changeAssignment(thread.id, event.target.value || null)}><option value="">Unfiled</option>{folderState.folders.map((folder) => <option key={folder.id} value={folder.id}>{folderPath(folder.id)}</option>)}</select></label>{thread.id !== 'primary' && <button type="button" onClick={() => onArchive(thread.id)}>Archive</button>}{thread.id !== 'primary' && <button type="button" onClick={() => onDelete(thread.id)}>Delete</button>}</div></details>}
    </div>;
  }

  function renderFolder(folder: ConversationFolder): ReactElement {
    const children = allFolders.get(folder.id) ?? [];
    const payload = dragPayload('folder', folder.id);
    const isDropTarget = dropTarget === folder.id;
    return <details className={`folder-node${dragging === payload ? ' is-dragging' : ''}${isDropTarget ? ' is-drop-target' : ''}`} key={folder.id} open={!query.trim()}>
      <summary
        className="folder-row"
        draggable={editingFolderId !== folder.id}
        onDragStart={(event) => beginDrag('folder', folder.id, event)}
        onDragEnd={endDrag}
        onDragOver={(event) => dragOver(folder.id, event)}
        onDragLeave={() => { if (dropTarget === folder.id) setDropTarget(null); }}
        onDrop={(event) => void dropOn(folder.id, event)}
      >
        <span className="folder-row__chevron" aria-hidden="true">›</span>
        <span className="folder-row__icon" aria-hidden="true">□</span>
        {editingFolderId === folder.id ? <input className="folder-row__input" value={editingFolderName} maxLength={80} autoFocus aria-label="Folder name" onChange={(event) => setEditingFolderName(event.target.value)} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Enter') void commitFolderRename(); if (event.key === 'Escape') { setEditingFolderId(null); setEditingFolderName(''); } }} onBlur={() => void commitFolderRename()} /> : <span className="folder-row__name">{folder.name}</span>}
        <span className="folder-row__count">{threadsInFolder(folder.id).length}</span>
      </summary>
      <details className="folder-menu" onClick={(event) => event.stopPropagation()}><summary aria-label={`Folder actions for ${folderPath(folder.id)}`}><Icon name="dots" size={16} /></summary><div className="folder-menu__panel"><button type="button" onClick={() => { setCreatingUnder(folder.id); setFolderError(null); }}>New subfolder</button><button type="button" onClick={() => beginFolderRename(folder)}>Rename</button><label className="sidebar-menu-field"><span>Move to</span><select aria-label={`Move folder ${folderPath(folder.id)}`} value={folder.parentId ?? ''} onChange={(event) => void changeMove(folder.id, event.target.value || null)}><option value="">Root</option>{moveTargetOptions(folder.id).map((target) => <option key={target.id} value={target.id}>{folderPath(target.id)}</option>)}</select></label><label className="sidebar-menu-field"><span>Memory scope</span><select aria-label={`Memory scope for ${folderPath(folder.id)}`} value={folder.contextScope} onChange={(event) => void changeScope(folder.id, event.target.value as ConversationFolder['contextScope'])}><option value="folder">Folder only</option><option value="global">Global</option></select><small>Applies to durable-memory retrieval; normal chat history remains thread-scoped.</small></label><button type="button" className="is-danger" onClick={() => void changeDelete(folder.id)}>Delete folder</button></div></details>
      <div className="folder-node__children">{children.map(renderFolder)}{threadsInFolder(folder.id).filter(threadMatches).map((thread) => renderThread(thread, true))}{children.length === 0 && threadsInFolder(folder.id).length === 0 && <span className="folder-empty">Empty</span>}</div>
    </details>;
  }

  const unfiledThreads = visibleThreads.filter((thread) => !folderState.assignments[thread.id] && threadMatches(thread));
  const rootFolders = allFolders.get(null) ?? [];
  const rootDropActive = dropTarget === 'root';

  return <>
    <button className={`sidebar-backdrop${open ? ' is-open' : ''}`} aria-label="Close sidebar" type="button" onClick={onClose} />
    <aside className={`sidebar${open ? ' is-open' : ''}`} aria-label="Chat threads" aria-hidden={!open}>
      <div className="sidebar__head"><div><div className="eyebrow">CONVERSATIONS</div><h2>Threads</h2></div><button className="icon-button" type="button" aria-label="Close sidebar" onClick={onClose}><Icon name="close" /></button></div>
      <button className="sidebar-new-chat" type="button" onClick={onNewChat}><Icon name="plus" size={18} /><span>New chat</span></button>
      <label className="sidebar-search"><Icon name="search" size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" aria-label="Search chats" /></label>
      <div
        className={`folder-toolbar${rootDropActive ? ' is-drop-target' : ''}`}
        onDragOver={(event) => dragOver('root', event)}
        onDragLeave={() => { if (dropTarget === 'root') setDropTarget(null); }}
        onDrop={(event) => void dropOn(null, event)}
      >
        <span className="folder-toolbar__label">FOLDERS</span>
        <span className="folder-toolbar__hint">Drag chats or folders to move</span>
        <button type="button" className="folder-toolbar__add" aria-label="Create folder" disabled={!foldersReady} onClick={() => { setCreatingUnder(null); setFolderError(null); }}><Icon name="plus" size={15} /> New</button>
      </div>
      {creatingUnder !== undefined && <form className="folder-create" onSubmit={(event) => { event.preventDefault(); void submitFolderCreate(); }}><input value={newFolderName} onChange={(event) => setNewFolderName(event.target.value)} autoFocus placeholder={creatingUnder ? 'Subfolder or nested/path' : 'Folder or Project/Section'} aria-label="New folder name" /><button type="submit">Create</button><button type="button" onClick={() => { setCreatingUnder(undefined); setNewFolderName(''); }}>Cancel</button></form>}
      {folderError && <div className="folder-error" role="alert">{folderError}</div>}
      <div className="thread-list" aria-label="Conversation threads">
        {rootFolders.map(renderFolder)}
        {unfiledThreads.map((thread) => renderThread(thread))}
        {visibleThreads.length === 0 && <p className="sidebar-empty">No conversations match “{query}”.</p>}
        {visibleThreads.length > 0 && rootFolders.length === 0 && unfiledThreads.length === 0 && <p className="sidebar-empty">No matching threads in the current folders.</p>}
      </div>
      <div className="sidebar__footer"><button className="sidebar-action" type="button" aria-label="Open settings" onClick={onSettings}><Icon name="settings" size={19} /><span>Settings</span></button></div>
    </aside>
  </>;
}
