import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/Elara-Angelic-Utility-Applet/',
  plugins: [react()],
  build: {
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },
});
