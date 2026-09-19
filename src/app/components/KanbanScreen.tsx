import { patchBoardTask, createBoardTask } from "../../kanban/task-writes";
import { moveBefore, moveOne, type TaskMove } from "../../kanban/reordering";
import type { TaskListSummary } from "../../kanban/google-port";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  GripVertical,
  Pencil,
  Trash2,
  Plus,
  RefreshCw,
  Settings2,
  ListTodo,
  CircleCheck,
  Clock3,
  X,
  Search,
  Bell,
  LayoutGrid,
  ChevronRight,
} from "lucide-react";
import {
  boardStore,
  currentAccount,
  orderedTasks,
  overdueDays,
  overdueMemo,
  saveRoutine,
  removeRoutine,
  syncBoard,
  taskService,
  type BoardTask,
  type Subroutine,
} from "../../kanban/store";
import "./kanban-screen.css";

type Editor =
  | { kind: "task"; task?: BoardTask; listId?: string }
  | { kind: "list"; list?: TaskListSummary }
  | { kind: "routine"; rule?: Subroutine }
  | null;
type Removal =
  | { kind: "task"; task: BoardTask }
  | { kind: "list"; list: TaskListSummary }
  | { kind: "routine"; rule: Subroutine };
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="kb-dialog"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" aria-label="Close dialog" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      {children}
    </dialog>
  );
}

function KanbanWorkspace({
  onBack,
  onSettings,
}: {
  onBack: () => void;
  onSettings: () => void;
}) {
  const { board, busy, error, phase, nextRetryAt } = useSyncExternalStore(
    boardStore.subscribe,
    boardStore.getSnapshot,
  );
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [palette, setPalette] = useState(false);
  const [memoOpen, setMemoOpen] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [removal, setRemoval] = useState<Removal | null>(null);
  const [dragged, setDragged] = useState<BoardTask | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const canReorder = !saving && !busy && filter === "all" && !query;
  const [actionError, setActionError] = useState<string | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    void syncBoard("automatic");
  }, []);
  useEffect(() => {
    const now = Date.now();
    const nextDay = new Date(now);
    nextDay.setHours(24, 0, 0, 50);
    const wakeAt = nextRetryAt !== null && nextRetryAt > now
      ? Math.min(nextRetryAt, nextDay.getTime())
      : nextDay.getTime();
    const timer = window.setTimeout(
      () => setClock(Date.now()),
      Math.min(2_147_483_647, Math.max(1_000, wakeAt - now)),
    );
    return () => clearTimeout(timer);
  }, [nextRetryAt, clock]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key === "k" &&
        !document.querySelector(".kb-dialog[open]")
      ) {
        event.preventDefault();
        setPalette((open) => !open);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const localDay = new Date(clock).toDateString();
  const memo = useMemo(() => board ? overdueMemo(board, new Date(localDay)) : [], [board, localDay]);
  const tasksByList = useMemo(() => {
    const groups = new Map<string, BoardTask[]>();
    for (const task of board?.tasks ?? []) {
      const group = groups.get(task.listId);
      if (group) group.push(task); else groups.set(task.listId, [task]);
    }
    for (const [id, tasks] of groups) groups.set(id, orderedTasks(tasks));
    return groups;
  }, [board?.tasks]);
  const openCount = useMemo(() => board?.tasks.filter((task) => task.status !== 'completed').length ?? 0, [board?.tasks]);
  const openEditor = (next: Editor) => {
    setPalette(false);
    setActionError(null);
    setEditor(next);
  };
  async function run(action: () => Promise<unknown>, close = false, reconcile = true) {
    if (savingRef.current || !board) return;
    savingRef.current = true;
    setSaving(true);
    setActionError(null);
    try {
      if ((await currentAccount()) !== board.account)
        throw new Error("Account changed. Sync before editing.");
      await action();
      if (close) {
        setEditor(null);
        setRemoval(null);
      }
      if (reconcile) await syncBoard("mutation");
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : "Could not save. Check Google before retrying to avoid duplicate tasks.",
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }
  function askToRemove(next: Removal) {
    setEditor(null);
    setActionError(null);
    setRemoval(next);
  }
  function reorder(move: TaskMove | null, task: BoardTask) {
    if (!move || !canReorder) return;
    void run(async () => {
      const latest = await taskService.getTask(move.listId, move.taskId);
      if (
        (latest.parent ?? "") !== (task.parent ?? "") ||
        (task.etag && latest.etag !== task.etag)
      ) {
        throw new Error("This task changed in Google. Sync before reordering.");
      }
      await taskService.moveTask(
        move.listId,
        move.taskId,
        move.parent,
        move.previous,
      );
      setAnnouncement(`Moved ${task.title || "task"}.`);
    });
  }
  function dropBefore(target: BoardTask) {
    if (dragged && board)
      reorder(moveBefore(board.tasks, dragged, target), dragged);
    setDragged(null);
    setDropTarget(null);
  }
  function visible(task: BoardTask) {
    return (
      `${task.title} ${task.notes ?? ""}`
        .toLowerCase()
        .includes(query.toLowerCase()) &&
      (filter === "all" ||
        (filter === "open" && task.status !== "completed") ||
        (filter === "done" && task.status === "completed") ||
        (filter === "overdue" &&
          task.status !== "completed" &&
          overdueDays(task.scheduledDate) > 0))
    );
  }
  return (
    <section className="kb-screen" aria-label="Task orchestration workspace">
      <p className="kb-sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      <header className="kb-header">
        <div className="kb-heading">
          <button
            className="kb-back"
            onClick={onBack}
            aria-label="Back to chat"
          >
            <ArrowLeft size={20} />
          </button>
          <div>
            <span className="kb-eyebrow">ELARA / WORKSPACE</span>
            <h1>
              Task orchestration <span>Google Tasks</span>
            </h1>
          </div>
        </div>
        <div className="kb-header-actions">
          <button
            onClick={() => setMemoOpen(!memoOpen)}
            aria-expanded={memoOpen}
            aria-label={`Internal memo ${memo.length}`}
          >
            <Bell size={16} /> <span>Internal memo</span>
            <b>{memo.length}</b>
          </button>
          <button
            onClick={() => void syncBoard()}
            disabled={busy || saving || (nextRetryAt !== null && nextRetryAt > clock)}
            title="Reconcile with Google Tasks"
            aria-label={busy ? "Syncing" : nextRetryAt !== null && nextRetryAt > clock ? "Cooling down" : "Sync now"}
          >
            <RefreshCw size={16} className={busy ? "kb-spinning" : ""} />
            <span>{busy ? "Syncing" : nextRetryAt !== null && nextRetryAt > clock ? "Cooling down" : "Sync now"}</span>
          </button>
        </div>
      </header>
      <div className="kb-toolbar">
        <div className="kb-search">
          <Search size={16} />
          <input
            aria-label="Search tasks"
            placeholder="Search your workspace…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          aria-label="Filter tasks"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option value="all">All tasks</option>
          <option value="open">Open tasks</option>
          <option value="overdue">Overdue</option>
          <option value="done">Completed</option>
        </select>
        <div className="kb-sync-label" role="status">
          {phase === 'waiting' ? 'Another tab is refreshing · ' : phase === 'backoff' && nextRetryAt !== null && nextRetryAt > clock ? 'Provider cooldown · ' : phase === 'offline' ? 'Offline · ' : phase === 'paused' ? 'Auto-sync paused · ' : ''}
          {board
            ? `${openCount} open · Synced ${new Date(board.syncedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
            : "Your tasks, one workspace"}
        </div>
      </div>
      {error && (
        <div className="kb-notice" role="alert">
          {error}{" "}
          {board && <span>Showing the last complete snapshot. {phase === "paused" ? "Use Sync now after resolving the issue." : "No task writes will be retried."}</span>}
          {!board && (
            <button onClick={onSettings}>
              Google settings <ChevronRight size={14} />
            </button>
          )}
        </div>
      )}
      {actionError && !editor && (
        <div className="kb-notice" role="alert">
          {actionError}
        </div>
      )}
      <div className="kb-body">
        <div
          className="kb-viewport"
          tabIndex={0}
          aria-label="Kanban canvas. Scroll horizontally and vertically to explore lists."
        >
          <div className="kb-canvas">
            {board?.lists.map((list, index) => {
              const tasks = tasksByList.get(list.id) ?? [];
              const matches = tasks.filter(visible);
              return (
                <section
                  className="kb-column"
                  key={list.id}
                  aria-label={list.title}
                  style={
                    {
                      "--column-accent": [
                        "#a6a0f7",
                        "#79b8dc",
                        "#e7b77e",
                        "#91cbb3",
                      ][index % 4],
                    } as React.CSSProperties
                  }
                >
                  <header>
                    <div>
                      <i />
                      <h2>{list.title || "Untitled list"}</h2>
                      <span>{tasks.length}</span>
                    </div>
                    <button
                      aria-label={`Manage list ${list.title}`}
                      disabled={saving}
                      onClick={() => openEditor({ kind: "list", list })}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      aria-label={`Add task to ${list.title}`}
                      onClick={() =>
                        openEditor({ kind: "task", listId: list.id })
                      }
                    >
                      <Plus size={17} />
                    </button>
                  </header>
                  <div className="kb-cards">
                    {matches.map((task) => {
                      const late =
                        task.status !== "completed" &&
                        overdueDays(task.scheduledDate) > 0;
                      return (
                        <article
                          key={task.id}
                          data-drop-target={
                            dropTarget === `${task.listId}/${task.id}` ||
                            undefined
                          }
                          onDragOver={(event) => {
                            if (
                              canReorder &&
                              dragged &&
                              moveBefore(board.tasks, dragged, task)
                            ) {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              setDropTarget(`${task.listId}/${task.id}`);
                            }
                          }}
                          onDragLeave={() => setDropTarget(null)}
                          onDrop={(event) => {
                            event.preventDefault();
                            dropBefore(task);
                          }}
                          className={`kb-card${task.status === "completed" ? " is-complete" : ""}${task.parent ? " is-child" : ""}`}
                        >
                          {task.parent && (
                            <small className="kb-parent">
                              ↳{" "}
                              {tasks.find((parent) => parent.id === task.parent)
                                ?.title ?? "Subtask"}
                            </small>
                          )}
                          <div className="kb-card-top">
                            <button
                              className="kb-grip"
                              aria-label={`Drag ${task.title} to reorder among siblings`}
                              title="Drag before a sibling task. Or use the up/down buttons."
                              disabled={!canReorder}
                              draggable={canReorder}
                              onDragStart={(event) => {
                                setDragged(task);
                                event.dataTransfer.effectAllowed = "move";
                                event.dataTransfer.setData(
                                  "text/plain",
                                  task.id,
                                );
                              }}
                              onDragEnd={() => {
                                setDragged(null);
                                setDropTarget(null);
                              }}
                            >
                              <GripVertical size={14} />
                            </button>
                            <button
                              className="kb-check"
                              disabled={saving}
                              aria-label={`${task.status === "completed" ? "Reopen" : "Complete"} ${task.title}`}
                              aria-pressed={task.status === "completed"}
                              onClick={() =>
                                void run(() =>
                                  patchBoardTask(
                                    list.id,
                                    task.id,
                                    {
                                      status:
                                        task.status === "completed"
                                          ? "needsAction"
                                          : "completed",
                                    },
                                    task.etag,
                                  ),
                                )
                              }
                            >
                              {task.status === "completed" ? (
                                <CircleCheck size={18} />
                              ) : (
                                <span />
                              )}
                            </button>
                            <button
                              className="kb-task-title"
                              onClick={() =>
                                openEditor({
                                  kind: "task",
                                  task,
                                  listId: list.id,
                                })
                              }
                            >
                              {task.title || "Untitled task"}
                            </button>
                          </div>
                          {task.notes && <p>{task.notes}</p>}
                          <footer>
                            {task.scheduledDate ? (
                              <span
                                className={late ? "kb-due is-late" : "kb-due"}
                              >
                                <Clock3 size={12} />
                                {task.scheduledDate.slice(0, 10)}
                                {late ? " · Overdue" : ""}
                              </span>
                            ) : (
                              <span className="kb-no-date">No due date</span>
                            )}
                            {task.status === "completed" && (
                              <span className="kb-done">Done</span>
                            )}
                            <div className="kb-order-controls">
                              <button
                                aria-label={`Move ${task.title} up`}
                                title="Move up among siblings"
                                disabled={
                                  !canReorder || !moveOne(board.tasks, task, -1)
                                }
                                onClick={() =>
                                  reorder(moveOne(board.tasks, task, -1), task)
                                }
                              >
                                <ArrowUp size={13} />
                              </button>
                              <button
                                aria-label={`Move ${task.title} down`}
                                title="Move down among siblings"
                                disabled={
                                  !canReorder || !moveOne(board.tasks, task, 1)
                                }
                                onClick={() =>
                                  reorder(moveOne(board.tasks, task, 1), task)
                                }
                              >
                                <ArrowDown size={13} />
                              </button>
                            </div>
                          </footer>
                        </article>
                      );
                    })}
                    {!matches.length && (
                      <div className="kb-column-empty">
                        {tasks.length
                          ? "No tasks match this view."
                          : "A little room for what comes next."}
                      </div>
                    )}
                  </div>
                  <button
                    className="kb-add-task"
                    onClick={() =>
                      openEditor({ kind: "task", listId: list.id })
                    }
                  >
                    <Plus size={15} /> Add task
                  </button>
                </section>
              );
            })}
            {board && (
              <button
                className="kb-add-list"
                onClick={() => openEditor({ kind: "list" })}
              >
                <Plus size={19} /> Create new list
              </button>
            )}
            {!board && (
              <div className="kb-empty">
                <LayoutGrid size={38} />
                <span className="kb-eyebrow">A CLEARER SPACE TO THINK</span>
                <h2>Make room for what matters.</h2>
                <p>
                  Your Google task lists become columns. Your tasks stay exactly
                  where you left them.
                </p>
                <button onClick={onSettings}>
                  Connect Google Tasks <ChevronRight size={16} />
                </button>
                <small>No sample tasks. No duplicate task store.</small>
              </div>
            )}
          </div>
        </div>
        {memoOpen && (
          <aside className="kb-memo" aria-label="Internal memo">
            <header>
              <h2>
                <Bell size={17} /> Internal memo
              </h2>
              <button
                aria-label="Close memo"
                onClick={() => setMemoOpen(false)}
              >
                <X size={16} />
              </button>
            </header>
            <p>
              Overdue tasks surfaced for Elara’s next conversation. The
              originals stay in their lists.
            </p>
            {memo.map((task) => (
              <button
                className="kb-memo-task"
                key={`${task.listId}/${task.id}`}
                onClick={() =>
                  openEditor({ kind: "task", task, listId: task.listId })
                }
              >
                {task.title}
                <small>{overdueDays(task.scheduledDate)} days overdue</small>
              </button>
            ))}
            {!memo.length && (
              <div className="kb-memo-empty">No matching overdue tasks.</div>
            )}
            <h3>Subroutines</h3>
            {board?.routines.map((rule) => (
              <div className="kb-rule" key={rule.id}>
                <input
                  type="checkbox"
                  aria-label={`Enable ${rule.name}`}
                  checked={rule.enabled}
                  disabled={saving}
                  onChange={() =>
                    void run(() =>
                      saveRoutine({ ...rule, enabled: !rule.enabled }, rule), false, false,
                    )
                  }
                />
                <span>
                  {rule.name}
                  <small>
                    {rule.days}+ days overdue ·{" "}
                    {board.lists.find((list) => list.id === rule.listId)
                      ?.title ?? (rule.listId ? "Deleted list" : "All lists")}
                  </small>
                </span>
                <button
                  aria-label={`Edit subroutine ${rule.name}`}
                  disabled={saving}
                  onClick={() => openEditor({ kind: "routine", rule })}
                >
                  <Pencil size={14} />
                </button>
              </div>
            ))}
            <button
              disabled={!board}
              onClick={() => openEditor({ kind: "routine" })}
            >
              <Plus size={15} /> Create subroutine
            </button>
            <small className="kb-memo-footnote">
              Local to this browser and Google account. Evaluated while the app
              is open; not a push notification service.
            </small>
          </aside>
        )}
      </div>
      <footer className="kb-footer">
        <span>
          <span className="kb-dot" />{" "}
          {board?.account ?? "Google Tasks workspace"}
        </span>
        <span>Two-way sync · every 20 min while visible</span>
      </footer>
      <button
        className="kb-wheel"
        onClick={() => setPalette(true)}
        aria-label="Open workspace command palette"
        title="Workspace commands (Ctrl/⌘ K)"
      >
        <Settings2 size={23} />
      </button>
      {palette && (
        <Modal title="Workspace commands" onClose={() => setPalette(false)}>
          <p className="kb-dialog-copy">
            A little structure. A lot more clarity.
          </p>
          <div className="kb-commands">
            <button
              disabled={!board?.lists.length}
              onClick={() => openEditor({ kind: "task" })}
            >
              <ListTodo />
              <span>
                Create new task<small>Turn an intention into an action</small>
              </span>
              <Plus size={16} />
            </button>
            <button
              disabled={!board}
              onClick={() => openEditor({ kind: "list" })}
            >
              <LayoutGrid />
              <span>
                Create new list<small>A new column in Google Tasks</small>
              </span>
              <Plus size={16} />
            </button>
            <button
              disabled={!board}
              onClick={() => openEditor({ kind: "routine" })}
            >
              <Bell />
              <span>
                Create new subroutine
                <small>Let overdue work reach your internal memo</small>
              </span>
              <Plus size={16} />
            </button>
            <button
              onClick={() => {
                setPalette(false);
                setMemoOpen(true);
              }}
            >
              <Bell />
              <span>
                Review internal memo
                <small>{memo.length} tasks need attention</small>
              </span>
              <ChevronRight size={16} />
            </button>
          </div>
        </Modal>
      )}
      {editor && board && (
        <Modal
          title={
            editor.kind === "task"
              ? editor.task
                ? "Edit task"
                : "Create new task"
              : editor.kind === "list"
                ? editor.list
                  ? "Manage list"
                  : "Create new list"
                : editor.rule
                  ? "Edit subroutine"
                  : "Create new subroutine"
          }
          onClose={() => {
            if (!saving) setEditor(null);
          }}
        >
          <form
            className="kb-form"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const title = String(data.get("title") ?? "").trim();
              if (!title) {
                setActionError("Please enter a title.");
                return;
              }
              if (editor.kind === "list")
                void run(
                  () =>
                    editor.list
                      ? taskService.updateTaskList(
                          editor.list.id,
                          title,
                          editor.list.etag,
                        )
                      : taskService.createTaskList(title),
                  true,
                );
              else if (editor.kind === "routine") {
                const rule: Subroutine = {
                  id: editor.rule?.id ?? crypto.randomUUID(),
                  name: title,
                  listId: String(data.get("listId") ?? ""),
                  days: Number(data.get("days")),
                  enabled: editor.rule?.enabled ?? true,
                };
                void run(
                  () =>
                    saveRoutine(rule, editor.rule ?? null),
                  true, false,
                );
              } else {
                const due = String(data.get("due") ?? "");
                const patch = {
                  title,
                  notes: String(data.get("notes") ?? ""),
                  scheduledDate: due || null,
                };
                const listId =
                  editor.task?.listId ?? String(data.get("listId"));
                void run(
                  () =>
                    editor.task
                      ? patchBoardTask(
                          listId,
                          editor.task.id,
                          patch,
                          editor.task.etag,
                        )
                      : createBoardTask(listId, {
                          ...patch,
                          scheduledDate: due || undefined,
                        }),
                  true,
                );
              }
            }}
          >
            <label>
              {editor.kind === "routine" ? "Subroutine name" : "Title"}
              <input
                autoFocus
                name="title"
                required
                maxLength={editor.kind === "task" ? 1024 : 256}
                defaultValue={
                  editor.kind === "task"
                    ? editor.task?.title
                    : editor.kind === "routine"
                      ? (editor.rule?.name ?? "Overdue watch")
                      : (editor.list?.title ?? "")
                }
                placeholder={
                  editor.kind === "list"
                    ? "e.g. Studio projects"
                    : "Give it a clear name"
                }
              />
            </label>
            {editor.kind !== "list" && (
              <label>
                {editor.kind === "routine" ? "Watch list" : "Google task list"}
                <select
                  name="listId"
                  defaultValue={
                    editor.kind === "task"
                      ? (editor.listId ?? board.lists[0]?.id)
                      : (editor.rule?.listId ?? "")
                  }
                  disabled={editor.kind === "task" && !!editor.task}
                >
                  {editor.kind === "routine" && (
                    <option value="">All lists</option>
                  )}
                  {editor.kind === "routine" && editor.rule?.listId && !board.lists.some((list) => list.id === editor.rule?.listId) && <option value={editor.rule.listId}>Deleted list (choose a new scope)</option>}
                  {board.lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {editor.kind === "task" && (
              <>
                <label>
                  Notes
                  <textarea
                    name="notes"
                    rows={5}
                    maxLength={8192}
                    defaultValue={editor.task?.notes}
                    placeholder="Details, next steps, or a link to the source email…"
                  />
                </label>
                <label>
                  Due date
                  <input
                    type="date"
                    name="due"
                    defaultValue={editor.task?.scheduledDate?.slice(0, 10)}
                  />
                </label>
                <p className="kb-dialog-copy">
                  Dates follow Google Tasks’ date-only semantics. Changes save
                  directly to Google; offline edits are not queued.
                </p>
              </>
            )}
            {editor.kind === "routine" && (
              <>
                <label>
                  Surface after this many days overdue
                  <input
                    type="number"
                    name="days"
                    min={1}
                    max={365}
                    required
                    defaultValue={editor.rule?.days ?? 1}
                  />
                </label>
                <p className="kb-dialog-copy">
                  Matching open tasks enter a persistent, account-scoped memo
                  available to Elara during chat. Completion or a changed due
                  date automatically resolves the entry after sync.
                </p>
              </>
            )}
            {actionError && (
              <p role="alert" className="kb-form-error">
                {actionError} If a request timed out, sync and check Google
                before retrying.
              </p>
            )}
            {((editor.kind === "task" && editor.task) ||
              (editor.kind === "list" && editor.list) ||
              (editor.kind === "routine" && editor.rule)) && (
              <button
                className="kb-danger"
                type="button"
                disabled={saving}
                onClick={() => {
                  if (editor.kind === "task" && editor.task)
                    askToRemove({ kind: "task", task: editor.task });
                  if (editor.kind === "list" && editor.list)
                    askToRemove({ kind: "list", list: editor.list });
                  if (editor.kind === "routine" && editor.rule)
                    askToRemove({ kind: "routine", rule: editor.rule });
                }}
              >
                <Trash2 size={15} />
                {editor.kind === "routine"
                  ? "Remove subroutine"
                  : editor.kind === "list"
                    ? "Delete list and tasks"
                    : "Delete task"}
              </button>
            )}
            <div className="kb-form-actions">
              <button
                type="button"
                disabled={saving}
                onClick={() => setEditor(null)}
              >
                Cancel
              </button>
              <button type="submit" className="kb-primary" disabled={saving}>
                {saving
                  ? "Saving…"
                  : editor.kind === "routine"
                    ? editor.rule
                      ? "Save subroutine"
                      : "Enable subroutine"
                    : "Save to Google"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {removal && board && (
        <Modal
          title={
            removal.kind === "routine"
              ? "Remove subroutine?"
              : "Delete from Google?"
          }
          onClose={() => {
            if (!saving) setRemoval(null);
          }}
        >
          <form
            className="kb-form"
            onSubmit={(event) => {
              event.preventDefault();
              const expected =
                removal.kind === "list" ? removal.list.title : "DELETE";
              if (
                new FormData(event.currentTarget).get("confirmation") !==
                expected
              ) {
                setActionError("The confirmation does not match.");
                return;
              }
              void run(
                () =>
                  removal.kind === "task"
                    ? taskService.deleteTask(
                        removal.task.listId,
                        removal.task.id,
                        removal.task.etag,
                      )
                    : removal.kind === "list"
                      ? taskService.deleteTaskList(
                          removal.list.id,
                          removal.list.etag,
                        )
                      : removeRoutine(removal.rule),
                true, removal.kind !== 'routine',
              );
            }}
          >
            <p className="kb-dialog-copy">
              {removal.kind === "list"
                ? `Permanently delete “${removal.list.title}” and ALL tasks in this list, including tasks not visible in the current view. This cannot be undone here.`
                : removal.kind === "task"
                  ? `Permanently delete “${removal.task.title}”. Its subtasks may also be deleted. This cannot be undone here.`
                  : `Remove “${removal.rule.name}” from the internal memo rules. Google tasks will not be changed.`}
            </p>
            <label>
              {removal.kind === "list"
                ? "Type the list title to confirm"
                : "Type DELETE to confirm"}
              <input
                autoFocus
                name="confirmation"
                required
                autoComplete="off"
              />
            </label>
            {actionError && (
              <p role="alert" className="kb-form-error">
                {actionError} Sync and check Google before retrying.
              </p>
            )}
            <div className="kb-form-actions">
              <button
                type="button"
                disabled={saving}
                onClick={() => setRemoval(null)}
              >
                Cancel
              </button>
              <button type="submit" className="kb-danger" disabled={saving}>
                {saving ? "Removing…" : "Confirm removal"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}

export function KanbanScreen(props: { onBack: () => void; onSettings: () => void }) {
  const { board } = useSyncExternalStore(boardStore.subscribe, boardStore.getSnapshot);
  return <KanbanWorkspace key={board?.account ?? 'disconnected'} {...props} />;
}
