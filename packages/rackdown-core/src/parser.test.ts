import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';

describe('parse', () => {
  it('parses a rack and ordinary device placements', () => {
    const result = parse(`rack "Home Lab" 24U 19in u1 bottom

18 switch "Core Switch" as core
10 2U server "PVE01"
1 blank`);

    expect(result.diagnostics).toEqual([]);
    expect(result.racks).toEqual([
      expect.objectContaining({
        id: 'rack-1',
        name: 'Home Lab',
        units: 24,
        widthInches: 19,
        u1: 'bottom',
        views: ['front'],
      }),
    ]);
    expect(result.devices).toEqual([
      expect.objectContaining({
        id: 'device-3',
        positionU: 18,
        deviceType: 'switch',
        label: 'Core Switch',
        alias: 'core',
        mountFace: 'front',
      }),
      expect.objectContaining({
        id: 'device-4',
        positionU: 10,
        explicitUHeight: 2,
        deviceType: 'server',
        label: 'PVE01',
        mountFace: 'front',
      }),
      expect.objectContaining({
        id: 'device-5',
        positionU: 1,
        deviceType: 'blank',
        label: 'blank',
        mountFace: 'front',
      }),
    ]);
  });

  it('preserves requested rack view order', () => {
    const frontRear = parse(
      `rack "Comms Rack" 12U 19in u1 bottom views front rear`,
    );
    const rearFront = parse(
      `rack "Comms Rack" 12U 19in u1 bottom views rear front`,
    );

    expect(frontRear.racks[0]?.views).toEqual(['front', 'rear']);
    expect(rearFront.racks[0]?.views).toEqual(['rear', 'front']);
    expect(frontRear.diagnostics).toEqual([]);
    expect(rearFront.diagnostics).toEqual([]);
  });

  it('supports a rear-only rack view and rear-mounted placement', () => {
    const result = parse(`rack "Comms Rack" 12U views rear
rear 4 pdu "PDU A" as pdu-a`);

    expect(result.racks[0]?.views).toEqual(['rear']);
    expect(result.devices[0]).toEqual(
      expect.objectContaining({
        positionU: 4,
        deviceType: 'pdu',
        label: 'PDU A',
        alias: 'pdu-a',
        mountFace: 'rear',
      }),
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('deduplicates repeated rack views with a diagnostic', () => {
    const result = parse(`rack "Comms Rack" 12U views front rear front`);

    expect(result.racks[0]?.views).toEqual(['front', 'rear']);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 1,
        message: 'Duplicate rack view: front',
      }),
    ]);
  });

  it('recovers an empty views clause to the default front view', () => {
    const result = parse(`rack "Comms Rack" 12U views`);

    expect(result.racks[0]?.views).toEqual(['front']);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 1,
        message: 'Rack views are missing or invalid; using front.',
      }),
    ]);
  });

  it('supports U1 at the top and fractional U placements', () => {
    const result = parse(`rack "Tiny Rack" 6U 10in u1 top
5.5 0.5U device "Small Device"`);

    expect(result.racks[0]?.u1).toBe('top');
    expect(result.devices[0]).toEqual(
      expect.objectContaining({ positionU: 5.5, explicitUHeight: 0.5 }),
    );
  });

  it('rejects fractional rack heights with an explicit diagnostic', () => {
    const result = parse(`rack "Half Rack" 6.5U 19in u1 bottom
1 0.5U device "Small"`);

    expect(result.racks).toEqual([]);
    expect(result.devices).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        line: 1,
        message: 'Rack height must be a whole number of rack units: 6.5U',
        hint: 'Specify a positive whole number such as 42U. Fractional positions and heights are supported for devices, but racks require integer heights.',
      }),
      expect.objectContaining({
        severity: 'warn',
        line: 2,
        message:
          'Device placement appears before any rack declaration; ignoring it.',
      }),
    ]);
  });

  it('reports only the invalid-height diagnostic for a zero-unit rack', () => {
    const result = parse('rack 0U');

    expect(result.racks).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        severity: 'error',
        line: 1,
        column: 6,
        message: 'Rack height is missing or invalid.',
        hint: 'Specify a positive rack height such as 42U.',
      },
    ]);
  });

  it('still warns when a valid rack height is supplied without a name', () => {
    const result = parse('rack 42U');

    expect(result.racks).toEqual([
      expect.objectContaining({
        name: 'Rack',
        units: 42,
      }),
    ]);

    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 1,
        column: 6,
        message: 'Rack name is missing; using "Rack".',
      }),
    ]);
  });

  it('parses device-to-device connections with arbitrary ports and media', () => {
    const result = parse(`rack "Server Room" 12U
10 switch "Core" as core
8 server "PVE01" as pve1
core:banana -- pve1:toaster weird-fibre`);

    expect(result.connections).toEqual([
      expect.objectContaining({
        id: 'connection-4',
        from: { kind: 'device', device: 'core', port: 'banana' },
        to: { kind: 'device', device: 'pve1', port: 'toaster' },
        media: 'weird-fibre',
      }),
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('preserves external targets without resolving them', () => {
    const result = parse(`rack "Server Room" 12U
10 patch "Fibre Patch" as fibre
fibre:12 -- [[Garage Rack]]`);

    expect(result.connections[0]).toEqual(
      expect.objectContaining({
        from: { kind: 'device', device: 'fibre', port: '12' },
        to: {
          kind: 'external',
          label: 'Garage Rack',
          link: { style: 'wiki', target: 'Garage Rack' },
        },
      }),
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('accepts whole-device endpoints without a port', () => {
    const result = parse(`rack "Server Room" 12U
10 switch "Core" as core
8 server "PVE01" as pve1
core -- pve1`);

    expect(result.connections[0]).toEqual(
      expect.objectContaining({
        from: { kind: 'device', device: 'core' },
        to: { kind: 'device', device: 'pve1' },
      }),
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('recovers an unfinished port reference as a whole-device endpoint', () => {
    const result = parse(`rack "Server Room" 12U
10 switch "Core" as core
8 server "PVE01" as pve1
core: -- pve1:nic1`);

    expect(result.connections[0]?.from).toEqual({
      kind: 'device',
      device: 'core',
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 4,
        message:
          'Connection port is unfinished; preserving the device endpoint.',
      }),
    ]);
  });

  it('recovers an unterminated external target', () => {
    const result = parse(`rack "Server Room" 12U
10 patch "Fibre Patch" as fibre
fibre:12 -- [[Garage Rack`);

    expect(result.connections[0]?.to).toEqual({
      kind: 'external',
      label: 'Garage Rack',
      link: {
        style: 'wiki',
        target: 'Garage Rack',
      },
    });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 3,
        message:
          'Unterminated external `[[target]]`; recovered to end of line.',
      }),
    ]);
  });

  it('ignores malformed connections that are missing an endpoint', () => {
    const result = parse(`rack "Server Room" 12U
10 switch "Core" as core
core:gi1 --`);

    expect(result.connections).toHaveLength(0);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 3,
        message: 'Connection is missing an endpoint; ignoring it.',
      }),
    ]);
  });

  it('does not guess through multiple connection operators', () => {
    const result = parse(`rack "Server Room" 12U
10 switch "Core" as core
core:a -- core:b -- core:c`);

    expect(result.connections).toHaveLength(0);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 3,
        message:
          'Connection contains more than one `--` operator; ignoring it.',
      }),
    ]);
  });

  it('recovers a started but incomplete U1 direction', () => {
    const result = parse(`rack "Server Room" 42U 19in u1
40 switch "Core"`);

    expect(result.racks[0]).toEqual(expect.objectContaining({ u1: 'bottom' }));
    expect(result.devices).toHaveLength(1);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 1,
        message: 'U1 direction is missing or invalid; using bottom.',
      }),
    ]);
  });

  it('recovers an unterminated quoted device label', () => {
    const result = parse(`rack "Server Room" 12U 19in u1 bottom
10 switch "Core Switch`);

    expect(result.devices[0]?.label).toBe('Core Switch');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 2,
        message: 'Unterminated quoted device label; recovered to end of line.',
      }),
    ]);
  });

  it('recovers unquoted labels without inventing extra structure', () => {
    const result = parse(`rack "Server Room" 12U
10 switch Core Switch as core`);

    expect(result.devices[0]).toEqual(
      expect.objectContaining({ label: 'Core Switch', alias: 'core' }),
    );
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 2,
        message: 'Device labels should be quoted; recovered an unquoted label.',
      }),
    ]);
  });

  it('treats a bare U position as generic device intent', () => {
    const result = parse(`rack "Server Room" 12U
18`);

    expect(result.devices[0]).toEqual(
      expect.objectContaining({
        positionU: 18,
        deviceType: 'device',
        label: 'device',
      }),
    );
    expect(result.diagnostics[0]?.message).toBe(
      'Device type is missing; using generic device.',
    );
  });

  it('ignores nonsense lines but preserves surrounding intent', () => {
    const result = parse(`rack "Server Room" 12U
banana spacecraft pancakes
10 switch "Core"`);

    expect(result.racks).toHaveLength(1);
    expect(result.devices).toHaveLength(1);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        line: 2,
        message: 'Unrecognised RackDown statement: banana',
      }),
    ]);
  });

  it('does not invent a rack for a device placed before a declaration', () => {
    const result = parse(`10 switch "Early"
rack "Server Room" 12U`);

    expect(result.devices).toHaveLength(0);
    expect(result.racks).toHaveLength(1);
    expect(result.diagnostics[0]?.message).toBe(
      'Device placement appears before any rack declaration; ignoring it.',
    );
  });

  it('ignores blank lines and line comments', () => {
    const result = parse(`// room rack

 rack "Server Room" 12U
 // spare capacity below
 10 switch "Core"`);

    expect(result.racks).toHaveLength(1);
    expect(result.devices).toHaveLength(1);
    expect(result.diagnostics).toEqual([]);
  });

  describe('special rack item parsing: blank and shelf', () => {
    it('parses bare blank and shelf with explicitLabel set to false', () => {
      const result = parse('rack "Rack" 12U\n1 blank\n2 shelf');

      expect(result.devices).toEqual([
        expect.objectContaining({
          deviceType: 'blank',
          label: 'blank',
          explicitLabel: false,
        }),
        expect.objectContaining({
          deviceType: 'shelf',
          label: 'shelf',
          explicitLabel: false,
        }),
      ]);
      expect(result.diagnostics).toEqual([]);
    });

    it('parses quoted labels for blank and shelf with explicitLabel set to true', () => {
      const result = parse(
        'rack "Rack" 12U\n1 2U blank "Reserved"\n3 1U shelf "Micro PCs"',
      );

      expect(result.devices).toEqual([
        expect.objectContaining({
          deviceType: 'blank',
          label: 'Reserved',
          explicitUHeight: 2,
          explicitLabel: true,
        }),
        expect.objectContaining({
          deviceType: 'shelf',
          label: 'Micro PCs',
          explicitUHeight: 1,
          explicitLabel: true,
        }),
      ]);
      expect(result.diagnostics).toEqual([]);
    });
  });

  it('computes 1-based source spans with leading whitespace indentation', () => {
    const result = parse(
      '   rack "Indented" 12U\n' +
        '     10 server "PVE"\n' +
        '       pve:1 -- [[gateway]]',
    );

    expect(result.racks[0]?.source).toEqual({
      start: { line: 1, column: 4 },
      end: { line: 1, column: 23 },
    });
    expect(result.devices[0]?.source).toEqual({
      start: { line: 2, column: 6 },
      end: { line: 2, column: 21 },
    });
    expect(result.connections[0]?.source).toEqual({
      start: { line: 3, column: 8 },
      end: { line: 3, column: 28 },
    });
  });

  it('reports trailing tokens on rack and device statements', () => {
    const result = parse(
      'rack "Main" 12U unexpected rack token\n' +
        '1 server "Web" unexpected device token',
    );

    expect(result.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 1,
        column: 17,
        message: 'Ignoring unsupported rack text: unexpected rack token',
      },
      {
        severity: 'warn',
        line: 2,
        column: 16,
        message: 'Ignoring unsupported device text: unexpected device token',
      },
    ]);
  });

  it('rejects overflowing numeric strings and non-positive widths in units and width parsing', () => {
    const overflowU = `${'9'.repeat(400)}u`;
    const overflowIn = `${'9'.repeat(400)}in`;

    const overflowUnits = parse(`rack "Overflow" ${overflowU}`);
    expect(overflowUnits.racks).toHaveLength(0);
    expect(overflowUnits.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        message: 'Rack height is missing or invalid.',
      }),
    );

    const overflowWidth = parse(`rack "Main" 12U ${overflowIn}`);
    expect(overflowWidth.racks[0]?.widthInches).toBeUndefined();
    expect(overflowWidth.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        message: `Ignoring unsupported rack text: ${overflowIn}`,
      }),
    );

    const zeroWidth = parse('rack "Main" 12U 0in');
    expect(zeroWidth.racks[0]?.widthInches).toBeUndefined();
    expect(zeroWidth.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        message: 'Ignoring unsupported rack text: 0in',
      }),
    );
  });
});
