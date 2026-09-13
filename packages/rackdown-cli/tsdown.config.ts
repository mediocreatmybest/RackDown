import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: 'src/cli.ts',
  format: 'esm',
  clean: true,
  sourcemap: true,
  target: 'es2022',
});
