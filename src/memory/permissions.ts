import type { MemoryCapabilityContext } from './capability';

export const MEMORY_PERMISSIONS = ['save', 'observe', 'consolidate', 'forget', 'delete'] as const;
export type MemoryPermission = (typeof MEMORY_PERMISSIONS)[number];
export type MemoryActor = 'model' | 'user' | 'system';

type MemoryPermissionSet = Record<MemoryPermission, boolean>;
export type MemoryPermissionPolicy = Record<MemoryActor, MemoryPermissionSet>;
export type PartialMemoryPermissionSet = Partial<MemoryPermissionSet>;
export type PartialMemoryPermissionPolicy = Partial<Record<MemoryActor, PartialMemoryPermissionSet>>;

export const DEFAULT_MEMORY_PERMISSION_POLICY: Readonly<MemoryPermissionPolicy> = {
  model: { save: true, observe: true, consolidate: true, forget: false, delete: false },
  user: { save: true, observe: true, consolidate: true, forget: true, delete: true },
  system: { save: true, observe: true, consolidate: true, forget: true, delete: true },
};

let policy: MemoryPermissionPolicy = clonePolicy(DEFAULT_MEMORY_PERMISSION_POLICY);

function clonePolicy(source: MemoryPermissionPolicy): MemoryPermissionPolicy {
  return { model: { ...source.model }, user: { ...source.user }, system: { ...source.system } };
}

export function getMemoryPermissionPolicy(): MemoryPermissionPolicy { return clonePolicy(policy); }

export function setMemoryPermissionPolicy(next: PartialMemoryPermissionPolicy): MemoryPermissionPolicy {
  policy = {
    model: { ...policy.model, ...(next.model ?? {}) },
    user: { ...policy.user, ...(next.user ?? {}) },
    system: { ...policy.system, ...(next.system ?? {}) },
  };
  return getMemoryPermissionPolicy();
}

export function resetMemoryPermissionPolicy(): MemoryPermissionPolicy {
  policy = clonePolicy(DEFAULT_MEMORY_PERMISSION_POLICY);
  return getMemoryPermissionPolicy();
}

export function authorizeMemoryMutation(permission: MemoryPermission, context: Pick<MemoryCapabilityContext, 'actor'> = {}): void {
  const actor: MemoryActor = context.actor ?? 'model';
  if (!policy[actor][permission]) throw new Error(`Memory permission denied: ${permission}`);
}
