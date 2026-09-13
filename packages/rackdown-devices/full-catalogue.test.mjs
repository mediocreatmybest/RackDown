import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createDeviceCatalogue } from '@rackdown/devices';
import {
  CatalogueProvider,
  decodeCataloguePayload,
  fullCatalogueSource,
  parseCataloguePayload,
} from '@rackdown/devices/full-catalogue';

const fixture = () => ({
  schemaVersion: 1,
  source: {
    repository: fullCatalogueSource.repository,
    ref: fullCatalogueSource.ref,
  },
  scope: 'full',
  devices: { example: { slug: 'example', model: 'Example' } },
  racks: {},
});

test('exported asset decodes independently of Obsidian and matches the upstream pin', async () => {
  const lock = JSON.parse(
    await readFile(
      new URL('../../upstream/netbox.lock.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(fullCatalogueSource, {
    repository: lock.source,
    ref: lock.ref,
    license: lock.license,
  });
  const encoded = await readFile(
    new URL(import.meta.resolve('@rackdown/devices/full-catalogue.b64')),
    'utf8',
  );
  const payload = await decodeCataloguePayload(encoded);
  const catalogue = createDeviceCatalogue(payload.devices);
  assert.equal(
    catalogue.getDevice('dell-poweredge-r740').slug,
    'dell-poweredge-r740',
  );
  assert.ok(Object.keys(payload.devices).length > 3);
  assert.equal(payload.devices['dell-optiplex-3070-micro']?.uHeight, 0);
  assert.ok(
    Object.values(payload.devices).some((device) => device.uHeight === 0),
  );
});

test('provider caches a load and accepts equivalent decoded payloads', async () => {
  const value = fixture();
  const encoded = gzipSync(JSON.stringify(value)).toString('base64');
  const provider = new CatalogueProvider(encoded);
  assert.equal(provider.load(), provider.load());
  assert.deepEqual(await provider.load(), value);
  assert.deepEqual(await provider.deviceIndex(), value.devices);
});

test('rejects wrong pin, repository, schema, scope and missing indexes', () => {
  for (const change of [
    { source: { ...fixture().source, ref: 'wrong' } },
    { source: { ...fixture().source, repository: 'wrong' } },
    { schemaVersion: 2 },
    { scope: 'curated' },
    { devices: null },
    { racks: [] },
  ])
    assert.throws(
      () => parseCataloguePayload({ ...fixture(), ...change }),
      TypeError,
    );
});

test('core remains runtime-dependency-free and host uses the supported boundary', async () => {
  const core = JSON.parse(
    await readFile(
      new URL('../rackdown-core/package.json', import.meta.url),
      'utf8',
    ),
  );
  assert.deepEqual(core.dependencies ?? {}, {});
  const adapter = await import('../obsidian-rackdown/src/catalogue.ts');
  assert.equal(adapter.CatalogueProvider, CatalogueProvider);
});
