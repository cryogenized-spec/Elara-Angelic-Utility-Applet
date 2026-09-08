import { useEffect, useState } from 'react';
import {
  isActivePhase,
  stepElapsedMs,
  thoughtSummaryOf,
  turnDurationMs,
  type GenerationPhase,
  type GenerationState,
  type GenerationStep,
} from '../../chat/generation-state';
import { Icon, type IconName } from '../../ui/icons';
import './generation-trace.css';

// The trace renders ONLY canonical chat-layer state. It knows nothing about
// Gemini wire events, SDK shapes, or provider internals.

const PHASE_LABELS: Record<GenerationPhase, string> = {
  connecting: 'Connecting',
  thinking: 'Thinking',
  'tool-working': 'Using tools',
  generating: 'Writing',
  completed: 'Done',
  failed: 'Failed',
  cancelled: 'Stopped',
};

const TOOL_SERVICES: Record<string, { label: string; icon: IconName }> = {
  calendar: { label: 'Calendar', icon: 'calendar' },
  tasks: { label: 'Tasks', icon: 'tasks' },
  docs: { label: 'Docs', icon: 'docs' },
  chat: { label: 'Chat', icon: 'message-circle' },
  gmail: { label: 'Gmail', icon: 'mail' },
  drive: { label: 'Drive', icon: 'drive' },
  sheets: { label: 'Sheets', icon: 'sheets' },
  roleplay_setting: { label: 'World', icon: 'wand-sparkles' },
};

function humanizeAction(action: string): string {
  return action
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/^./, (first) => first.toUpperCase());
}

function friendlyToolLabel(name: string): string {
  const separator = name.indexOf('.');
  if (separator < 0) return name;
  const service = TOOL_SERVICES[name.slice(0, separator)];
  const action = humanizeAction(name.slice(separator + 1));
  return service ? `${service.label} · ${action}` : action;
}

function toolIconFor(name: string | undefined): IconName {
  if (!name) return 'tool';
  return TOOL_SERVICES[name.split('.')[0]]?.icon ?? 'tool';
}

function stepIconFor(step: GenerationStep): IconName {
  if (step.kind === 'thinking') return 'sparkles';
  if (step.kind === 'generation') return 'bot';
  if (step.kind === 'tool') return toolIconFor(step.toolName);
  return 'dots';
}

function stepLabelFor(step: GenerationStep): string {
  if (step.kind === 'tool') return step.toolName ? friendlyToolLabel(step.toolName) : step.label;
  return step.label;
}

function formatMs(ms: number): string {
  return `${Math.max(0, Math.round(ms)).toLocaleString('en-US')} ms`;
}

function statusLabel(status: string | undefined): string | undefined {
  if (status === 'preparing_document') return 'Preparing document…';
  if (status === 'compiling_pdf') return 'Compiling PDF…';
  if (status === 'finalizing_artifact') return 'Finalizing artifact…';
  return undefined;
}

export function GenerationTrace({ generation }: { generation: GenerationState }) {
  const [thoughtExpanded, setThoughtExpanded] = useState(true);
  const [now, setNow] = useState(() => performance.now());
  const active = isActivePhase(generation.phase);

  // Once the answer starts streaming, collapse the thought detail so focus
  // moves to the response. The user can always re-expand it.
  useEffect(() => {
    if (generation.phase === 'generating') setThoughtExpanded(false);
  }, [generation.phase]);

  // One shared ticker for every running timer; frozen once terminal.
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(performance.now()), 150);
    return () => clearInterval(timer);
  }, [active]);

  const summary = thoughtSummaryOf(generation);
  const hasSteps = generation.steps.length > 0;
  const visibleStatus = statusLabel(generation.statusMessage);

  return (
    <section className={`generation-trace is-${generation.phase}`} aria-label="Generation activity">
      <span className="generation-trace__sr-status" role="status">
        {PHASE_LABELS[generation.phase]}
      </span>
      <header
        className="generation-trace__header"
        title={generation.interactionIds.length > 0 ? `interactions: ${generation.interactionIds.join(', ')}` : undefined}
      >
        <span className="generation-trace__dot" aria-hidden="true" />
        <span className="generation-trace__phase">{visibleStatus ?? PHASE_LABELS[generation.phase]}</span>
        <span className="generation-trace__time" aria-hidden="true">{formatMs(turnDurationMs(generation, now))}</span>
      </header>
      {generation.timeToFirstEventMs !== undefined && (
        <div className="generation-trace__first-event" aria-hidden="true">first event in {formatMs(generation.timeToFirstEventMs)}</div>
      )}
      {summary && (
        <div className="generation-trace__thought">
          <button
            className="generation-trace__thought-toggle"
            type="button"
            aria-expanded={thoughtExpanded}
            onClick={() => setThoughtExpanded((current) => !current)}
          >
            <span>Thought summary</span>
            <Icon name="chevron" size={14} />
          </button>
          {thoughtExpanded && <div className="generation-trace__thought-body">{summary}</div>}
        </div>
      )}
      {hasSteps && (
        <ol className="generation-trace__steps">
          {generation.steps.map((step) => (
            <li key={step.id} className={`generation-trace__step is-${step.state}`}>
              <span className="generation-trace__step-icon" aria-hidden="true">
                <Icon name={stepIconFor(step)} size={14} />
              </span>
              <span className="generation-trace__step-label">{stepLabelFor(step)}</span>
              {step.state === 'failed' && step.errorCode && (
                <span className="generation-trace__step-error">{step.errorCode}</span>
              )}
              <span className="generation-trace__step-time" aria-hidden="true">{formatMs(stepElapsedMs(step, now))}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
