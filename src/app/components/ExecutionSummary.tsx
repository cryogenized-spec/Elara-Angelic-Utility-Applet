import { useState } from 'react';
import type { ExecutionSummary as ExecutionSummaryData } from '../../domain/chat';
import { Icon } from '../../ui/icons';
import { MarkdownText } from './MarkdownText';

export function ExecutionSummary({ summary, thoughtSummary }: { summary: ExecutionSummaryData; thoughtSummary?: string }) {
  const [expanded, setExpanded] = useState(false);
  const hasThoughtSummary = Boolean(thoughtSummary?.trim());
  const label = hasThoughtSummary ? 'Thought summary' : 'Execution details';

  return (
    <section className={`execution-summary${expanded ? ' is-expanded' : ''}${hasThoughtSummary ? ' has-thought-summary' : ''}`} aria-label={label}>
      <button
        className="execution-summary__toggle"
        type="button"
        aria-label={label}
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="execution-summary__label"><span className="execution-summary__dot" />{label}</span>
        <span className="execution-summary__time">{summary.durationMs} ms</span>
        <Icon name="chevron" size={16} />
      </button>
      {expanded && hasThoughtSummary ? (
        <div className="execution-summary__thought">
          <MarkdownText text={thoughtSummary!.trim()} />
        </div>
      ) : expanded ? (
        <ol className="execution-summary__steps">
          {summary.steps.map((step, index) => (
            <li key={`${summary.id}-${index}`}>
              <span className="execution-summary__step-index">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
