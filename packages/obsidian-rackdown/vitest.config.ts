import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@rackdown/core': fileURLToPath(
        new URL('../rackdown-core/src/index.ts', import.meta.url),
      ),
    },
  },
});
