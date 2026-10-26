import { describe, expect, it } from 'vitest';
import type { DeviceIndex } from './devices.js';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
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

describe('endpoint diagnostic positions', () => {
  const prefix =
    'rack "Network" 6U\n5 switch "Core Switch" as a\n4 switch "Gateway" as b\n';
  const devices: DeviceIndex = {
    switch: {
      slug: 'switch',
      ports: [
        { name: '1', aliases: ['shared'] },
        { name: '2', aliases: ['shared'] },
      ],
    },
  };

  it.each([
    ['  missing -- b', 'Unresolved device reference: missing', 3],
    ['  a -- missing', 'Unresolved device reference: missing', 8],
    ['  switch -- b', 'Ambiguous device reference: switch', 3],
    ['  a -- switch', 'Ambiguous device reference: switch', 8],
    ['  a:wrong -- b:1', 'Unknown port "wrong"', 5],
    ['  a:1 -- b:wrong', 'Unknown port "wrong"', 12],
    ['  a:shared -- b:1', 'Ambiguous port "shared"', 5],
    ['  a:1 -- b:shared', 'Ambiguous port "shared"', 12],
    ['  a : 1 -- b :  wrong', 'Unknown port "wrong"', 17],
    ['  "Core Switch" : "wrong port" -- b:1', 'Unknown port "wrong port"', 19],
    [
      '  a:1 -- "Missing Name"',
      'Unresolved device reference: Missing Name',
      10,
    ],
  ])('locates %s', (line, message, column) => {
    const source = `${prefix}${line} // untouched offsets`;
    const document = parse(source);
    const layout = resolve(document, devices);
    expect(layout.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: 'warn',
        line: 4,
        column,
        message: expect.stringContaining(message),
      }),
    );
    expect(parse(source)).toEqual(document);
    expect(resolve(parse(source), devices)).toEqual(layout);
    expect(toSvg(resolve(parse(source), devices))).toBe(toSvg(layout));
  });

  it('uses raw offsets after escaped names and ports', () => {
    const source = String.raw`rack "R" 6U
5 switch "Core \"X\" C:\\Rack" as a
4 switch "Gateway" as b
  "Core \"X\" C:\\Rack" : "bad\"port" -- b : "bad\\port" // comment`;
    const line = source.split('\n')[3] ?? '';
    const layout = resolve(parse(source), devices);
    expect(
      layout.diagnostics.map(({ line, column }) => ({ line, column })),
    ).toEqual([
      { line: 4, column: line.indexOf('"bad') + 1 },
      { line: 4, column: line.lastIndexOf('"bad') + 1 },
    ]);
  });

  it('falls back for manually constructed endpoints and preserves valid output', () => {
    const document = parse(`${prefix}  a:1 -- b:2`);
    const legacy = parse(`${prefix}  a:1 -- b:2`);
    const statement = legacy.connections[0];
    if (!statement) throw new Error('Missing connection');
    statement.from = { kind: 'device', device: 'a', port: '1' };
    statement.to = { kind: 'device', device: 'b', port: '2' };
    expect(resolve(document, devices)).toEqual(resolve(legacy, devices));
    expect(toSvg(resolve(document, devices))).toBe(
      toSvg(resolve(legacy, devices)),
    );
    statement.to = { kind: 'device', device: 'b', port: 'wrong' };
    expect(resolve(legacy, devices).diagnostics[0]).toMatchObject({
      line: 4,
      column: 3,
    });
    statement.to = { kind: 'device', device: 'missing' };
    expect(resolve(legacy, devices).diagnostics[0]).toMatchObject({
      line: 4,
      column: 3,
    });
  });

  it.each(['missing', 'switch', 'b:wrong', 'b:shared'])(
    'falls back independently without destination metadata: %s',
    (target) => {
      const document = parse(`${prefix}  a:1 -- ${target}`);
      const statement = document.connections[0];
      if (statement?.to.kind !== 'device') throw new Error('Missing endpoint');
      delete statement.to.deviceSource;
      delete statement.to.portSource;
      expect(resolve(document, devices).diagnostics[0]).toMatchObject({
        line: 4,
        column: 3,
      });
    },
  );

  it('records token positions without changing recovered endpoint identity', () => {
    const document = parse(`${prefix}  a : -- b : "wrong`);
    expect(document.connections[0]?.from).toEqual({
      kind: 'device',
      device: 'a',
      deviceSource: { line: 4, column: 3 },
    });
    expect(document.connections[0]?.to).toEqual({
      kind: 'device',
      device: 'b',
      port: 'wrong',
      deviceSource: { line: 4, column: 10 },
      portSource: { line: 4, column: 14 },
    });
    expect(resolve(document, devices).diagnostics).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('Unknown port'),
        line: 4,
        column: 14,
      }),
    );
  });

  it('keeps endpoint-local adhoc suppression', () => {
    const layout = resolve(
      parse(`${prefix}  a:wrong adhoc -- b:wrong adhoc`),
      devices,
    );
    expect(layout.diagnostics).toEqual([]);
    expect(layout.connections).toHaveLength(1);
  });
});
