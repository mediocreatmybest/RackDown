import { describe, expect, it } from 'vitest';
import type { DeviceIndex } from './devices.js';
import { parse } from './parser.js';
import { resolve } from './resolver.js';
import { inchesToMm } from './units.js';

const RACK_WIDTH_MM = inchesToMm(19);

describe('shared rack rows', () => {
  it('splits two identical placements into equal halves without overlap warnings', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 12U 19in u1 bottom\n10 device "PVE01" as pve1\n10 device "PVE02" as pve2`,
      ),
    );

    expect(layout.devices).toHaveLength(2);
    expect(layout.devices[0]).toEqual(
      expect.objectContaining({ xMm: 0, widthMm: RACK_WIDTH_MM / 2 }),
    );
    expect(layout.devices[1]).toEqual(
      expect.objectContaining({
        xMm: RACK_WIDTH_MM / 2,
        widthMm: RACK_WIDTH_MM / 2,
      }),
    );
    expect(layout.diagnostics).toEqual([]);
  });

  it('uses source order for deterministic thirds', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 12U 19in\n10 device "A"\n10 device "B"\n10 device "C"`,
      ),
    );
    const third = RACK_WIDTH_MM / 3;

    expect(layout.devices.map((device) => device.label)).toEqual([
      'A',
      'B',
      'C',
    ]);
    expect(layout.devices.map((device) => device.xMm)).toEqual([
      0,
      third,
      third * 2,
    ]);
    expect(layout.devices.map((device) => device.widthMm)).toEqual([
      third,
      third,
      RACK_WIDTH_MM - third * 2,
    ]);
    expect(layout.diagnostics).toEqual([]);
  });

  it('shares identical fractional rear occupancy', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 12U 19in views front rear\nrear 5.5 0.5U device "A"\nrear 5.5 0.5U device "B"`,
      ),
    );

    expect(layout.devices.map((device) => device.mountFace)).toEqual([
      'rear',
      'rear',
    ]);
    expect(layout.devices.map((device) => device.widthMm)).toEqual([
      RACK_WIDTH_MM / 2,
      RACK_WIDTH_MM / 2,
    ]);
    expect(layout.diagnostics).toEqual([]);
  });

  it('allows known and custom devices to share the same row', () => {
    const devices: DeviceIndex = {
      'known-nuc': {
        slug: 'known-nuc',
        model: 'Known NUC',
        uHeight: 1,
      },
    };
    const layout = resolve(
      parse(
        `rack "Rack" 12U 19in\n10 known-nuc "Known"\n10 custom-nuc "Custom"`,
      ),
      devices,
    );

    expect(layout.devices.map((device) => device.widthMm)).toEqual([
      RACK_WIDTH_MM / 2,
      RACK_WIDTH_MM / 2,
    ]);
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        message: 'Unknown device definition: custom-nuc',
      }),
    ]);
  });

  it('keeps unequal vertical intersections as overlap warnings', () => {
    const layout = resolve(
      parse(`rack "Rack" 12U 19in\n10 2U server "Big"\n10 device "Small"`),
    );

    expect(layout.devices.map((device) => device.widthMm)).toEqual([
      RACK_WIDTH_MM,
      RACK_WIDTH_MM,
    ]);
    expect(layout.diagnostics).toContainEqual(
      expect.objectContaining({
        message: 'Device "Small" overlaps "Big".',
      }),
    );
  });

  it('materialises connection anchors from each split device rectangle', () => {
    const devices: DeviceIndex = {
      'known-nuc': {
        slug: 'known-nuc',
        ports: [{ name: 'eth0', kind: 'interface' }],
      },
    };
    const layout = resolve(
      parse(
        `rack "Rack" 12U 19in\n10 known-nuc "A" as a\n10 known-nuc "B" as b\n8 switch "Core" as core\na:eth0 -- core:1\nb:eth0 -- [[WAN]]`,
      ),
      devices,
    );
    const [left, right] = layout.devices;
    const [firstConnection, secondConnection] = layout.connections;

    expect(left).toBeDefined();
    expect(right).toBeDefined();
    if (!left || !right) {
      throw new Error('Expected two shared-row devices.');
    }

    expect(left.ports[0]?.anchor.xMm).toBe(left.xMm + left.widthMm);
    expect(right.ports[0]?.anchor.xMm).toBe(right.xMm + right.widthMm);
    expect(firstConnection?.from).toEqual(
      expect.objectContaining({
        kind: 'device',
        deviceId: left.id,
        anchor: left.ports[0]?.anchor,
      }),
    );
    expect(secondConnection?.from).toEqual(
      expect.objectContaining({
        kind: 'device',
        deviceId: right.id,
        anchor: right.ports[0]?.anchor,
      }),
    );
  });

  it('supports small 0U devices placed in shared rows with explicit height', () => {
    const devices: DeviceIndex = {
      'dell-optiplex-3070-micro': {
        slug: 'dell-optiplex-3070-micro',
        model: 'OptiPlex 3070 Micro',
        uHeight: 0,
      },
    };
    const layout = resolve(
      parse(
        `rack "Rack" 12U 19in\n10 0.5U dell-optiplex-3070-micro "Micro 01"\n10 0.5U dell-optiplex-3070-micro "Micro 02"`,
      ),
      devices,
    );

    expect(layout.devices).toHaveLength(2);
    expect(layout.devices[0]?.uHeight).toBe(0.5);
    expect(layout.devices[1]?.uHeight).toBe(0.5);
    expect(layout.devices.map((d) => d.widthMm)).toEqual([
      RACK_WIDTH_MM / 2,
      RACK_WIDTH_MM / 2,
    ]);
    expect(layout.diagnostics).toEqual([]);
  });

  it('excludes shelf from shared-row splitting while splitting supported devices equally', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 12U 19in\n10 2U shelf\n10 2U device "Micro 01"\n10 2U device "Micro 02"\n10 2U device "Micro 03"`,
      ),
    );

    expect(layout.devices).toHaveLength(4);
    const [shelf, m1, m2, m3] = layout.devices;
    if (!shelf || !m1 || !m2 || !m3) {
      throw new Error('Expected four devices');
    }

    expect(shelf.widthMm).toBe(RACK_WIDTH_MM);
    expect(shelf.xMm).toBe(0);

    const third = RACK_WIDTH_MM / 3;
    expect(m1.xMm).toBe(0);
    expect(m1.widthMm).toBe(third);
    expect(m2.xMm).toBe(third);
    expect(m2.widthMm).toBe(third);
    expect(m3.xMm).toBe(third * 2);
    expect(m3.widthMm).toBe(RACK_WIDTH_MM - third * 2);
    expect(layout.diagnostics).toEqual([]);
  });

  it('excludes blank from shared-row splitting and warns on same-face overlap', () => {
    const layout = resolve(
      parse(`rack "Rack" 12U 19in\n10 blank\n10 device "Server"`),
    );

    expect(layout.devices).toHaveLength(2);
    expect(layout.devices[0]?.widthMm).toBe(RACK_WIDTH_MM);
    expect(layout.devices[1]?.widthMm).toBe(RACK_WIDTH_MM);
    expect(layout.diagnostics).toContainEqual(
      expect.objectContaining({
        message: 'Device "Server" overlaps "blank".',
      }),
    );
  });
});
