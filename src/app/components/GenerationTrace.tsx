import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { GenerationActivityRecord, GenerationActivityStep } from '../../domain/chat';
import { DEFAULT_GENERATION_ACTIVITY_GLYPHS, type GenerationActivityGlyphKey, type GenerationActivityGlyphs } from '../../domain/preferences';
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
import { NOTO_EMOJI_FAMILY, getNotoEmojiReady, subscribeNotoEmojiReady } from '../../ui/noto-emoji';
import { MarkdownText } from './MarkdownText';
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

type Props = (
  | { generation: GenerationState; record?: never; thoughtSummary?: never }
  | { generation?: never; record: GenerationActivityRecord; thoughtSummary?: string }
) & { glyphs?: GenerationActivityGlyphs };

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
  if (name.startsWith('memory.')) return 'memory';
  if (name.startsWith('youtube.')) return 'search';
  return 'tool';
}

function rowIcon(row: ActivityRow): IconName {
  if (row.contextCategory === 'memory') return 'memory';
  if (row.kind === 'thinking') return 'sparkles';
  if (row.kind === 'generation') return 'bot';
  if (row.kind === 'tool') return toolIcon(row.toolName);
  return 'dots';
}

function toolGlyphKey(name: string | undefined): GenerationActivityGlyphKey {
  if (!name) return 'tool';
  if (name.startsWith('calendar.')) return 'calendar';
  if (name.startsWith('tasks.')) return 'tasks';
  if (name.startsWith('gmail.')) return 'gmail';
  if (name.startsWith('drive.')) return 'drive';
  if (name.startsWith('docs.') || name.startsWith('document.')) return 'documents';
  if (name.startsWith('sheets.')) return 'sheets';
  if (name.startsWith('memory.')) return 'memory';
  return 'tool';
}

function rowGlyphKey(row: ActivityRow): GenerationActivityGlyphKey {
  if (row.contextCategory === 'memory') return 'memory';
  if (row.kind === 'thinking') return 'reasoning';
  if (row.kind === 'generation') return 'generation';
  if (row.kind === 'tool') return toolGlyphKey(row.toolName);
  return 'tool';
}

function statusGlyphKey(status: string | undefined): GenerationActivityGlyphKey | undefined {
  if (status === 'awaiting_authorization') return 'authorization';
  if (status === 'awaiting_tool_confirmation') return 'confirmation';
  return undefined;
}

function statusFallbackIcon(status: string | undefined): IconName {
  if (status === 'awaiting_authorization') return 'lock-keyhole';
  if (status === 'awaiting_tool_confirmation') return 'shield';
  return 'dots';
}

function ActivityGlyph({
  glyphKey,
  glyphs,
  fallback,
}: {
  glyphKey: GenerationActivityGlyphKey;
  glyphs: GenerationActivityGlyphs;
  fallback: IconName;
}) {
  const ready = useSyncExternalStore(subscribeNotoEmojiReady, getNotoEmojiReady, () => false);
  if (!ready) return <Icon name={fallback} size={14} />;
  return (
    <span
      className="generation-activity__noto-glyph"
      data-activity-glyph={glyphKey}
      style={{ fontFamily: `'${NOTO_EMOJI_FAMILY}'` }}
    >
      {glyphs[glyphKey]}
    </span>
  );
}

function toolDescriptor(name: string): string {
  const presentation = toolActivityPresentation(name);
  return [presentation.categoryLabel, presentation.serviceLabel, presentation.actionLabel].filter(Boolean).join(' · ');
}

function rowCopy(row: ActivityRow): { primary: string; secondary?: string } {
  if (row.kind === 'thinking') {
    if (row.state === 'failed') return { primary: 'Reasoning failed' };
    if (row.state === 'cancelled') return { primary: 'Reasoning stopped' };
    return { primary: 'Reasoning' };
  }
  if (row.kind === 'generation') {
    if (row.state === 'running') return { primary: 'Writing response' };
    if (row.state === 'failed') return { primary: 'Response failed' };
    if (row.state === 'cancelled') return { primary: 'Response stopped' };
    return { primary: 'Response' };
  }
  if (row.kind === 'tool') {
    return { primary: toolDescriptor(row.toolName ?? row.label) };
  }
  if (row.kind === 'context') {
    if (row.contextCategory === 'memory') return { primary: row.label || 'Memory', secondary: row.detail };
    const category = row.contextCategory === 'artifacts' ? 'Documents & Artifacts' : row.label;
    return { primary: category, secondary: row.detail };
  }
  return { primary: row.label, secondary: row.detail };
}

function summaryLine(rows: readonly ActivityRow[], durationMs: number): string {
  const toolCount = rows.filter((row) => row.kind === 'tool').length;
  const stepCount = rows.length;
  const parts = [`${stepCount} step${stepCount === 1 ? '' : 's'}`];
  if (toolCount > 0) parts.push(`${toolCount} tool${toolCount === 1 ? '' : 's'}`);
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
  const glyphs = props.glyphs ?? DEFAULT_GENERATION_ACTIVITY_GLYPHS;
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
  const toolRows = useMemo(() => rows.filter((row) => row.kind === 'tool' && row.toolName), [rows]);
  const durationMs = live ? turnDurationMs(live, now) : record!.durationMs;
  const reasoningSummary = live ? thoughtSummaryOf(live) : props.thoughtSummary?.trim();
  const liveLabel = live
    ? live.phase === 'tool-working'
      ? statusLabel(live.statusMessage) ?? PHASE_LABELS[live.phase]
      : PHASE_LABELS[live.phase]
    : undefined;
  const headerText = live
    ? live.phase === 'completed' ? summaryLine(rows, durationMs) : `${liveLabel} · ${formatActivityDuration(durationMs)}`
    : summaryLine(rows, durationMs);
  const controlLabel = live && live.phase !== 'completed'
    ? `Generation activity details: ${liveLabel}`
    : `Generation activity details: ${headerText}`;
  const liveStatusGlyph = live && active ? statusGlyphKey(live.statusMessage) : undefined;

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
        {liveStatusGlyph && (
          <span className="generation-activity__header-glyph" data-activity-glyph={liveStatusGlyph} aria-hidden="true">
            <ActivityGlyph glyphKey={liveStatusGlyph} glyphs={glyphs} fallback={statusFallbackIcon(live?.statusMessage)} />
          </span>
        )}
        <span className="generation-activity__headline">{headerText}</span>
        <Icon name="chevron" size={14} />
      </button>
      {expanded && (
        <div className="generation-activity__body" tabIndex={0} aria-label="Generation activity details">
          {rows.length > 0 && (
            <ol className="generation-activity__steps">
              {rows.map((row) => {
                const copy = rowCopy(row);
                const duration = formatActivityDuration(row.durationMs);
                return (
                  <li key={row.id} className={`generation-activity__step is-${row.state}`}>
                    <span className="generation-activity__step-icon" data-activity-glyph={rowGlyphKey(row)} aria-hidden="true"><ActivityGlyph glyphKey={rowGlyphKey(row)} glyphs={glyphs} fallback={rowIcon(row)} /></span>
                    <span className="generation-activity__step-copy">
                      <span className="generation-activity__step-mainline">
                        <span className="generation-activity__step-primary">{copy.primary}</span>
                        <span className="generation-activity__step-time" aria-label={`${copy.primary} duration ${duration}`}>· {duration}</span>
                      </span>
                      {copy.secondary && <span className="generation-activity__step-secondary">{copy.secondary}</span>}
                      {row.errorCode && <span className="generation-activity__step-error">{row.errorCode}</span>}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          {toolRows.length > 0 && (
            <details className="generation-activity__tools">
              <summary>
                <span>Tool invocations ({toolRows.length})</span>
                <Icon name="chevron" size={13} />
              </summary>
              <ol>
                {toolRows.map((row) => <li key={`tool-${row.id}`}>
                  <span>{toolDescriptor(row.toolName!)}</span>
                  <code>{row.toolName}</code>
                </li>)}
              </ol>
            </details>
          )}
          {reasoningSummary && (
            <div className="generation-activity__summary">
              <span className="generation-activity__summary-label">Reasoning summary</span>
              <div className="generation-activity__summary-body">
                {active ? reasoningSummary : <MarkdownText text={reasoningSummary} />}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
