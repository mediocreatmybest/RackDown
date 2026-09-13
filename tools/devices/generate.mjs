import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { normalizeDeviceIndex, serializeDeviceIndex } from './normalize.mjs';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const rackdownRoot = resolve(toolDirectory, '../..');
const manifestPath = resolve(rackdownRoot, 'upstream/netbox.devices.json');
const snapshotRoot = resolve(rackdownRoot, 'upstream/netbox');
const generatedRoot = resolve(
  rackdownRoot,
  'packages/rackdown-devices/generated',
);

function snapshotPath(relativePath) {
  const absolute = resolve(snapshotRoot, relativePath);
  if (
    absolute !== snapshotRoot &&
    !absolute.startsWith(`${snapshotRoot}${sep}`)
  ) {
    throw new TypeError(`NetBox path escapes snapshot root: ${relativePath}`);
  }
  return absolute;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

export async function loadSelectedRawDevices() {
  const manifest = await readJson(manifestPath);
  if (!Array.isArray(manifest.devices) || manifest.devices.length === 0) {
    throw new TypeError('NetBox manifest must contain at least one device.');
  }

  const rawDevices = [];
  for (const entry of manifest.devices) {
    if (typeof entry?.path !== 'string' || typeof entry?.slug !== 'string') {
      throw new TypeError(
        'NetBox manifest entries require path and slug strings.',
      );
    }

    const raw = parse(await readFile(snapshotPath(entry.path), 'utf8'));
    if (raw?.slug !== entry.slug) {
      throw new TypeError(
        `NetBox manifest expected slug ${entry.slug}, found ${String(raw?.slug)} in ${entry.path}.`,
      );
    }
    rawDevices.push(raw);
  }
  return rawDevices;
}

export async function generateDeviceIndex() {
  return normalizeDeviceIndex(await loadSelectedRawDevices());
}

export function serializeDeviceModule(index) {
  return `export const deviceIndex = ${JSON.stringify(index, null, 2)};\n\nexport default deviceIndex;\n`;
}

export async function generateDeviceFiles() {
  const index = await generateDeviceIndex();
  const lock = await readJson(
    resolve(rackdownRoot, 'upstream/netbox.lock.json'),
  );
  const sourceModule = `export const fullCatalogueSource = Object.freeze(${JSON.stringify({ repository: lock.source, ref: lock.ref, license: lock.license }, null, 2)});\n`;
  return {
    index,
    sourceModule,
    json: serializeDeviceIndex(index),
    module: serializeDeviceModule(index),
  };
}

export async function writeGeneratedDeviceFiles() {
  const files = await generateDeviceFiles();
  await mkdir(generatedRoot, { recursive: true });
  await Promise.all([
    writeFile(resolve(generatedRoot, 'device-index.json'), files.json),
    writeFile(resolve(generatedRoot, 'index.mjs'), files.module),
    writeFile(
      resolve(generatedRoot, 'catalogue-source.mjs'),
      files.sourceModule,
    ),
  ]);
  return files.index;
}
