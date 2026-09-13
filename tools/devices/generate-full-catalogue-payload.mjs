import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  defaultOutputPath,
  generateFullCatalogue,
  lockPath,
} from './full-catalogue.mjs';

const [source, output] = process.argv.slice(2);
if (!source)
  throw new TypeError(
    'Usage: node tools/devices/generate-full-catalogue-payload.mjs <upstream-checkout> [output.b64]',
  );
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const encoded = await generateFullCatalogue(source, lock);
await writeFile(output ? resolve(output) : defaultOutputPath, encoded);
console.log(
  'Generated full catalogue from the clean pinned upstream checkout.',
);
