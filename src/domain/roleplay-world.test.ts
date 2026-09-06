import { describe, expect, it } from 'vitest';
import { childEntities, normalizeRoleplayWorld, serializeRoleplayWorld } from './roleplay-world';

describe('Roleplay World Canvas', () => {
  it('preserves stable ids and hides opaque refs from YAML', () => {
    const world = normalizeRoleplayWorld({
      id: 'world_01',
      name: 'The Old House',
      entities: [{ id: 'bedroom_02', ref: '0123456789abcdef', type: 'room', name: 'Bedroom', description: 'Upstairs', parentId: null, createdAt: 1, updatedAt: 2 }],
    });
    expect(world.entities[0]?.id).toBe('bedroom_02');
    expect(world.entities[0]?.ref).toBe('0123456789abcdef');
    expect(serializeRoleplayWorld(world)).toContain('bedroom_02:');
    expect(serializeRoleplayWorld(world)).not.toContain('0123456789abcdef');
  });

  it('builds a deterministic directory tree from parent ids', () => {
    const world = normalizeRoleplayWorld({
      entities: [
        { id: 'house_01', ref: '0000000000000001', type: 'building', name: 'House', description: '', parentId: null, createdAt: 1, updatedAt: 1 },
        { id: 'bedroom_02', ref: '0000000000000002', type: 'room', name: 'Bedroom', description: '', parentId: 'house_01', createdAt: 2, updatedAt: 2 },
        { id: 'kitchen_01', ref: '0000000000000003', type: 'room', name: 'Kitchen', description: '', parentId: 'house_01', createdAt: 3, updatedAt: 3 },
      ],
    });
    expect(childEntities(world, null).map((entity) => entity.id)).toEqual(['house_01']);
    expect(childEntities(world, 'house_01').map((entity) => entity.id)).toEqual(['bedroom_02', 'kitchen_01']);
  });

  it('rejects malformed opaque refs during normalization', () => {
    const world = normalizeRoleplayWorld({ entities: [{ id: 'room_01', ref: 'not-a-ref', type: 'room', name: 'Room', description: '', parentId: null, createdAt: 1, updatedAt: 1 }] });
    expect(world.entities).toHaveLength(0);
  });
});
