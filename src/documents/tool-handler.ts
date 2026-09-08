import type { GoogleToolHandlers } from '../google/tools/executor';
import type { GeneratedArtifact } from '../domain/artifact';
import { artifactRepository } from '../artifacts/repository';
import { ArtifactError } from '../artifacts/errors';
import { compilePdf, validateLatexSource } from './compiler';

function escapeLatex(value: string): string {
  return value.replace(/[\\%&#_$\{\}~^]/g, (character) => ({
    '\\': '\\textbackslash{}',
    '%': '\\%',
    '&': '\\&',
    '#': '\\#',
    '_': '\\_',
    '$': '\\$',
    '{': '\\{',
    '}': '\\}',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
  }[character] ?? character));
}

function normalizeSource(source: string, title?: string): string {
  const trimmed = source.trim();
  if (/\\documentclass\b/i.test(trimmed)) return validateLatexSource(trimmed);
  const heading = title?.trim() ? `\\section*{${escapeLatex(title.trim())}}\n` : '';
  const paragraphs = trimmed.split(/\r?\n\s*\r?\n/).map((paragraph) => escapeLatex(paragraph).replace(/\r?\n/g, '\\\\\n')).join('\n\n');
  return validateLatexSource(`\\documentclass{article}\n\\usepackage[margin=1in]{geometry}\n\\begin{document}\n${heading}${paragraphs}\n\\end{document}`);
}

export const documentToolHandlers: GoogleToolHandlers = {
  'document.create_pdf': async ({ arguments: raw }) => {
    const source = typeof raw.source === 'string' ? raw.source : '';
    const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, 180) : undefined;
    const preparedSource = normalizeSource(source, title);
    const artifact = await artifactRepository.create({
      artifactType: 'generated',
      name: `${title || 'generated-document'}.pdf`.replace(/[^a-zA-Z0-9._-]+/g, '-'),
      mimeType: 'application/pdf',
      sourceCode: { language: 'lualatex', content: preparedSource },
      toolName: 'document.create_pdf',
      status: 'pending',
    }) as GeneratedArtifact;
    await artifactRepository.setStatus(artifact.id, 'processing');
    try {
      const compiled = await compilePdf(preparedSource);
      const ready = await artifactRepository.updateMetadata(artifact.id, { outputBlob: compiled.pdf, compilationLog: compiled.compilationLog });
      await artifactRepository.setStatus(artifact.id, 'ready');
      return { artifactId: ready.id, status: 'ready', mimeType: 'application/pdf', compilationLog: compiled.compilationLog };
    } catch (cause) {
      const error = cause instanceof ArtifactError ? cause : new ArtifactError('DOCUMENT_COMPILATION_FAILED', 'PDF generation failed.', cause);
      await artifactRepository.setStatus(artifact.id, 'failed', { code: error.code, message: error.userMessage });
      return { artifactId: artifact.id, status: 'failed', mimeType: 'application/pdf', errorCode: error.code, error: error.userMessage };
    }
  },
};
