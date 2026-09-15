import { describe, expect, it } from 'vitest';
import type { DeviceIndex } from './devices.js';
import { buildCableSchedule, parse, resolve } from './index.js';

const devices: DeviceIndex = {
  'vendor-switch': {
    slug: 'vendor-switch',
    ports: [
      {
        name: 'TwentyFiveGigE1',
        label: 'SFP+ 25',
        aliases: ['SFP25'],
        kind: 'interface',
      },
      { name: 'PSU1', aliases: ['power'], kind: 'power-port' },
    ],
  },
};

const source = `rack "Main Rack" 24U views front rear
18 vendor-switch "Core Switch" as core
rear 10 server "PVE01" as pve
core:SFP25 -- pve:"NIC 1" fibre category network
pve -- external "Console Cart" category console
external "Mains" -- core:power IEC-C13 category power
core:odd -- pve:odd custom category unclassified`;

function fixture() {
  return resolve(parse(source), devices);
}

function deepFreeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
}

describe('buildCableSchedule', () => {
  it('projects every connection in source order with category and media kept independently', () => {
    const layout = fixture();
    const rows = buildCableSchedule(layout);

    expect(rows.map((row) => row.connectionId)).toEqual(
      layout.connections.map((connection) => connection.id),
    );
    expect(rows.map(({ category, media }) => ({ category, media }))).toEqual([
      { category: 'network', media: 'fibre' },
      { category: 'console', media: undefined },
      { category: 'power', media: 'IEC-C13' },
      { category: 'unclassified', media: 'custom' },
    ]);
  });

  it('includes resolved device, canonical port and rack context without geometry', () => {
    const row = buildCableSchedule(fixture())[0];
    expect(row?.a).toEqual({
      kind: 'device',
      label: 'Core Switch',
      deviceId: 'device-2',
      alias: 'core',
      portName: 'TwentyFiveGigE1',
      rackId: 'rack-1',
      rackName: 'Main Rack',
      positionU: 18,
      mountFace: 'front',
    });
    expect(row?.b).toEqual({
      kind: 'device',
      label: 'PVE01',
      deviceId: 'device-3',
      alias: 'pve',
      portName: 'NIC 1',
      rackId: 'rack-1',
      rackName: 'Main Rack',
      positionU: 10,
      mountFace: 'rear',
    });
    expect(row).not.toHaveProperty('xMm');
    expect(row).not.toHaveProperty('from');
    expect(row).not.toHaveProperty('to');
  });

  it('represents external and whole-device endpoints with only applicable fields', () => {
    const rows = buildCableSchedule(fixture());
    expect(rows[1]?.a).toEqual({
      kind: 'device',
      label: 'PVE01',
      deviceId: 'device-3',
      alias: 'pve',
      rackId: 'rack-1',
      rackName: 'Main Rack',
      positionU: 10,
      mountFace: 'rear',
    });
    expect(rows[1]?.b).toEqual({
      kind: 'external',
      label: 'Console Cart',
      externalId: 'external-1',
    });
    expect(rows[2]?.a).toEqual({
      kind: 'external',
      label: 'Mains',
      externalId: 'external-2',
    });
  });

  it('reuses selection semantics for empty, one-category and multi-category views', () => {
    const layout = fixture();
    expect(buildCableSchedule(layout, { categories: [] })).toEqual([]);
    expect(
      buildCableSchedule(layout, { categories: ['unclassified'] }).map(
        (row) => row.category,
      ),
    ).toEqual(['unclassified']);
    expect(
      buildCableSchedule(layout, {
        categories: ['power', 'network', 'power'],
      }).map((row) => row.category),
    ).toEqual(['network', 'power']);
  });

  it('accepts the complete ConnectionSelection contract without mutating the layout or selection', () => {
    const layout = fixture();
    const selection = {
      categories: ['network', 'console'] as const,
      deviceIds: ['device-3'],
      connectionIds: ['connection-4', 'connection-5'],
    };
    const before = JSON.stringify(layout);
    deepFreeze(layout);
    deepFreeze(selection);

    expect(
      buildCableSchedule(layout, selection).map((row) => row.connectionId),
    ).toEqual(['connection-4', 'connection-5']);
    expect(JSON.stringify(layout)).toBe(before);
  });
});
