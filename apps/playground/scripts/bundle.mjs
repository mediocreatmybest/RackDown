import { fileURLToPath } from 'node:url';

export const appDirectory = fileURLToPath(new URL('..', import.meta.url));
export const bundleOptions = {
  absWorkingDir: appDirectory,
  entryPoints: ['src/main.js'],
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  outfile: 'dist/main.js',
};
