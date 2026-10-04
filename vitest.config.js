import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Component tests (`npm run test:component`): components rendered alone in jsdom, and the whole
// page in jsdom for its wiring to the app model. Unit tests use node:test (`npm run test:unit`).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['tests/component/**/*.test.jsx'],
    setupFiles: ['tests/component/setup.js'],
  },
});
