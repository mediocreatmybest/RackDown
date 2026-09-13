import { describe, expect, it } from 'vitest';
import type { DeviceIndex } from './devices.js';
import { parse } from './parser.js';
import { resolve } from './resolver.js';

describe('unknown endpoint diagnostics', () => {
  it('lists known canonical endpoints without rejecting the ad-hoc endpoint', () => {
    const devices: DeviceIndex = {
      'vendor-server': {
        slug: 'vendor-server',
        ports: [{ name: 'iDRAC9' }, { name: 'Rear Serial', label: 'Console' }],
      },
    };

    const layout = resolve(
      parse(
        `rack "Rack" 12U\n10 vendor-server as server\nserver:nic1 -- [[Core Network]]`,
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
          'Unknown port "nic1" on "vendor-server"; preserving it as an ad-hoc endpoint.',
        hint: 'Known endpoints for "vendor-server": iDRAC9, Rear Serial (Console).',
      }),
    );
  });

  it('bounds endpoint hints for devices with large port sets', () => {
    const devices: DeviceIndex = {
      'vendor-switch': {
        slug: 'vendor-switch',
        ports: Array.from({ length: 14 }, (_, index) => ({
          name: `Port ${index + 1}`,
        })),
      },
    };

    const layout = resolve(
      parse(
        `rack "Rack" 12U\n10 vendor-switch as core\ncore:banana -- [[Upstream]]`,
      ),
      devices,
    );
    const diagnostic = layout.diagnostics.find((entry) =>
      entry.message.startsWith('Unknown port "banana"'),
    );

    expect(diagnostic?.hint).toBe(
      'Known endpoints for "vendor-switch": Port 1, Port 2, Port 3, Port 4, Port 5, Port 6, Port 7, Port 8, Port 9, Port 10, Port 11, Port 12, ... and 2 more.',
    );
  });
});
