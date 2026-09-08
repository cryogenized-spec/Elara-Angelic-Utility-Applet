import { describe, expect, it } from 'vitest';
import { validateLatexSource } from './compiler';

describe('document compiler validation', () => {
  it('accepts bounded LaTeX source', () => {
    expect(validateLatexSource('\\documentclass{article}\\begin{document}Hello\\end{document}')).toContain('documentclass');
  });

  it('rejects empty, oversized, and execution/path directives', () => {
    expect(() => validateLatexSource('')).toThrow();
    expect(() => validateLatexSource('\\write18{whoami}')).toThrow();
    expect(() => validateLatexSource('\\input{../secret}')).toThrow();
  });
});
