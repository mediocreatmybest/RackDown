import { describe, expect, it } from 'vitest';
import type { DeviceIndex } from './devices.js';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';

const DEVICES: DeviceIndex = {
  'example-device': {
    slug: 'example-device',
    model: 'Example Server',
    manufacturer: 'Example',
    uHeight: 1,
    ports: [{ name: 'eth0', kind: 'network', type: '1000base-t' }],
  },
};

describe('catalogue label precedence', () => {
  it.each(['example-device', 'Local Server'])(
    'preserves explicit label %s in layout and SVG without requiring an alias',
    (label) => {
      const layout = resolve(
        parse(`rack "Servers" 6U\n5 example-device "${label}"`),
        DEVICES,
      );
      expect(layout.devices[0]).toMatchObject({
        label,
        deviceType: 'example-device',
        explicitLabel: true,
        unknown: false,
      });
      expect(layout.devices[0]?.alias).toBeUndefined();
      expect(layout.diagnostics).toEqual([]);
      expect(toSvg(layout, { namespace: 'labels' })).toContain(
        `>${label}</text>`,
      );
    },
  );

  it('changes only the display label while retaining catalogue enrichment, aliases and connections', () => {
    const source =
      'rack "Servers" 6U\n5 example-device "example-device" as host\n4 example-device as spare\nhost:eth0 -- spare:eth0 category network';
    const layout = resolve(parse(source), DEVICES);
    const reference = resolve(
      parse(source.replace('"example-device"', '"Custom"')),
      DEVICES,
    );
    const [host, spare] = layout.devices;
    expect(host?.label).toBe('example-device');
    expect(spare?.label).toBe('Example Server');
    expect(host).toMatchObject({
      id: 'device-2',
      deviceType: 'example-device',
      alias: 'host',
      explicitLabel: true,
      xMm: 0,
      yMm: 44.45,
      uHeight: 1,
      heightMm: 44.45,
      metadata: { manufacturer: 'Example', model: 'Example Server' },
    });
    expect(spare).toMatchObject({
      id: 'device-3',
      deviceType: 'example-device',
      alias: 'spare',
      explicitLabel: false,
      yMm: 88.9,
    });
    expect(host?.ports).toEqual(reference.devices[0]?.ports);
    expect(host?.ports[0]).toMatchObject({
      name: 'eth0',
      kind: 'network',
      type: '1000base-t',
      adHoc: false,
    });
    expect(
      layout.devices.map(({ label: _label, ...device }) => device),
    ).toEqual(reference.devices.map(({ label: _label, ...device }) => device));
    expect(layout.connections).toEqual(reference.connections);
    expect(layout.connections).toHaveLength(1);
    expect(layout.diagnostics).toEqual([]);
    const svg = toSvg(layout, { namespace: 'labels' });
    expect(svg).toContain('>example-device</text>');
    expect(svg).toContain('>Example Server</text>');
    expect(
      toSvg(resolve(parse(source), DEVICES), { namespace: 'labels' }),
    ).toBe(svg);
  });

  it.each([undefined, 'Example Server'])(
    'keeps omitted-label fallback with model %s',
    (model) => {
      const devices: DeviceIndex = {
        'example-device': {
          slug: 'example-device',
          ...(model === undefined ? {} : { model }),
          uHeight: 1,
        },
      };
      const layout = resolve(
        parse('rack "Servers" 6U\n5 example-device'),
        devices,
      );
      const label = model ?? 'example-device';
      expect(layout.devices[0]).toMatchObject({
        label,
        deviceType: 'example-device',
        explicitLabel: false,
        unknown: false,
      });
      expect(layout.devices[0]?.alias).toBeUndefined();
      expect(layout.diagnostics).toEqual([]);
      expect(toSvg(layout, { namespace: 'fallback' })).toContain(
        `>${label}</text>`,
      );
    },
  );

  it.each(['device', 'unknown-device'])(
    'retains explicit labels and diagnostics for %s without catalogue data',
    (deviceType) => {
      const layout = resolve(
        parse(`rack "Servers" 6U\n5 ${deviceType} "${deviceType}"`),
      );
      expect(layout.devices[0]).toMatchObject({
        label: deviceType,
        deviceType,
        explicitLabel: true,
        uHeight: 1,
      });
      expect(layout.devices[0]?.alias).toBeUndefined();
      expect(layout.diagnostics).toEqual(
        deviceType === 'device'
          ? []
          : [
              expect.objectContaining({
                severity: 'warn',
                line: 2,
                column: 1,
                message: 'Unknown device definition: unknown-device',
              }),
            ],
      );
    },
  );

  it.each([
    ['example-device', 'Example Server'],
    ['Legacy Host', 'Legacy Host'],
  ])(
    'retains legacy fallback for caller-constructed documents without explicitLabel: %s',
    (authored, expected) => {
      const parsed = parse(`rack "Servers" 6U\n5 example-device "${authored}"`);
      const document = {
        ...parsed,
        devices: parsed.devices.map(
          ({ explicitLabel: _explicitLabel, ...device }) => device,
        ),
      };
      const layout = resolve(document, DEVICES);
      expect(layout.devices[0]?.label).toBe(expected);
      expect(layout.devices[0]).not.toHaveProperty('explicitLabel');
      expect(layout.diagnostics).toEqual([]);
      expect(toSvg(layout, { namespace: 'legacy' })).toContain(
        `>${expected}</text>`,
      );
    },
  );

  it('retains alias, exact/folded label precedence and ambiguity without generating aliases', () => {
    const source = `rack "Servers" 6U
5 example-device "example-device" as host
4 example-device "host"
3 example-device "HOST"
2 example-device "Spare"
host:eth0 -- [[WAN]]
example-device:eth0 -- [[WAN]]
EXAMPLE-DEVICE:eth0 -- [[WAN]]
HOST:eth0 -- [[WAN]]
Spare:eth0 -- [[WAN]]
sPaRe:eth0 -- [[WAN]]
hOsT:eth0 -- [[WAN]]`;
    const layout = resolve(parse(source), DEVICES);
    expect(layout.devices[0]?.label).toBe('example-device');
    expect(layout.devices.map(({ alias }) => alias)).toEqual([
      'host',
      undefined,
      undefined,
      undefined,
    ]);
    expect(
      layout.connections.map(({ from }) =>
        from.kind === 'device' ? from.deviceId : undefined,
      ),
    ).toEqual([
      'device-2',
      'device-2',
      'device-2',
      'device-4',
      'device-5',
      'device-5',
    ]);
    expect(layout.diagnostics).toEqual([
      {
        severity: 'warn',
        line: 12,
        column: 1,
        message: 'Ambiguous device reference: hOsT',
        hint: 'Matches: host (Servers, U4, front, line 3); HOST (Servers, U3, front, line 4). Use a unique alias or reference.',
      },
    ]);
  });

  it.each(['example-device', 'EXAMPLE-DEVICE'])(
    'retains unique device-type fallback for %s without aliases',
    (reference) => {
      const layout = resolve(
        parse(
          `rack "Servers" 6U\n5 example-device "Local"\n${reference}:eth0 -- [[WAN]]`,
        ),
        DEVICES,
      );
      expect(layout.devices[0]?.alias).toBeUndefined();
      expect(layout.connections[0]?.from).toMatchObject({
        kind: 'device',
        deviceId: 'device-2',
        portName: 'eth0',
        adHocPort: false,
      });
      expect(layout.diagnostics).toEqual([]);
    },
  );
});
