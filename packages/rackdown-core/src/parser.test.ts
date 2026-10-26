import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';

describe('parse', () => {
  it.each(['42U', '0U', '0.5U', '121U'])(
    'treats quoted rack name %s as literal text rather than height',
    (name) => {
      const result = parse(`rack "${name}" 12U`);
      expect(result.racks[0]).toMatchObject({ name, units: 12 });
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each(['2U', '0.5U', '0U'])(
    'treats quoted shorthand label %s as a literal device label',
    (label) => {
      const result = parse(`rack "Rack" 12U\n1 "${label}" as item`);
      expect(result.devices[0]).toMatchObject({
        deviceType: 'device',
        label,
        alias: 'item',
        explicitLabel: true,
      });
      expect(result.devices[0]?.explicitUHeight).toBeUndefined();
      expect(result.diagnostics).toEqual([]);
    },
  );

  it.each([
    ['12 "Patch Panel"', 12, undefined, 'front'],
    ['10 2U "Patch Panel"', 10, 2, 'front'],
    ['rear 12 "Patch Panel"', 12, undefined, 'rear'],
    ['rear 10 2U "Patch Panel"', 10, 2, 'rear'],
  ])(
    'accepts a complete generic label: %s',
    (placement, positionU, height, face) => {
      const source = `rack "Server Rack" 12U views front rear\n${placement} as panel\n8 switch "Core Switch"\n1 2U ups "UPS"\npanel -- "Core Switch"\n"Patch Panel" -- ups`;
      const document = parse(source);
      expect(document.diagnostics).toEqual([]);
      expect(document.devices[0]).toMatchObject({
        deviceType: 'device',
        label: 'Patch Panel',
        explicitLabel: true,
        positionU,
        mountFace: face,
        alias: 'panel',
      });
      expect(document.devices[0]?.explicitUHeight).toBe(height);
      expect(document.devices.map(({ deviceType }) => deviceType)).toEqual([
        'device',
        'switch',
        'ups',
      ]);
      const layout = resolve(document);
      expect(layout.diagnostics).toEqual([]);
      expect(layout.connections).toHaveLength(2);
      expect(parse(source)).toEqual(document);
      expect(resolve(parse(source))).toEqual(layout);
      expect(toSvg(resolve(parse(source)))).toBe(toSvg(layout));
    },
  );

  it.each([
    '10',
    '10 2U',
    '10 ""',
    'rear 10 2U ""',
    '10 "Unfinished',
    'rear 10 2U "Unfinished',
  ])(
    'retains missing-type warnings for incomplete generic placements: %s',
    (placement) => {
      const document = parse(
        `rack "Rack" 12U views front rear\n${placement}\n8 switch "Next"`,
      );
      expect(document.devices).toHaveLength(2);
      expect(document.devices[0]?.deviceType).toBe('device');
      expect(document.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: 'warn',
          line: 2,
          column: placement.includes('"')
            ? placement.indexOf('"') + 1
            : placement.length + 1,
          message: 'Device type is missing; using generic device.',
        }),
      );
      if (placement.includes('Unfinished')) {
        expect(document.diagnostics).toContainEqual(
          expect.objectContaining({
            severity: 'warn',
            line: 2,
            column: placement.indexOf('"') + 1,
            message:
              'Unterminated quoted device label; recovered to end of line.',
          }),
        );
      }
    },
  );

  it('does not infer catalogue types from generic display labels', () => {
    const document = parse(
      'rack "Rack" 12U\n10 "vendor-server"\n6 vendor-server "Typed Server"',
    );
    expect(document.diagnostics).toEqual([]);
    const layout = resolve(document, {
      'vendor-server': {
        slug: 'vendor-server',
        model: 'Catalogue Server',
        uHeight: 2,
      },
    });
    expect(layout.diagnostics).toEqual([]);
    expect(layout.devices[0]).toMatchObject({
      deviceType: 'device',
      label: 'vendor-server',
      uHeight: 1,
    });
    expect(layout.devices[1]).toMatchObject({
      deviceType: 'vendor-server',
      label: 'Typed Server',
      uHeight: 2,
    });
  });

  it.each(['-2U', '-0.5U', '-0U'])(
    'recovers negative height %s without consuming device content',
    (height) => {
      for (const prefix of ['1', 'rear 1']) {
        for (const typed of ['server ', '']) {
          const line = `  ${prefix} ${height} ${typed}"Host" as host`;
          const source = `rack "R" 4U views front rear\n${line}\n3 switch "Next"`;
          const document = parse(source);
          expect(document.devices[0]).toMatchObject({
            deviceType: typed ? 'server' : 'device',
            label: 'Host',
            alias: 'host',
            positionU: 1,
            mountFace: prefix.startsWith('rear') ? 'rear' : 'front',
            source: {
              start: { line: 2, column: 3 },
              end: { line: 2, column: line.length + 1 },
            },
          });
          expect(document.devices[0]?.explicitUHeight).toBeUndefined();
          expect(document.devices[1]?.label).toBe('Next');
          expect(document.diagnostics).toEqual([
            expect.objectContaining({
              severity: 'warn',
              line: 2,
              column: line.indexOf(height) + 1,
              message:
                'Device height must not be negative; using default height.',
            }),
          ]);
          expect(resolve(document).devices[0]?.uHeight).toBe(1);
          expect(
            resolve(document, { server: { slug: 'server', uHeight: 2 } })
              .devices[0]?.uHeight,
          ).toBe(typed ? 2 : 1);
          expect(parse(source)).toEqual(document);
          expect(resolve(parse(source))).toEqual(resolve(document));
          expect(toSvg(resolve(parse(source)))).toBe(toSvg(resolve(document)));
        }
      }
    },
  );

  it.each(['-2UX', '-watU', '+2U', '-.5U'])(
    'keeps unrelated tokens as device types: %s',
    (deviceType) => {
      expect(
        parse(`rack "R" 4U\n1 ${deviceType} "Host"`).devices[0]?.deviceType,
      ).toBe(deviceType);
    },
  );

  it('keeps quoted negative U-like labels literal', () => {
    const document = parse('rack "R" 4U\n1 "-2U"');
    expect(document.devices[0]).toMatchObject({
      deviceType: 'device',
      label: '-2U',
    });
    expect(document.diagnostics).toEqual([]);
  });

  it('retains omitted rack names and unquoted integer/fractional device heights', () => {
    const result = parse(
      'rack 120U\n1 2U device "2U"\n4 0.5U device "0.5U"\n6 2U',
    );
    expect(result.racks[0]).toMatchObject({ name: 'Rack', units: 120 });
    expect(
      result.devices.map(({ label, explicitUHeight }) => ({
        label,
        explicitUHeight,
      })),
    ).toEqual([
      { label: '2U', explicitUHeight: 2 },
      { label: '0.5U', explicitUHeight: 0.5 },
      { label: 'device', explicitUHeight: 2 },
    ]);
    expect(result.diagnostics.map(({ message }) => message)).toEqual([
      'Rack name is missing; using "Rack".',
      'Device type is missing; using generic device.',
    ]);
  });

  it.each([
    'rack "42U"',
    'rack "42U',
    'rack "Rack" "12U"',
    'rack "42U" invalid',
  ])(
    'does not recover a quoted name or height as a dimension: %s',
    (source) => {
      const result = parse(source);
      expect(result.racks).toEqual([]);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({
          severity: 'error',
          line: 1,
          message: 'Rack height is missing or invalid.',
        }),
      );
      if (source === 'rack "42U') {
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({
            severity: 'warn',
            line: 1,
            column: 6,
            message: 'Unterminated quoted rack name; recovered to end of line.',
          }),
        );
      }
    },
  );

  it('recovers an unterminated U-like device label without inventing a height', () => {
    const result = parse('rack "Rack" 12U\n1 "2U');
    expect(result.devices[0]).toMatchObject({
      label: '2U',
      deviceType: 'device',
    });
    expect(result.devices[0]?.explicitUHeight).toBeUndefined();
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        line: 2,
        column: 3,
        message: 'Unterminated quoted device label; recovered to end of line.',
      }),
    );
  });

  it('still rejects over-limit heights after a quoted U-like rack name', () => {
    const result = parse('rack "42U" 121U');
    expect(result.racks).toEqual([]);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'error',
        line: 1,
        column: 12,
        message:
          'Rack height 121U exceeds the maximum supported height of 120U.',
      }),
    ]);
  });

  it.each([1, 6, 42, 120])('accepts a %iU rack', (units) => {
    const result = parse(`rack "Supported" ${units}U`);

    expect(result.diagnostics).toEqual([]);
    expect(result.racks).toEqual([expect.objectContaining({ units })]);
  });

  it.each([121, 1000000])('rejects a %iU rack before rendering', (units) => {
    const result = parse(`rack "Oversized" ${units}U`);

    expect(result.racks).toEqual([]);
    expect(result.diagnostics).toEqual([
      {
        severity: 'error',
        line: 1,
        column: 18,
        message: `Rack height ${units}U exceeds the maximum supported height of 120U.`,
        hint: 'Specify a whole-number rack height from 1U to 120U.',
      },
    ]);
    const layout = resolve(result);
    expect(layout.racks).toEqual([]);
    expect(toSvg(layout)).not.toContain('class="rackdown-rack"');
    expect(toSvg(layout)).not.toContain('class="rackdown-u-label"');
  });

  it.each(['0U', '-1U', 'oops', '42', ''])(
    'still rejects invalid height %j',
    (height) => {
      const result = parse(`rack "Invalid" ${height}`);

      expect(result.racks).toEqual([]);
      expect(result.diagnostics).toEqual([
        expect.objectContaining({
          severity: 'error',
          message: 'Rack height is missing or invalid.',
        }),
      ]);
    },
  );

  it.each(['121U', '1000000U', '0U', '-1U', '6.5U', 'invalid'])(
    'clears rack context after rejecting height %s and resumes at the next valid rack',
    (height) => {
      const result = parse(`rack "First" 6U
1 1U device "First device"
rack "Rejected" ${height}
1 1U device "Ignored"
rack "Supported" 6U
1 1U device "Kept"`);

      expect(result.racks.map((rack) => rack.name)).toEqual([
        'First',
        'Supported',
      ]);
      expect(
        result.devices.map(({ label, rackId }) => ({ label, rackId })),
      ).toEqual([
        { label: 'First device', rackId: 'rack-1' },
        { label: 'Kept', rackId: 'rack-5' },
      ]);
      expect(
        result.diagnostics.map((diagnostic) => diagnostic.severity),
      ).toEqual(['error', 'warn']);
    },
  );

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
        from: expect.objectContaining({
          kind: 'device',
          device: 'core',
          port: 'banana',
        }),
        to: expect.objectContaining({
          kind: 'device',
          device: 'pve1',
          port: 'toaster',
        }),
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
        from: expect.objectContaining({
          kind: 'device',
          device: 'fibre',
          port: '12',
        }),
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
        from: expect.objectContaining({ kind: 'device', device: 'core' }),
        to: expect.objectContaining({ kind: 'device', device: 'pve1' }),
      }),
    );
    expect(result.diagnostics).toEqual([]);
  });

  it('recovers an unfinished port reference as a whole-device endpoint', () => {
    const result = parse(`rack "Server Room" 12U
10 switch "Core" as core
8 server "PVE01" as pve1
core: -- pve1:nic1`);

    expect(result.connections[0]?.from).toMatchObject({
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

describe('inline comments', () => {
  const lines = [
    'rack "Main // Rack" 12U views front rear',
    '10 switch "Core // distribution" as core',
    'rear 2 pdu "Power" as power',
    'core:1 -- power:2 fibre category network',
  ];

  it('preserves semantics and rendering across multiple commented statements', () => {
    const source = lines.join('\n');
    const commented = lines
      .map((line) => `${line} // note -- ignored`)
      .join('\n');
    const plain = parse(source);
    const actual = parse(commented);
    expect(actual.diagnostics).toEqual(plain.diagnostics);
    for (const key of ['racks', 'devices', 'connections'] as const) {
      expect(actual[key].map(({ source, ...statement }) => statement)).toEqual(
        plain[key].map(({ source, ...statement }) => statement),
      );
      for (const statement of actual[key]) {
        expect(statement.source.end?.column).toBe(
          (commented.split('\n')[statement.source.start.line - 1]?.length ??
            0) + 1,
        );
      }
    }
    expect(parse(commented)).toEqual(actual);
    expect(resolve(actual)).toEqual(resolve(parse(commented)));
    const semantics = (value: unknown) =>
      JSON.parse(
        JSON.stringify(value, (key, item) =>
          key === 'source' ? undefined : item,
        ),
      );
    expect(semantics(resolve(actual))).toEqual(semantics(resolve(plain)));
    expect(toSvg(resolve(actual))).toBe(toSvg(resolve(plain)));
  });

  it.each([
    'core:"Port // -- one" -- external "WAN // -- label"',
    'core:1 -- [[Notes//Networking -- guide]] fibre category network',
    'core:1 -- [Docs [nested] // networking](https://example.com)',
    'core:1 -- [Notes // -- guide](https://example.com/a(b//c)--d) fibre',
    String.raw`core:"Port \" // -- one" -- external "WAN \" // label"`,
    String.raw`core:1 -- [Notes](https://example.com/a\(b//c\))`,
    'core:1 adhoc -- power:2 adhoc fibre category power',
    'core:1 -- power:2 https://example.com/device',
    'core:1 -- power:2 fibre//literal',
    'core:1 -- power:2 //literal',
    'core:1 -- power:2 category',
  ])('preserves protected content and suffixes: %s', (connection) => {
    const prefix = lines.slice(0, 3).join('\n');
    const plain = parse(`${prefix}\n${connection}`);
    const actual = parse(`${prefix}\n${connection} // comment -- ignored`);
    expect(actual.connections.map(({ source, ...value }) => value)).toEqual(
      plain.connections.map(({ source, ...value }) => value),
    );
    expect(actual.connections).toHaveLength(1);
    expect(actual.diagnostics).toEqual(plain.diagnostics);
    expect(toSvg(resolve(actual))).toBe(toSvg(resolve(plain)));
  });

  it.each([
    '  core:1 -- power:2 category invalid',
    '  core:1 -- power:2 fibre extra',
    '  core:1 -- power:2 fibre category',
    '  1 switch "Missing alias" as',
    '  rack "Missing height"',
  ])('retains diagnostics before comments: %s', (statement) => {
    const plain = parse(`\n${statement}`);
    const actual = parse(`\n${statement} // ignored`);
    expect(plain.diagnostics.length).toBeGreaterThan(0);
    expect(actual.diagnostics).toEqual(plain.diagnostics);
  });

  it.each([' //', '\t//\tnote'])(
    'accepts empty and tab-delimited trailing comments: %s',
    (comment) => {
      expect(parse(`rack "Rack" 12U${comment}`).diagnostics).toEqual([]);
    },
  );

  it('retains whole-line comments and whitespace-only lines', () => {
    expect(parse(' //comment\n\t// -- ignored\n //   \n  \n')).toEqual(
      parse(''),
    );
  });

  it('retains unfinished quoted and wiki text during recovery', () => {
    expect(
      parse('rack "Rack" 12U\n1 switch "Unfinished // name').devices[0]?.label,
    ).toBe('Unfinished // name');
    const result = parse('core:1 -- [[Unfinished // wiki');
    expect(result.connections[0]?.to).toMatchObject({
      label: 'Unfinished // wiki',
      link: { style: 'wiki', target: 'Unfinished // wiki' },
    });
  });

  it.each([
    'rack "Unfinished // name',
    'core:1 -- [[Unfinished // wiki',
    'core:1 -- [Unfinished // label',
    'core:1 -- [Link](https://example.com/unfinished // target',
  ])(
    'keeps malformed protected content available for recovery: %s',
    (source) => {
      const result = parse(source);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(parse(source)).toEqual(result);
    },
  );
});
