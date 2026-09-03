import { useState } from 'react';
import type { ExecutionSummary as ExecutionSummaryData } from '../../domain/chat';
import { Icon } from '../../ui/icons';

export function ExecutionSummary({ summary }: { summary: ExecutionSummaryData }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className={`execution-summary${expanded ? ' is-expanded' : ''}`}>
      <button
        className="execution-summary__toggle"
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((current) => !current)}
      >
        <span className="execution-summary__label"><span className="execution-summary__dot" />Execution summary</span>
        <span className="execution-summary__time">{summary.durationMs} ms</span>
        <Icon name="chevron" size={16} />
      </button>
      {expanded && (
        <ol className="execution-summary__steps">
          {summary.steps.map((step, index) => (
            <li key={`${summary.id}-${index}`}>
              <span className="execution-summary__step-index">{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
