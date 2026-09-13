import { copyFile, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import { appDirectory, bundleOptions } from './bundle.mjs';

const distDirectory = resolve(appDirectory, 'dist');
await rm(distDirectory, { recursive: true, force: true });
await mkdir(distDirectory, { recursive: true });
await build(bundleOptions);
for (const [source, target] of [
  ['index.html', 'index.html'],
  ['src/styles.css', 'styles.css'],
]) {
  await copyFile(resolve(appDirectory, source), resolve(distDirectory, target));
}
console.log('Built RackDown playground.');
