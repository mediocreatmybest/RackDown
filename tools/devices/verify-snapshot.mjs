import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const rackdownRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const upstreamRoot = resolve(rackdownRoot, 'upstream');
const snapshotRoot = resolve(upstreamRoot, 'netbox');

function gitBlobSha(content) {
  const header = Buffer.from(`blob ${content.length}\0`, 'utf8');
  return createHash('sha1').update(header).update(content).digest('hex');
}

function snapshotPath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw new TypeError('Pinned NetBox path must be a non-empty string.');
  }

  const absolute = resolve(snapshotRoot, relativePath);
  if (
    absolute !== snapshotRoot &&
    !absolute.startsWith(`${snapshotRoot}${sep}`)
  ) {
    throw new TypeError(
      `Pinned NetBox path escapes snapshot root: ${relativePath}`,
    );
  }
  return absolute;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function verifyBlob(relativePath, expectedSha) {
  if (typeof expectedSha !== 'string' || !/^[0-9a-f]{40}$/.test(expectedSha)) {
    throw new TypeError(`Invalid expected Git blob SHA for ${relativePath}`);
  }

  const content = await readFile(snapshotPath(relativePath));
  const actualSha = gitBlobSha(content);
  if (actualSha !== expectedSha) {
    throw new Error(
      `Pinned NetBox blob mismatch for ${relativePath}: expected ${expectedSha}, got ${actualSha}`,
    );
  }
}

const lock = await readJson(resolve(upstreamRoot, 'netbox.lock.json'));
const manifest = await readJson(resolve(upstreamRoot, 'netbox.devices.json'));

if (!Array.isArray(manifest.devices) || manifest.devices.length === 0) {
  throw new TypeError(
    'Pinned NetBox manifest must contain at least one device.',
  );
}

const seenPaths = new Set();
const seenSlugs = new Set();
let previousSlug;

for (const device of manifest.devices) {
  if (typeof device?.path !== 'string' || typeof device?.slug !== 'string') {
    throw new TypeError(
      'Pinned NetBox device entries require path and slug strings.',
    );
  }
  if (seenPaths.has(device.path)) {
    throw new TypeError(`Duplicate pinned NetBox path: ${device.path}`);
  }
  if (seenSlugs.has(device.slug)) {
    throw new TypeError(`Duplicate pinned NetBox slug: ${device.slug}`);
  }
  if (previousSlug !== undefined && device.slug <= previousSlug) {
    throw new TypeError(
      'Pinned NetBox manifest must be sorted by canonical slug.',
    );
  }

  seenPaths.add(device.path);
  seenSlugs.add(device.slug);
  previousSlug = device.slug;
  await verifyBlob(device.path, device.blob);
}

await verifyBlob(lock.licenseFile, lock.licenseBlob);

console.log(
  `Verified ${manifest.devices.length} pinned NetBox device files and licence at ${lock.ref}.`,
);
