import { describe, expect, it, vi } from 'vitest';
import type { DeviceIndex, DevicePortDefinition } from './devices.js';
import { parse } from './parser.js';
import { resolve } from './resolver.js';

describe('device endpoint aliases', () => {
  it('does not inspect labels or aliases after an exact canonical match', () => {
    const readLabel = vi.fn(() => 'LAN');
    const readAliases = vi.fn(() => ['uplink']);
    const port: DevicePortDefinition = {
      name: 'eth0',
      get label() {
        return readLabel();
      },
      get aliases() {
        return readAliases();
      },
    };
    const layout = resolve(
      parse(
        'rack "Rack" 4U\n4 vendor-switch as core\ncore:eth0 -- [[External]]',
      ),
      { 'vendor-switch': { slug: 'vendor-switch', ports: [port] } },
    );

    expect(layout.connections[0]?.from).toMatchObject({
      portName: 'eth0',
      adHocPort: false,
    });
    expect(layout.diagnostics).toEqual([]);
    expect(readLabel).not.toHaveBeenCalled();
    expect(readAliases).not.toHaveBeenCalled();
  });

  it('does not scan folded aliases after an exact alias match', () => {
    const aliases = ['uplink'];
    const foldedAliases = vi.spyOn(aliases, 'some');
    const layout = resolve(
      parse(
        'rack "Rack" 4U\n4 vendor-switch as core\ncore:uplink -- [[External]]',
      ),
      {
        'vendor-switch': {
          slug: 'vendor-switch',
          ports: [{ name: 'eth0', aliases }],
        },
      },
    );

    expect(layout.connections[0]?.from).toMatchObject({
      portName: 'eth0',
      adHocPort: false,
    });
    expect(layout.diagnostics).toEqual([]);
    expect(foldedAliases).not.toHaveBeenCalled();
  });

  it.each([
    ['eth0', 'eth0'],
    ['LAN', 'eth0'],
    ['uplink', 'eth0'],
    ['ETH0', 'eth0'],
    ['backup', 'lan'],
    ['alternate', 'lan'],
  ])(
    'resolves %s at the first matching layer as %s',
    (reference, canonical) => {
      const layout = resolve(
        parse(
          `rack "Rack" 4U\n4 vendor-switch as core\ncore:${reference} -- [[External]]`,
        ),
        {
          'vendor-switch': {
            slug: 'vendor-switch',
            ports: [
              { name: 'eth0', label: 'LAN', aliases: ['uplink'] },
              {
                name: 'lan',
                label: 'Backup',
                aliases: ['UPLINK', 'Alternate'],
              },
            ],
          },
        },
      );

      expect(layout.connections[0]?.from).toMatchObject({
        portName: canonical,
        adHocPort: false,
      });
      expect(
        layout.devices[0]?.ports.map(({ name, adHoc }) => ({ name, adHoc })),
      ).toEqual([
        { name: 'eth0', adHoc: false },
        { name: 'lan', adHoc: false },
      ]);
      expect(layout.diagnostics).toEqual([]);
    },
  );

  it.each<{ reference: string; ports: DevicePortDefinition[]; hint: string }>([
    {
      reference: 'LAN',
      ports: [
        { name: 'LAN' },
        { name: 'LAN' },
        { name: 'third', aliases: ['LAN'] },
      ],
      hint: 'LAN, LAN, third',
    },
    {
      reference: 'LAN',
      ports: [
        { name: 'eth0', label: 'LAN' },
        { name: 'eth1', aliases: ['LAN'] },
        { name: 'lan' },
      ],
      hint: 'eth0 (LAN), eth1, lan',
    },
    {
      reference: 'Lan',
      ports: [{ name: 'LAN' }, { name: 'eth1', aliases: ['lan'] }],
      hint: 'LAN, eth1',
    },
  ])(
    'preserves ambiguity at the first matching layer for $reference',
    ({ reference, ports, hint }) => {
      for (const modifier of ['', ' adhoc']) {
        const layout = resolve(
          parse(
            `rack "Rack" 4U\n4 vendor-switch as core\ncore:${reference}${modifier} -- [[External]]`,
          ),
          { 'vendor-switch': { slug: 'vendor-switch', ports } },
        );

        expect(layout.connections[0]?.from).toMatchObject({
          portName: reference,
          adHocPort: true,
        });
        expect(layout.diagnostics).toEqual([
          {
            severity: 'warn',
            line: 3,
            column: 6,
            message: `Ambiguous port "${reference}" on "vendor-switch"; preserving it as an ad-hoc endpoint.`,
            hint: `Known endpoints for "vendor-switch": ${hint}.`,
          },
        ]);
      }
    },
  );

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
