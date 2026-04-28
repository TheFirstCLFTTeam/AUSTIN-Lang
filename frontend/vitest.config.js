import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: './src/setupTests.js',
    globals: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Next.js's 'server-only' guard is a no-op in tests — Vite/Vitest
      // doesn't run the bundler that enforces it, so map it to an empty
      // shim so server modules can be imported under the jsdom environment.
      'server-only': path.resolve(__dirname, './src/__tests__/server-only.shim.js'),
    },
  },
});
