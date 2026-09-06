export function withRuntimeContext(systemInstruction: string | undefined): string {
  const now = new Date();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const date = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: timezone }).format(now);
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: timezone }).format(now);
  const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long', timeZone: timezone }).format(now);
  const runtime = [
    'Application runtime context:',
    `- Current local date: ${date}`,
    `- Current local time: ${time}`,
    `- Current weekday: ${weekday}`,
    `- Local timezone: ${timezone}`,
    '',
    'When Roleplay Mode is active:',
    '- Treat the persistent World Canvas as authoritative setting context.',
    '- Use roleplay_setting tools to inspect or change persistent world entities when appropriate.',
    '- Persistent world mutations require user confirmation before they are committed.',
    '- Do not store current date, time, weekday, or timezone as persistent world facts.',
    '- Always establish or mention a physical setting when roleplaying.',
    '- Use the current runtime time as dynamic context and use initiative to choose a logical existing location when the narrative calls for one.',
    '- Physical action and scene narration use italics; spoken dialogue uses ordinary text.',
  ].join('\n');
  const base = systemInstruction?.trim();
  return base ? `${base}\n\n${runtime}` : runtime;
}
