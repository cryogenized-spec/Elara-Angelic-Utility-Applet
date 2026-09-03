export const BUILT_IN_FONTS = [
  { family: 'Inter', source: 'Local Latin WOFF2' },
  { family: 'Manrope', source: 'Local Latin WOFF2' },
  { family: 'Outfit', source: 'Local Latin WOFF2' },
] as const;

export type BuiltInFontFamily = typeof BUILT_IN_FONTS[number]['family'];

export type FontSelection =
  | { kind: 'built-in'; family: BuiltInFontFamily }
  | { kind: 'custom'; family: string; stylesheetUrl: string };

const FALLBACK_STACK = "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

export function fontFamilyForCss(selection: FontSelection | BuiltInFontFamily): string {
  const family = typeof selection === 'string' ? selection : selection.family;
  return `'${family.replace(/'/g, '')}', ${FALLBACK_STACK}`;
}

export function googleFontFamilyFromCss2Url(input: string): string | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'https:' || url.hostname !== 'fonts.googleapis.com' || url.pathname !== '/css2') return null;
    const rawFamily = url.searchParams.get('family')?.split(':')[0];
    if (!rawFamily) return null;
    return decodeURIComponent(rawFamily.replace(/\+/g, ' ')).trim() || null;
  } catch {
    return null;
  }
}
