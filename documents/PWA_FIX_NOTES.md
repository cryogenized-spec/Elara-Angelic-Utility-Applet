# PWA icon repair

The uploaded Elara app icon was present in `public/icons`, but the PNG filenames contained an invisible leading Unicode character, so the manifest and service worker references to `icon-192.png` and `icon-512.png` did not resolve.

The fix normalizes those filenames to the exact paths used by the manifest and bumps the service-worker cache version so previously failed shell precaching is replaced.
