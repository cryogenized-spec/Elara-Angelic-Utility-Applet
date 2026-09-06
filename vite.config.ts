import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/Elara-Angelic-Utility-Applet/',
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
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },
});
