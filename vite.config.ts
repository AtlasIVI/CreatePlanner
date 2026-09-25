import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Game data is bundled on purpose (offline app), so large chunks are expected.
  build: { chunkSizeWarningLimit: 8000 },
  test: {
    include: ['src/**/*.test.ts', 'tools/**/*.test.ts'],
  },
});
