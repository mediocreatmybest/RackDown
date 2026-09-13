import { gzipSync } from 'node:zlib';
import { fullCatalogueSource } from '@rackdown/devices/full-catalogue';

import { describe, expect, it } from 'vitest';

import { CatalogueProvider, decodeCataloguePayload } from './catalogue.js';

function encode(value: unknown): string {
  return gzipSync(JSON.stringify(value), { level: 9 }).toString('base64');
}

function fixture() {
  return {
    schemaVersion: 1,
    source: {
      repository: fullCatalogueSource.repository,
      ref: fullCatalogueSource.ref,
    },
    scope: 'full',
    devices: {
      'example-switch': {
        slug: 'example-switch',
        manufacturer: 'Example',
        model: 'Switch 24',
        uHeight: 1,
      },
    },
    racks: {
      'example-rack': {
        slug: 'example-rack',
        manufacturer: 'Example',
        model: 'Rack 42',
        u_height: 42,
      },
    },
  } as const;
}

describe('catalogue payload', () => {
  it('decodes a gzip-compressed catalogue', async () => {
    const catalogue = await decodeCataloguePayload(encode(fixture()));

    expect(catalogue.scope).toBe('full');
    expect(catalogue.devices['example-switch']?.uHeight).toBe(1);
    expect(catalogue.racks['example-rack']).toMatchObject({ u_height: 42 });
  });

  it('caches one catalogue load for the provider lifetime', async () => {
    const provider = new CatalogueProvider(encode(fixture()));

    expect(provider.load()).toBe(provider.load());
    expect((await provider.deviceIndex())['example-switch']?.model).toBe(
      'Switch 24',
    );
  });

  it('rejects unsupported payload schemas', async () => {
    await expect(
      decodeCataloguePayload(
        encode({
          ...fixture(),
          schemaVersion: 2,
        }),
      ),
    ).rejects.toThrow('unsupported schema version');
  });
});
