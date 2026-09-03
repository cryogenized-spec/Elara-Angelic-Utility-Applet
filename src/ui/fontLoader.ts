export const GOOGLE_FONT_OPTIONS = {
  Inter: 'Inter',
  Manrope: 'Manrope',
  Outfit: 'Outfit',
} as const;

export type GoogleFontFamily = typeof GOOGLE_FONT_OPTIONS[keyof typeof GOOGLE_FONT_OPTIONS];

const loadedFamilies = new Set<GoogleFontFamily>();

function makeCssUrl(family: GoogleFontFamily) {
  const encoded = family.replace(/ /g, '+');
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@400;500;600;700&display=swap`;
}

/**
 * Loads a selected font through Google's CSS2 API.
 * The browser owns HTTP caching of the stylesheet/font resources; the app
 * deliberately does not bundle or fabricate local copies of these fonts.
 */
export function ensureGoogleFont(family: GoogleFontFamily): Promise<void> {
  if (typeof document === 'undefined' || loadedFamilies.has(family)) return Promise.resolve();

  const existing = document.querySelector<HTMLLinkElement>(`link[data-elara-font="${family}"]`);
  if (existing) {
    loadedFamilies.add(family);
    return Promise.resolve();
  }

  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = makeCssUrl(family);
  link.dataset.elaraFont = family;
  document.head.appendChild(link);
  loadedFamilies.add(family);
  return Promise.resolve();
}

export function fontFamilyForCss(family: GoogleFontFamily) {
  return `'${family}', Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`;
}
