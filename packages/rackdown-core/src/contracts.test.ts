import { describe, expect, it } from 'vitest';
import type { DeviceDefinition, RackDocument, RackLayout } from './index.js';
import { parse, resolve } from './index.js';

const exampleDevice = {
  slug: 'example-half-u-device',
  manufacturer: 'Example',
  model: 'Half U',
  uHeight: 0.5,
  ports: [{ name: 'odd-port', kind: 'anything' }],
} satisfies DeviceDefinition;

const exampleDocument = {
  schemaVersion: 1,
  racks: [
    {
      kind: 'rack',
      id: 'rack-1',
      name: 'Tiny Rack',
      units: 6,
      widthInches: 10,
      u1: 'top',
      views: ['rear', 'front'],
      source: { start: { line: 1, column: 1 } },
    },
  ],
  devices: [
    {
      kind: 'device',
      id: 'device-1',
      rackId: 'rack-1',
      positionU: 5.5,
      deviceType: 'example-half-u-device',
      label: 'Small Device',
      alias: 'small',
      explicitUHeight: 0.5,
      mountFace: 'rear',
      source: { start: { line: 3, column: 1 } },
    },
  ],
  connections: [
    {
      kind: 'connection',
      id: 'connection-1',
      from: { kind: 'device', device: 'small', port: 'odd-port' },
      to: {
        kind: 'external',
        label: 'Other Rack',
        link: { style: 'wiki', target: 'Other Rack' },
      },
      media: 'whatever-the-author-says',
      source: { start: { line: 5, column: 1 } },
    },
  ],
  diagnostics: [],
} satisfies RackDocument;

const emptyLayout = {
  schemaVersion: 2,
  racks: [],
  devices: [],
  connections: [],
  externals: [],
  diagnostics: [],
  bounds: { widthMm: 0, heightMm: 0 },
} satisfies RackLayout;

describe('foundation contracts', () => {
  it('resolves document schema 1 to layout schema 2 with required categories', () => {
    const document = parse(
      'rack "Rack" 4U\n4 server "A" as a\n2 server "B" as b\na -- b',
    );
    const layout = resolve(document);
    expect(document.schemaVersion).toBe(1);
    expect(layout.schemaVersion).toBe(2);
    expect(layout.connections[0]?.category).toBe('unclassified');
  });

  it('supports fractional U values and unconstrained port/media names', () => {
    expect(exampleDevice.uHeight).toBe(0.5);
    expect(exampleDocument.devices[0]?.positionU).toBe(5.5);
    expect(exampleDocument.connections[0]?.media).toBe(
      'whatever-the-author-says',
    );
  });

  it('preserves rack view order and device mounting face', () => {
    expect(exampleDocument.racks[0]?.views).toEqual(['rear', 'front']);
    expect(exampleDocument.devices[0]?.mountFace).toBe('rear');
  });

  it('keeps RackLayout renderer-neutral and millimetre based', () => {
    expect(emptyLayout.bounds).toEqual({ widthMm: 0, heightMm: 0 });
  });
});
