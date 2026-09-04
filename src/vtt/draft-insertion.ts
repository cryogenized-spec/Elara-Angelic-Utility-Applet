export interface DraftSelection {
  start: number;
  end: number;
}

export function normalizeSelection(value: DraftSelection, draftLength: number): DraftSelection {
  const start = Math.max(0, Math.min(value.start, draftLength));
  const end = Math.max(start, Math.min(value.end, draftLength));
  return { start, end };
}

function needsLeadingSpace(prefix: string, transcript: string): boolean {
  if (!prefix || !transcript) return false;
  return !/\s$/.test(prefix) && !/^[,.;!?)}\]]/.test(transcript);
}

function needsTrailingSpace(suffix: string, transcript: string): boolean {
  if (!suffix || !transcript) return false;
  return !/^\s/.test(suffix) && !/[([{]$/.test(transcript);
}

export function insertTranscriptAtSelection(draft: string, selection: DraftSelection, transcript: string): { value: string; cursor: number } {
  const cleanTranscript = transcript.trim();
  const range = normalizeSelection(selection, draft.length);
  if (!cleanTranscript) return { value: draft, cursor: range.start };

  const prefix = draft.slice(0, range.start);
  const suffix = draft.slice(range.end);
  const leading = needsLeadingSpace(prefix, cleanTranscript) ? ' ' : '';
  const trailing = needsTrailingSpace(suffix, cleanTranscript) ? ' ' : '';
  const value = `${prefix}${leading}${cleanTranscript}${trailing}${suffix}`;
  return { value, cursor: prefix.length + leading.length + cleanTranscript.length };
}
