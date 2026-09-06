import type { WriteConfirmationRequest } from '../../google/confirmation/policy';

export function RoleplayConfirmationCard({ request, onAccept, onDecline }: { request: WriteConfirmationRequest; onAccept: () => void; onDecline: () => void }) {
  return (
    <section className={`roleplay-confirmation roleplay-confirmation--${request.risk}`} aria-label="Roleplay world change confirmation">
      <div className="roleplay-confirmation__heading">
        <span>✦</span>
        <strong>Elara proposes a world change</strong>
      </div>
      <code>{request.tool}</code>
      <p>{request.resourceSummary}</p>
      <div className="roleplay-confirmation__actions">
        <button type="button" className="roleplay-confirmation__decline" onClick={onDecline}>✕ Decline</button>
        <button type="button" className="roleplay-confirmation__accept" onClick={onAccept}>✓ Accept</button>
      </div>
    </section>
  );
}
