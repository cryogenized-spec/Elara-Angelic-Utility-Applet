import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/Elara-Angelic-Utility-Applet/',
  server: { host: '0.0.0.0', allowedHosts: ['localhost', '.e2b.app'] },
  preview: { host: '0.0.0.0', allowedHosts: ['localhost', '.e2b.app'] },
  plugins: [
    react(),
    VitePWA({
      // Prompt strategy: a newly deployed worker waits instead of activating
      // behind the user's back. Discovery is aggressive (see src/pwa.ts), but
      // nothing applies until the user taps Refresh in the update toast, which
      // sends SKIP_WAITING and reloads once the new worker takes control.
      // NOTE: registerType 'autoUpdate' would force skipWaiting/clientsClaim
      // and auto-reload open pages without acknowledgement — the opposite of
      // the intended detect -> notify -> user-refresh behaviour.
      registerType: 'prompt',
      devOptions: {
        enabled: true,
      },
      manifest: {
        id: '/Elara-Angelic-Utility-Applet/',
        name: 'Elara — Angelic Utility Applet',
        short_name: 'Elara',
        description: 'Elara — an angelic utility applet for conversation, productivity, and orchestration.',
        start_url: '/Elara-Angelic-Utility-Applet/',
        scope: '/Elara-Angelic-Utility-Applet/',
        display: 'standalone',
        orientation: 'portrait-primary',
        background_color: '#0f0c1e',
        theme_color: '#0f0c1e',
        icons: [
          {
            src: 'icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: 'icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
        // No skipWaiting: an updated worker must wait so the running page
        // keeps its own worker until the user refreshes via the update toast.
        // clientsClaim only accelerates first-install control and cannot take
        // over an open page for updates (activation stays gated on the user's
        // Refresh tap, which sends SKIP_WAITING).
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },
});
