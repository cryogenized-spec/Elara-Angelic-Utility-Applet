import { useEffect, useMemo, useState } from 'react';
import type { GenerationActivityRecord, GenerationActivityStep } from '../../domain/chat';
import {
  isActivePhase,
  stepElapsedMs,
  thoughtSummaryOf,
  turnDurationMs,
  type GenerationPhase,
  type GenerationState,
  type GenerationStep,
} from '../../chat/generation-state';
import { toolActivityPresentation } from '../../google/tools/contracts';
import { Icon, type IconName } from '../../ui/icons';
import './generation-activity.css';

const PHASE_LABELS: Record<GenerationPhase, string> = {
  connecting: 'Thinking',
  thinking: 'Thinking',
  'tool-working': 'Using tools',
  generating: 'Writing',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
};

type ActivityRow = Omit<GenerationActivityStep, 'state'> & { state: GenerationActivityStep['state'] | 'running' };

type Props =
  | { generation: GenerationState; record?: never; thoughtSummary?: never }
  | { generation?: never; record: GenerationActivityRecord; thoughtSummary?: string };

export function formatActivityDuration(ms: number): string {
  const value = Math.max(0, ms);
  return value < 1000 ? `${Math.floor(value)} ms` : `${(value / 1000).toFixed(1)} s`;
}

function liveRows(generation: GenerationState, now: number): ActivityRow[] {
  return generation.steps.map((step: GenerationStep) => ({
    id: step.id,
    kind: step.kind,
    state: step.state,
    durationMs: stepElapsedMs(step, now),
    label: step.label,
    ...(step.detail ? { detail: step.detail } : {}),
    ...(step.toolName ? { toolName: step.toolName } : {}),
    ...(step.contextCategory ? { contextCategory: step.contextCategory } : {}),
    ...(step.errorCode ? { errorCode: step.errorCode } : {}),
  }));
}

function toolIcon(name: string | undefined): IconName {
  if (!name) return 'tool';
  if (name.startsWith('calendar.')) return 'calendar';
  if (name.startsWith('tasks.')) return 'tasks';
  if (name.startsWith('gmail.')) return 'mail';
  if (name.startsWith('drive.')) return 'drive';
  if (name.startsWith('docs.') || name.startsWith('document.')) return 'docs';
  if (name.startsWith('sheets.')) return 'sheets';
  if (name.startsWith('chat.')) return 'message-circle';
  if (name.startsWith('roleplay_setting.')) return 'wand-sparkles';
  if (name.startsWith('youtube.')) return 'search';
  return 'tool';
}

function rowIcon(row: ActivityRow): IconName {
  if (row.kind === 'thinking' || row.contextCategory === 'memory') return 'sparkles';
  if (row.kind === 'generation') return 'bot';
  if (row.kind === 'tool') return toolIcon(row.toolName);
  return 'dots';
}

function rowCopy(row: ActivityRow): { primary: string; secondary?: string } {
  if (row.kind === 'thinking') {
    if (row.state === 'running') return { primary: 'Thinking' };
    if (row.state === 'failed') return { primary: 'Thinking failed' };
    if (row.state === 'cancelled') return { primary: 'Thinking stopped' };
    return { primary: 'Thought for' };
  }
  if (row.kind === 'generation') {
    if (row.state === 'running') return { primary: 'Writing' };
    if (row.state === 'failed') return { primary: 'Writing failed' };
    if (row.state === 'cancelled') return { primary: 'Writing stopped' };
    return { primary: 'Wrote response in' };
  }
  if (row.kind === 'tool') {
    const presentation = toolActivityPresentation(row.toolName ?? row.label);
    const path = [presentation.categoryLabel, presentation.serviceLabel].filter(Boolean).join(' · ');
    return { primary: path, secondary: presentation.actionLabel };
  }
  if (row.kind === 'context') {
    const category = row.contextCategory === 'memory' ? 'Memory' : row.contextCategory === 'artifacts' ? 'Documents & Artifacts' : row.label;
    return { primary: category, secondary: row.detail };
  }
  return { primary: row.label, secondary: row.detail };
}

function summaryLine(rows: readonly ActivityRow[], durationMs: number): string {
  const thinkingRows = rows.filter((row) => row.kind === 'thinking');
  const writingRows = rows.filter((row) => row.kind === 'generation');
  const thinkingMs = thinkingRows.reduce((sum, row) => sum + row.durationMs, 0);
  const writingMs = writingRows.reduce((sum, row) => sum + row.durationMs, 0);
  const toolCount = rows.filter((row) => row.kind === 'tool').length;
  const parts: string[] = [];
  if (thinkingRows.length > 0) parts.push(`Thought for ${formatActivityDuration(thinkingMs)}`);
  if (toolCount > 0) parts.push(`used ${toolCount} tool${toolCount === 1 ? '' : 's'}`);
  if (writingRows.length > 0) parts.push(`wrote in ${formatActivityDuration(writingMs)}`);
  parts.push(`${formatActivityDuration(durationMs)} total`);
  return parts.join(' · ');
}

function statusLabel(status: string | undefined): string | undefined {
  if (status === 'preparing_document') return 'Preparing document';
  if (status === 'compiling_pdf') return 'Compiling PDF';
  if (status === 'finalizing_artifact') return 'Finalizing artifact';
  if (status === 'awaiting_tool_confirmation') return 'Waiting for confirmation';
  if (status === 'awaiting_authorization') return 'Waiting for authorization';
  return undefined;
}

export function GenerationActivity(props: Props) {
  const live = props.generation;
  const record = props.record;
  const isLive = live !== undefined;
  const active = live ? isActivePhase(live.phase) : false;
  const [expanded, setExpanded] = useState(isLive);
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(performance.now()), 100);
    return () => window.clearInterval(timer);
  }, [active]);

  const rows = useMemo<ActivityRow[]>(() => live ? liveRows(live, now) : record!.steps, [live, now, record]);
  const durationMs = live ? turnDurationMs(live, now) : record!.durationMs;
  const reasoningSummary = live ? thoughtSummaryOf(live) : props.thoughtSummary?.trim();
  const liveLabel = live
    ? live.phase === 'tool-working'
      ? statusLabel(live.statusMessage) ?? PHASE_LABELS[live.phase]
      : PHASE_LABELS[live.phase]
    : undefined;
  const headerText = live ? `${liveLabel} · ${formatActivityDuration(durationMs)}` : summaryLine(rows, durationMs);
  const controlLabel = live
    ? `Generation activity details: ${liveLabel}`
    : 'Generation activity details';

  return (
    <section className={`generation-activity${live ? ` is-${live.phase}` : ' is-complete'}`} aria-label="Generation activity">
      {live && <span className="generation-activity__sr-status" role="status">{liveLabel}</span>}
      <button
        type="button"
        className="generation-activity__header"
        aria-expanded={expanded}
        aria-label={controlLabel}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="generation-activity__dot" aria-hidden="true" />
        <span className="generation-activity__headline">{headerText}</span>
        <Icon name="chevron" size={14} />
      </button>
      {expanded && (
        <div className="generation-activity__body" tabIndex={0} aria-label="Generation activity details">
          {rows.length > 0 && (
            <ol className="generation-activity__steps">
              {rows.map((row) => {
                const copy = rowCopy(row);
                return (
                  <li key={row.id} className={`generation-activity__step is-${row.state}`}>
                    <span className="generation-activity__step-icon" aria-hidden="true"><Icon name={rowIcon(row)} size={14} /></span>
                    <span className="generation-activity__step-copy">
                      <span className="generation-activity__step-primary">{copy.primary}</span>
                      {copy.secondary && <span className="generation-activity__step-secondary">{copy.secondary}</span>}
                      {row.errorCode && <span className="generation-activity__step-error">{row.errorCode}</span>}
                    </span>
                    <span className="generation-activity__step-time">{formatActivityDuration(row.durationMs)}</span>
                  </li>
                );
              })}
            </ol>
          )}
          {reasoningSummary && (
            <div className="generation-activity__summary">
              <span className="generation-activity__summary-label">Reasoning summary</span>
              <div className="generation-activity__summary-body">{reasoningSummary}</div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
