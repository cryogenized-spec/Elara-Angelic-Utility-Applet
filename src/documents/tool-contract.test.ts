import { describe, expect, it } from 'vitest';
import { googleGeminiFunctionDeclarations } from '../google/tools/gemini-declarations';
import { googleToolNameSchema } from '../google/tools/contracts';
import { validateSemanticToolArguments } from '../google/tools/semantic-schemas';

describe('document.create_pdf semantic tool', () => {
  it('is a registered model-visible document contract with bounded arguments', () => {
    expect(googleToolNameSchema.parse('document.create_pdf')).toBe('document.create_pdf');
    expect(validateSemanticToolArguments('document.create_pdf', { source: '\\documentclass{article}' })).toEqual({ source: '\\documentclass{article}' });
    const declaration = googleGeminiFunctionDeclarations.find((tool) => tool.name === 'document.create_pdf');
    expect(declaration?.parameters.required).toEqual(['source']);
    // Both parameters are declared as string properties (see gemini-declarations).
    expect(declaration?.parameters.properties).toEqual(expect.objectContaining({ source: expect.objectContaining({ type: 'string' }) as { type: string }, title: expect.objectContaining({ type: 'string' }) as { type: string } }));
    expect(JSON.stringify(googleGeminiFunctionDeclarations)).not.toMatch(/run_command|spawn|shell|exec/);
  });
});
