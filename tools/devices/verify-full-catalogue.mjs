import { readFile } from 'node:fs/promises';
import {
  defaultOutputPath,
  lockPath,
  verifyFullCatalogue,
} from './full-catalogue.mjs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
if (args.length !== 1)
  throw new TypeError('Usage: pnpm devices:verify-full -- <upstream-checkout>');
const lock = JSON.parse(await readFile(lockPath, 'utf8'));
await verifyFullCatalogue(args[0], lock, defaultOutputPath);
console.log(
  'Full catalogue matches the clean pinned upstream checkout byte-for-byte.',
);
