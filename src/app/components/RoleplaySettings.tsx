import { useEffect, useState } from 'react';
import type { RoleplayPreferences } from '../../domain/preferences';
import { childEntities, serializeRoleplayWorld, type RoleplayWorld, type RoleplayWorldEntity } from '../../domain/roleplay-world';
import { loadRoleplayWorld } from '../../persistence/roleplay-world';
import './roleplay-settings.css';

const WORLD_UPDATED_EVENT = 'elara-roleplay-world-updated';

export function RoleplaySettings({ value, onChange }: { value: RoleplayPreferences; onChange: (value: RoleplayPreferences) => void }) {
  const [world, setWorld] = useState<RoleplayWorld | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => { void loadRoleplayWorld(value).then((next) => { if (!cancelled) setWorld(next); }); };
    refresh();
    window.addEventListener(WORLD_UPDATED_EVENT, refresh);
    return () => { cancelled = true; window.removeEventListener(WORLD_UPDATED_EVENT, refresh); };
  }, [value]);

  async function copyReference(entity: RoleplayWorldEntity): Promise<void> {
    const token = `${entity.id} [world-ref:${entity.ref}]`;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(entity.id);
      window.setTimeout(() => setCopied((current) => current === entity.id ? null : current), 1200);
    } catch { setCopied(null); }
  }

  return <div className="roleplay-settings">
    <div className={`setting-card roleplay-toggle-card${value.enabled ? ' is-enabled' : ''}`}>
      <div className="roleplay-toggle-card__copy">
        <strong>Roleplay Mode</strong>
        <span>Creative context backed by a persistent World Canvas. Elara can inspect and propose changes through the Roleplay world tools.</span>
      </div>
      <button type="button" className={`roleplay-switch${value.enabled ? ' is-on' : ''}`} role="switch" aria-label={value.enabled ? 'Roleplay mode on' : 'Roleplay mode off'} aria-checked={value.enabled} onClick={() => onChange({ ...value, enabled: !value.enabled })}>
        <span className="roleplay-switch__track" aria-hidden="true"><span className="roleplay-switch__thumb" /></span>
      </button>
    </div>

    {value.enabled && <div className="roleplay-detail">
      <div className="roleplay-notice">Persistent world changes are proposed by Elara and require your confirmation before they are written. Current date, time, timezone, and weekday remain live runtime context and never become stale world facts.</div>

      <div className="setting-card roleplay-canvas-card">
        <div className="roleplay-section-heading">
          <div><span className="roleplay-section-kicker">WORLD CANVAS</span><strong>{world?.name ?? 'Loading world…'}</strong></div>
          <span className="roleplay-section-hint">{world?.entities.length ?? 0} {(world?.entities.length ?? 0) === 1 ? 'entity' : 'entities'}</span>
        </div>

        <div className="roleplay-tree" aria-label="Roleplay world directory tree">
          {world && childEntities(world, null).map((entity) => <WorldTreeNode key={entity.id} entity={entity} world={world} depth={0} onCopy={copyReference} copied={copied} />)}
          {world && !world.entities.length && <div className="roleplay-tree__empty">The canvas is empty. Describe the setting naturally in chat and Elara can propose the first location.</div>}
        </div>

        {world && <details className="roleplay-yaml"><summary>View world YAML</summary><pre>{serializeRoleplayWorld(world)}</pre></details>}

        <div className="roleplay-tools">
          <div><span className="roleplay-section-kicker">AI CAPABILITIES</span><strong>Natural language is enough.</strong></div>
          <p>Elara can list, inspect, create, update, move, and delete world entities. Persistent changes are intercepted for your approval.</p>
          <code>roleplay_setting.list · inspect · create · update · move · delete</code>
        </div>
      </div>

      <div className="setting-card roleplay-format">
        <strong>Runtime context</strong>
        <span>The world stores persistent setting information. The current device date, time, timezone, and weekday are supplied dynamically during conversation.</span>
      </div>
    </div>}
  </div>;
}

function WorldTreeNode({ entity, world, depth, onCopy, copied }: { entity: RoleplayWorldEntity; world: RoleplayWorld; depth: number; onCopy: (entity: RoleplayWorldEntity) => Promise<void>; copied: string | null }) {
  const children = childEntities(world, entity.id);
  return <div className="roleplay-tree__node">
    <div className="roleplay-tree__row" style={{ paddingLeft: `${depth * 14}px` }}>
      <span className="roleplay-tree__branch">{children.length ? '▾' : '·'}</span>
      <span className="roleplay-tree__id">{entity.id}</span>
      <span className="roleplay-tree__name">{entity.name}</span>
      <button type="button" className="roleplay-tree__copy" aria-label={`Copy reference for ${entity.id}`} onClick={() => void onCopy(entity)}>{copied === entity.id ? '✓' : '⧉'}</button>
    </div>
    <div className="roleplay-tree__meta" style={{ paddingLeft: `${depth * 14 + 24}px` }}>
      <span>{entity.type}</span>
      {entity.parentId && <span>parent: {entity.parentId}</span>}
      {entity.description && <span className="roleplay-tree__description">{entity.description}</span>}
    </div>
    {children.map((child) => <WorldTreeNode key={child.id} entity={child} world={world} depth={depth + 1} onCopy={onCopy} copied={copied} />)}
  </div>;
}
