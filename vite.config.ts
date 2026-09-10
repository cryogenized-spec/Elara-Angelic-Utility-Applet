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
      registerType: 'autoUpdate',
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
        // Take control of open clients as soon as a new worker installs so an
        // installed PWA picks up deploys without waiting for every client to
        // close. The app surfaces a refresh toast when new assets are ready.
        clientsClaim: true,
        skipWaiting: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },
});
