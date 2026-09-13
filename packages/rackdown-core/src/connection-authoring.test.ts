import { describe, expect, it } from 'vitest';
import type { DeviceIndex } from './devices.js';
import { parse } from './parser.js';
import { resolve } from './resolver.js';

describe('connection endpoint authoring', () => {
  it('accepts quoted port names and forgiving whitespace around the colon', () => {
    const result = parse(`rack "Lab" 12U
10 switch "Core" as core
8 server "PVE01" as pve1
core:1 -- pve1:"Gig-E 1"
core:2 -- pve1: "Gig-E 2"
core:3 -- pve1:"iDRAC"
core:4 -- pve1: iDRAC`);

    expect(result.connections.map((connection) => connection.to)).toEqual([
      { kind: 'device', device: 'pve1', port: 'Gig-E 1' },
      { kind: 'device', device: 'pve1', port: 'Gig-E 2' },
      { kind: 'device', device: 'pve1', port: 'iDRAC' },
      { kind: 'device', device: 'pve1', port: 'iDRAC' },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('accepts adhoc beside either device port and keeps media order forgiving', () => {
    const result = parse(`rack "Lab" 12U
10 switch "Core" as core
8 server "PVE01" as pve1
pve1:"NIC 01" adhoc -- core:3
core:4 -- pve1:DAC10Gbit adhoc fibre
core:5 -- pve1:DAC20Gbit fibre adhoc`);

    expect(result.connections[0]).toEqual(
      expect.objectContaining({
        from: {
          kind: 'device',
          device: 'pve1',
          port: 'NIC 01',
          adHoc: true,
        },
      }),
    );
    expect(result.connections[1]).toEqual(
      expect.objectContaining({
        to: {
          kind: 'device',
          device: 'pve1',
          port: 'DAC10Gbit',
          adHoc: true,
        },
        media: 'fibre',
      }),
    );
    expect(result.connections[2]).toEqual(
      expect.objectContaining({
        to: {
          kind: 'device',
          device: 'pve1',
          port: 'DAC20Gbit',
          adHoc: true,
        },
        media: 'fibre',
      }),
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('suppresses only explicitly intentional unknown-port warnings', () => {
    const devices: DeviceIndex = {
      'vendor-server': {
        slug: 'vendor-server',
        ports: [{ name: 'Gig-E 1' }, { name: 'iDRAC' }],
      },
    };
    const layout = resolve(
      parse(`rack "Lab" 12U
10 vendor-server "PVE01" as pve1
9 switch "Core" as core
core:1 -- pve1:"Gig-E 1"
core:2 -- pve1:"NIC 01" adhoc
core:3 -- pve1:"NIC 02"
core:4 -- pve1:iDRAC adhoc`),
      devices,
    );

    expect(layout.connections[0]?.to).toEqual(
      expect.objectContaining({ portName: 'Gig-E 1', adHocPort: false }),
    );
    expect(layout.connections[1]?.to).toEqual(
      expect.objectContaining({ portName: 'NIC 01', adHocPort: true }),
    );
    expect(layout.connections[2]?.to).toEqual(
      expect.objectContaining({ portName: 'NIC 02', adHocPort: true }),
    );
    expect(layout.connections[3]?.to).toEqual(
      expect.objectContaining({ portName: 'iDRAC', adHocPort: false }),
    );
    expect(layout.diagnostics).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: expect.stringContaining('Unknown port "NIC 01"'),
        }),
      ]),
    );
    expect(layout.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message:
            'Unknown port "NIC 02" on "PVE01"; preserving it as an ad-hoc endpoint.',
        }),
      ]),
    );
  });
});

describe('trailing connection token diagnostics (#199 items 4-5)', () => {
  it('reports a source-side stray token as unexpected text at its own column', () => {
    const result = parse('rack "R" 4U\n1 server "A" as a\n  a 1 -- a:2');

    expect(result.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 3,
        column: 5,
        message: 'Unexpected text after the source endpoint: 1',
        hint: 'Only `adhoc` may follow a source device port before the `--` operator.',
      },
    ]);
  });

  it('names the offending source-side token rather than a fixed example', () => {
    const result = parse('rack "R" 4U\n1 server "A" as a\n  a wat -- a:2');

    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        line: 3,
        column: 5,
        message: 'Unexpected text after the source endpoint: wat',
      }),
    );
  });

  it('reports destination-side unsupported text at the offending token column', () => {
    const result = parse(
      'rack "R" 4U\n1 server "A" as a\na:1 -- a:2 fibre extra',
    );

    expect(result.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 3,
        column: 18,
        message: 'Ignoring unsupported connection text: extra',
        hint: 'Connection media is a single optional token; `adhoc` may appear beside a device port.',
      },
    ]);
  });

  it('points at the first offending token when several trail the destination', () => {
    const result = parse(
      'rack "R" 4U\n1 server "A" as a\na:1 -- a:2 fibre extra more',
    );

    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        line: 3,
        column: 18,
        message: 'Ignoring unsupported connection text: extra more',
      }),
    );
  });

  it('points at a misplaced `adhoc` modifier rather than the endpoint start', () => {
    const result = parse(
      'rack "R" 4U\n1 server "A" as a\na:1 -- external "ISP" adhoc',
    );

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 3,
        column: 23,
        message:
          'The `adhoc` modifier applies only to a device endpoint with a port; ignoring it.',
      }),
    ]);
  });

  it('keeps accepting a valid trailing media token and `adhoc`', () => {
    const result = parse(
      'rack "R" 4U\n1 server "A" as a\n1 switch "B" as b\na:1 adhoc -- b:"Odd" adhoc fibre',
    );

    expect(result.diagnostics).toEqual([]);
    expect(result.connections[0]).toEqual(
      expect.objectContaining({
        from: { kind: 'device', device: 'a', port: '1', adHoc: true },
        to: { kind: 'device', device: 'b', port: 'Odd', adHoc: true },
        media: 'fibre',
      }),
    );
  });
});
