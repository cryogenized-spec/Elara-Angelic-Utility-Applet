import { describe, expect, it } from 'vitest';
import { roleplayWorldToolArgumentSchemas, validateRoleplayWorldToolArguments } from './roleplay-world-schemas';
import { googleGeminiFunctionDeclarations } from './gemini-declarations';
import { confirmationRequestForCall } from './executor';

describe('roleplay_setting.create argument contract', () => {
  it('accepts a valid single-entity create with only the required fields', () => {
    expect(validateRoleplayWorldToolArguments('roleplay_setting.create', { type: 'building', name: 'The Residence' })).toEqual({
      type: 'building', name: 'The Residence', description: '', parentId: undefined,
    });
  });

  it('accepts a valid single-entity create with description and parentId', () => {
    expect(validateRoleplayWorldToolArguments('roleplay_setting.create', {
      type: 'room', name: 'Steam Sauna & Walk-in Shower', description: 'Cedar-lined steam room.', parentId: 'master_suite_01',
    })).toEqual({ type: 'room', name: 'Steam Sauna & Walk-in Shower', description: 'Cedar-lined steam room.', parentId: 'master_suite_01' });
  });

  it('accepts an explicit null parentId meaning the world root', () => {
    expect(validateRoleplayWorldToolArguments('roleplay_setting.create', { type: 'outdoor', name: 'Sky Terrace', parentId: null }).parentId).toBeNull();
  });

  it.each([
    ['missing type', { name: 'The Residence' }],
    ['missing name', { type: 'building' }],
    ['unknown type', { type: 'penthouse', name: 'The Residence' }],
    ['empty name', { type: 'building', name: '   ' }],
    ['name too long', { type: 'building', name: 'x'.repeat(121) }],
    ['invalid parentId characters', { type: 'room', name: 'Master Suite', parentId: 'The Residence' }],
    ['unknown extra key', { type: 'room', name: 'Master Suite', extra: true }],
    ['non-object', 'The Residence'],
    ['array', [{ type: 'building', name: 'The Residence' }]],
  ])('rejects invalid arguments: %s', (_label, value) => {
    expect(() => validateRoleplayWorldToolArguments('roleplay_setting.create', value)).toThrow();
  });

  it('rejects batch shapes: the contract is one entity per create call', () => {
    const batchShapes: unknown[] = [
      { entities: [{ type: 'building', name: 'The Residence' }, { type: 'room', name: 'Master Suite' }] },
      { items: [{ type: 'building', name: 'The Residence' }] },
      { type: 'building', name: ['The Residence', 'Sky Terrace'] },
      { type: 'building', name: 'The Residence', children: [{ type: 'room', name: 'Master Suite' }] },
    ];
    for (const shape of batchShapes) expect(() => validateRoleplayWorldToolArguments('roleplay_setting.create', shape)).toThrow();
  });

  it('keeps the Gemini declaration and the runtime validator in sync for roleplay_setting.create', () => {
    const declaration = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'roleplay_setting.create');
    expect(declaration).toBeDefined();
    const declaredKeys = Object.keys(declaration!.parameters.properties).sort();
    const validatedKeys = Object.keys(roleplayWorldToolArgumentSchemas['roleplay_setting.create'].shape).sort();
    expect(declaredKeys).toEqual(validatedKeys);
    expect(declaration!.parameters.required).toEqual(['type', 'name']);
    expect(declaration!.parameters.additionalProperties).toBe(false);
    expect((declaration!.parameters.properties.type as { enum: string[] }).enum).toEqual(roleplayWorldToolArgumentSchemas['roleplay_setting.create'].shape.type.options);
  });

  it('still routes a valid create through the write-confirmation proposal layer', () => {
    const confirmation = confirmationRequestForCall({ tool: 'roleplay_setting.create', arguments: { type: 'room', name: 'Master Suite', parentId: 'the_residence_01' } });
    expect(confirmation).toMatchObject({ tool: 'roleplay_setting.create', risk: 'write', resourceSummary: 'Create room “Master Suite” under the_residence_01.' });
  });

  it('produces no confirmation request for invalid create arguments (nothing to propose)', () => {
    expect(confirmationRequestForCall({ tool: 'roleplay_setting.create', arguments: { entities: [{ type: 'room', name: 'Master Suite' }] } })).toBeNull();
  });
});
