import { describe, expect, it } from 'vitest';
import type { DeviceIndex } from './devices.js';
import { parse } from './parser.js';
import { resolve } from './resolver.js';

describe('device endpoint aliases', () => {
  it('resolves aliases while materialising canonical upstream port names', () => {
    const devices: DeviceIndex = {
      'vendor-gateway': {
        slug: 'vendor-gateway',
        ports: [
          {
            name: 'port.9',
            label: 'Port 9 - WAN 1',
            aliases: ['9'],
            type: '1000base-t',
          },
        ],
      },
      'vendor-switch': {
        slug: 'vendor-switch',
        ports: [
          {
            name: 'Port 24',
            aliases: ['24'],
            type: '10gbase-t',
          },
        ],
      },
    };

    const layout = resolve(
      parse(
        `rack "Rack" 12U\n10 vendor-gateway as gateway\n9 vendor-switch as core\ngateway:9 -- core:24`,
      ),
      devices,
    );

    expect(layout.connections).toHaveLength(1);
    expect(layout.connections[0]).toEqual(
      expect.objectContaining({
        from: expect.objectContaining({
          kind: 'device',
          portName: 'port.9',
          adHocPort: false,
        }),
        to: expect.objectContaining({
          kind: 'device',
          portName: 'Port 24',
          adHocPort: false,
        }),
      }),
    );
    expect(layout.diagnostics).toEqual([]);
  });

  it('matches aliases case-insensitively without changing the canonical name', () => {
    const devices: DeviceIndex = {
      'vendor-switch': {
        slug: 'vendor-switch',
        ports: [{ name: 'SFP+ 25', aliases: ['uplink25'] }],
      },
    };

    const layout = resolve(
      parse(
        `rack "Rack" 12U\n10 vendor-switch as core\ncore:UPLINK25 -- [[Garage Rack]]`,
      ),
      devices,
    );

    expect(layout.connections[0]?.from).toEqual(
      expect.objectContaining({
        kind: 'device',
        portName: 'SFP+ 25',
        adHocPort: false,
      }),
    );
    expect(layout.diagnostics).toEqual([]);
  });

  it('keeps unknown endpoints ad-hoc on otherwise known devices', () => {
    const devices: DeviceIndex = {
      'dell-poweredge-r740': {
        slug: 'dell-poweredge-r740',
        model: 'PowerEdge R740',
        ports: [{ name: 'iDRAC9' }],
      },
    };

    const layout = resolve(
      parse(
        `rack "Rack" 12U\n10 dell-poweredge-r740 as pve1\npve1:nic1 -- [[Core Network]]`,
      ),
      devices,
    );

    expect(layout.connections[0]?.from).toEqual(
      expect.objectContaining({
        kind: 'device',
        portName: 'nic1',
        adHocPort: true,
      }),
    );
    expect(layout.diagnostics).toContainEqual(
      expect.objectContaining({
        message:
          'Unknown port "nic1" on "PowerEdge R740"; preserving it as an ad-hoc endpoint.',
      }),
    );
  });
});
