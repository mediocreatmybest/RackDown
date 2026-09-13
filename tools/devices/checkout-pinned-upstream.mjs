import { execFileSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { lockPath } from './full-catalogue.mjs';

const [target] = process.argv.slice(2);
if (!target)
  throw new TypeError(
    'Usage: node tools/devices/checkout-pinned-upstream.mjs <target-directory>',
  );

const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const targetDirectory = resolve(target);
const remoteUrl = `https://github.com/${lock.source}.git`;

function git(args) {
  execFileSync('git', args, { stdio: 'inherit' });
}

await mkdir(targetDirectory, { recursive: true });
git(['-C', targetDirectory, 'init', '--quiet']);
git(['-C', targetDirectory, 'remote', 'add', 'origin', remoteUrl]);
git([
  '-C',
  targetDirectory,
  'fetch',
  '--quiet',
  '--depth',
  '1',
  'origin',
  lock.ref,
]);
git(['-C', targetDirectory, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);

console.log(`Checked out ${lock.source}@${lock.ref} into ${targetDirectory}.`);
