import { describe, expect, it } from 'vitest';
import type { DeviceIndex } from './devices.js';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';

const SOURCE = `rack "Rack" 4U
3 1U vendor-switch "Core" as core
core:24 -- core:custom`;

describe('resolved device enrichment', () => {
  it('carries factual device and endpoint metadata without changing permissiveness', () => {
    const devices: DeviceIndex = {
      'vendor-switch': {
        slug: 'vendor-switch',
        manufacturer: 'Example Networks',
        model: 'Switch 24',
        partNumber: 'SW-24',
        uHeight: 1,
        fullDepth: true,
        airflow: 'front-to-rear',
        ports: [
          {
            name: 'Port 24',
            aliases: ['24'],
            kind: 'interface',
            type: '10gbase-t',
            managementOnly: false,
            poeMode: 'pse',
            poeType: 'type3-ieee802.3bt',
          },
        ],
      },
    };

    const layout = resolve(parse(SOURCE), devices);
    const device = layout.devices[0];

    expect(device?.metadata).toEqual({
      manufacturer: 'Example Networks',
      model: 'Switch 24',
      partNumber: 'SW-24',
      airflow: 'front-to-rear',
      fullDepth: true,
    });
    expect(device?.ports.find((port) => port.name === 'Port 24')).toEqual(
      expect.objectContaining({
        name: 'Port 24',
        kind: 'interface',
        type: '10gbase-t',
        managementOnly: false,
        poeMode: 'pse',
        poeType: 'type3-ieee802.3bt',
        adHoc: false,
      }),
    );
    expect(device?.ports.find((port) => port.name === 'custom')).toEqual(
      expect.objectContaining({
        name: 'custom',
        adHoc: true,
      }),
    );
    expect(layout.diagnostics).toContainEqual(
      expect.objectContaining({
        message:
          'Unknown port "custom" on "Core"; preserving it as an ad-hoc endpoint.',
      }),
    );
  });

  it('does not change SVG output solely because factual metadata exists', () => {
    const lean: DeviceIndex = {
      'vendor-switch': {
        slug: 'vendor-switch',
        uHeight: 1,
        ports: [
          {
            name: 'Port 24',
            aliases: ['24'],
            kind: 'interface',
          },
        ],
      },
    };
    const rich: DeviceIndex = {
      'vendor-switch': {
        slug: 'vendor-switch',
        manufacturer: 'Example Networks',
        model: 'Switch 24',
        partNumber: 'SW-24',
        uHeight: 1,
        fullDepth: true,
        airflow: 'front-to-rear',
        ports: [
          {
            name: 'Port 24',
            aliases: ['24'],
            kind: 'interface',
            type: '10gbase-t',
            poeMode: 'pse',
            poeType: 'type3-ieee802.3bt',
          },
        ],
      },
    };

    expect(toSvg(resolve(parse(SOURCE), rich))).toBe(
      toSvg(resolve(parse(SOURCE), lean)),
    );
  });
});
