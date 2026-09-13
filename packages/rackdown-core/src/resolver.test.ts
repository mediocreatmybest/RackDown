import { describe, expect, it } from 'vitest';
import type { DeviceIndex } from './devices.js';
import { parse } from './parser.js';
import { resolve } from './resolver.js';
import { DIAGRAM_RACK_WIDTH_MM, inchesToMm, rackUnitsToMm } from './units.js';

describe('resolve', () => {
  it('normalises bottom-up multi-U placement to top-origin geometry', () => {
    const layout = resolve(
      parse(`rack "Rack" 12U 19in u1 bottom\n10 2U server "PVE01"`),
    );

    expect(layout.devices[0]).toEqual(
      expect.objectContaining({
        positionU: 10,
        uHeight: 2,
        yMm: rackUnitsToMm(1),
        heightMm: rackUnitsToMm(2),
      }),
    );
    expect(layout.diagnostics).toEqual([]);
  });

  it('normalises top-down and fractional placement on the same numbering axis', () => {
    const layout = resolve(
      parse(`rack "Rack" 12U 19in u1 top\n5.5 0.5U device "Small"`),
    );

    expect(layout.devices[0]).toEqual(
      expect.objectContaining({
        positionU: 5.5,
        uHeight: 0.5,
        yMm: rackUnitsToMm(4.5),
        heightMm: rackUnitsToMm(0.5),
      }),
    );
  });

  it('normalises bottom-up and fractional placement on a whole-U rack', () => {
    const layout = resolve(
      parse(`rack "Rack" 12U 19in u1 bottom\n5.5 0.5U device "Small"`),
    );

    expect(layout.devices[0]).toEqual(
      expect.objectContaining({
        positionU: 5.5,
        uHeight: 0.5,
        yMm: rackUnitsToMm(7),
        heightMm: rackUnitsToMm(0.5),
      }),
    );
  });

  it('preserves rack views and scopes occupancy to mounting face', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 12U views front rear\n10 2U server "Front"\nrear 10 2U server "Rear"\nrear 10 switch "Rear Overlap"`,
      ),
    );

    expect(layout.racks[0]?.views).toEqual(['front', 'rear']);
    expect(layout.devices.map((device) => device.mountFace)).toEqual([
      'front',
      'rear',
      'rear',
    ]);
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        message: 'Device "Rear Overlap" overlaps "Rear".',
      }),
    ]);
  });

  it('uses device metadata for height and model label when source omits them', () => {
    const devices: DeviceIndex = {
      'vendor-gateway': {
        slug: 'vendor-gateway',
        model: 'Gateway Pro',
        uHeight: 2,
      },
    };
    const layout = resolve(
      parse(`rack "Rack" 12U\n10 vendor-gateway as gateway`),
      devices,
    );

    expect(layout.devices[0]).toEqual(
      expect.objectContaining({
        label: 'Gateway Pro',
        uHeight: 2,
        unknown: false,
      }),
    );
    expect(layout.diagnostics).toEqual([]);
  });

  it('lets explicit source height override known metadata with a warning', () => {
    const devices: DeviceIndex = {
      'vendor-server': {
        slug: 'vendor-server',
        model: 'Server',
        uHeight: 2,
      },
    };
    const layout = resolve(
      parse(`rack "Rack" 12U\n8 3U vendor-server "PVE01"`),
      devices,
    );

    expect(layout.devices[0]?.uHeight).toBe(3);
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        message: 'Explicit height 3U differs from known 2U height.',
      }),
    ]);
  });

  it('recovers known 0U devices without explicit height to 1U placeholder geometry with a warning', () => {
    const devices: DeviceIndex = {
      'dell-optiplex-3070-micro': {
        slug: 'dell-optiplex-3070-micro',
        model: 'OptiPlex 3070 Micro',
        uHeight: 0,
      },
    };
    const layout = resolve(
      parse(`rack "Rack" 12U\n10 dell-optiplex-3070-micro "Micro 01"`),
      devices,
    );

    expect(layout.devices[0]?.uHeight).toBe(1);
    expect(layout.devices[0]?.heightMm).toBe(rackUnitsToMm(1));
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        message:
          'Device "Micro 01" has 0U catalogue height; using 1U placeholder geometry.',
        hint: 'Specify an explicit height such as 0.5U or 1U.',
      }),
    ]);
  });

  it('allows explicit positive source height to win on known 0U devices without warning', () => {
    const devices: DeviceIndex = {
      'dell-optiplex-3070-micro': {
        slug: 'dell-optiplex-3070-micro',
        model: 'OptiPlex 3070 Micro',
        uHeight: 0,
      },
    };
    const layout = resolve(
      parse(`rack "Rack" 12U\n10 0.5U dell-optiplex-3070-micro "Micro 01"`),
      devices,
    );

    expect(layout.devices[0]?.uHeight).toBe(0.5);
    expect(layout.devices[0]?.heightMm).toBe(rackUnitsToMm(0.5));
    expect(layout.diagnostics).toEqual([]);
  });

  it('preserves default 1U behaviour for genuinely missing height metadata', () => {
    const devices: DeviceIndex = {
      'custom-gadget': {
        slug: 'custom-gadget',
        model: 'Gadget',
      },
    };
    const layout = resolve(
      parse(`rack "Rack" 12U\n10 custom-gadget "Gadget"`),
      devices,
    );

    expect(layout.devices[0]?.uHeight).toBe(1);
    expect(layout.diagnostics).toEqual([]);
  });

  it('never produces 0-height geometry when 0U is explicitly written in source', () => {
    const layout = resolve(parse(`rack "Rack" 12U\n10 0U device "Zero"`));

    expect(layout.devices[0]?.uHeight).toBe(1);
    expect(layout.devices[0]?.heightMm).toBe(rackUnitsToMm(1));
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warn',
        message: 'Invalid device height 0U; using 1U.',
      }),
    ]);
  });

  it('warns about overflow and overlap without clamping geometry', () => {
    const layout = resolve(
      parse(`rack "Rack" 12U\n12 2U server "Tall"\n12 switch "Overlap"`),
    );

    expect(layout.devices).toHaveLength(2);
    expect(layout.devices[0]?.yMm).toBe(rackUnitsToMm(-1));
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        message: 'Device "Tall" extends beyond rack "Rack" bounds.',
      }),
      expect.objectContaining({
        message: 'Device "Overlap" overlaps "Tall".',
      }),
    ]);
  });

  it('warns for unknown definitions but not generic built-in device types', () => {
    const layout = resolve(
      parse(`rack "Rack" 12U\n10 strange-box "Mystery"\n9 switch "Core"`),
    );

    expect(layout.devices[0]).toEqual(
      expect.objectContaining({ uHeight: 1, unknown: true }),
    );
    expect(layout.devices[1]).toEqual(
      expect.objectContaining({ uHeight: 1, unknown: false }),
    );
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        message: 'Unknown device definition: strange-box',
      }),
    ]);
  });

  it('treats inherited Object.prototype names as unknown device definitions', () => {
    const layout = resolve(
      parse(`rack "Rack" 12U\n10 toString "Prototype Device"`),
    );

    expect(layout.devices).toHaveLength(1);
    expect(layout.devices[0]).toEqual(
      expect.objectContaining({ uHeight: 1, unknown: true }),
    );
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        message: 'Unknown device definition: toString',
      }),
    ]);
  });

  it('reports duplicate aliases without dropping either placement', () => {
    const layout = resolve(
      parse(`rack "Rack" 12U\n10 switch "One" as core\n8 switch "Two" as core`),
    );

    expect(layout.devices).toHaveLength(2);
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        message: 'Duplicate device alias: core',
      }),
    ]);
  });

  it('resolves aliases and canonical known port names', () => {
    const devices: DeviceIndex = {
      'vendor-gateway': {
        slug: 'vendor-gateway',
        model: 'Gateway Pro',
        ports: [{ name: 'port.1', label: 'lan', kind: 'ethernet' }],
      },
      'vendor-switch': {
        slug: 'vendor-switch',
        model: 'Switch Pro',
        ports: [{ name: 'Port 24', label: '24', type: '10gbase-x-sfpp' }],
      },
    };
    const layout = resolve(
      parse(
        `rack "Rack" 12U\n10 vendor-gateway as gateway\n9 vendor-switch as core\ngateway:lan -- core:24 fibre`,
      ),
      devices,
    );

    expect(layout.connections).toHaveLength(1);
    expect(layout.connections[0]).toEqual(
      expect.objectContaining({
        media: 'fibre',
        from: expect.objectContaining({
          kind: 'device',
          deviceId: layout.devices[0]?.id,
          portName: 'port.1',
          adHocPort: false,
        }),
        to: expect.objectContaining({
          kind: 'device',
          deviceId: layout.devices[1]?.id,
          portName: 'Port 24',
          adHocPort: false,
        }),
      }),
    );
    expect(layout.diagnostics).toEqual([]);
  });

  it('preserves unknown known-device ports as ad-hoc endpoints with a warning', () => {
    const devices: DeviceIndex = {
      'vendor-switch': {
        slug: 'vendor-switch',
        model: 'Switch Pro',
        ports: [{ name: 'Port 1' }],
      },
    };
    const layout = resolve(
      parse(
        `rack "Rack" 12U\n10 vendor-switch as core\ncore:banana -- [[Garage Rack]]`,
      ),
      devices,
    );

    expect(layout.connections).toHaveLength(1);
    expect(layout.connections[0]?.from).toEqual(
      expect.objectContaining({
        kind: 'device',
        portName: 'banana',
        adHocPort: true,
      }),
    );
    expect(layout.externals).toEqual([
      expect.objectContaining({
        label: 'Garage Rack',
        link: { style: 'wiki', target: 'Garage Rack' },
      }),
    ]);
    expect(layout.devices[0]?.ports).toContainEqual(
      expect.objectContaining({ name: 'banana', adHoc: true }),
    );
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        message:
          'Unknown port "banana" on "Switch Pro"; preserving it as an ad-hoc endpoint.',
      }),
    ]);
  });

  it('keeps external targets semantic and outside physical layout bounds', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 12U 19in\n10 switch "Core" as core\ncore:1 -- [[ISP Handover]]`,
      ),
    );

    expect(layout.externals).toEqual([
      {
        id: 'external-1',
        label: 'ISP Handover',
        link: { style: 'wiki', target: 'ISP Handover' },
      },
    ]);
    expect(layout.connections[0]?.to).toEqual({
      kind: 'external',
      externalId: 'external-1',
      label: 'ISP Handover',
      link: { style: 'wiki', target: 'ISP Handover' },
    });
    expect(layout.connections[0]?.to).not.toHaveProperty('anchor');
    expect(layout.bounds).toEqual({
      widthMm: inchesToMm(19),
      heightMm: rackUnitsToMm(12),
    });
    expect(layout.diagnostics).toEqual([]);
  });

  it('resolves a unique device type without requiring an alias', () => {
    const layout = resolve(
      parse(`rack "Rack" 12U\n10 switch "Core"\nswitch:24 -- [[Garage Rack]]`),
    );

    expect(layout.connections).toHaveLength(1);
    expect(layout.connections[0]?.from).toEqual(
      expect.objectContaining({ kind: 'device', adHocPort: true }),
    );
    expect(layout.externals).toHaveLength(1);
    expect(layout.diagnostics).toEqual([]);
  });

  it('does not expose generated layout ids as source references', () => {
    const layout = resolve(
      parse(`rack "Rack" 12U\n10 switch "Core"\ndevice-2:1 -- [[Garage Rack]]`),
    );

    expect(layout.devices[0]?.id).toBe('device-2');
    expect(layout.connections).toEqual([]);
    expect(layout.externals).toEqual([]);
    expect(layout.diagnostics).toContainEqual(
      expect.objectContaining({
        message: 'Unresolved device reference: device-2',
      }),
    );
  });

  it('warns and omits a connection with an unresolved device reference', () => {
    const layout = resolve(
      parse(`rack "Rack" 12U\n10 switch "Core" as core\nmissing:1 -- core:1`),
    );

    expect(layout.connections).toEqual([]);
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({
        message: 'Unresolved device reference: missing',
      }),
    ]);
  });

  it('treats duplicate aliases as ambiguous connection references', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 12U\n10 switch "One" as core\n8 switch "Two" as core\ncore:1 -- [[Garage Rack]]`,
      ),
    );

    expect(layout.connections).toEqual([]);
    expect(layout.externals).toEqual([]);
    expect(layout.diagnostics).toEqual([
      expect.objectContaining({ message: 'Duplicate device alias: core' }),
      expect.objectContaining({ message: 'Ambiguous device reference: core' }),
    ]);
  });

  describe('special rack items: blank and shelf', () => {
    it('resolves bare blank with default 1U height and no diagnostics', () => {
      const layout = resolve(parse('rack "Rack" 12U 19in\n1 blank'));

      expect(layout.devices).toHaveLength(1);
      expect(layout.devices[0]).toEqual(
        expect.objectContaining({
          deviceType: 'blank',
          positionU: 1,
          uHeight: 1,
          mountFace: 'front',
        }),
      );
      expect(layout.diagnostics).toEqual([]);
    });

    it('supports explicit positive and fractional heights for blank', () => {
      const integerLayout = resolve(parse('rack "Rack" 12U 19in\n1 2U blank'));
      expect(integerLayout.devices[0]?.uHeight).toBe(2);
      expect(integerLayout.diagnostics).toEqual([]);

      const fractionalLayout = resolve(
        parse('rack "Rack" 12U 19in\n1 0.5U blank'),
      );
      expect(fractionalLayout.devices[0]?.uHeight).toBe(0.5);
      expect(fractionalLayout.diagnostics).toEqual([]);
    });

    it('warns when a blank overlaps equipment or another blank on the same face', () => {
      const serverBlank = resolve(
        parse('rack "Rack" 12U 19in\n10 blank\n10 server "PVE01"'),
      );
      expect(serverBlank.diagnostics).toContainEqual(
        expect.objectContaining({
          message: 'Device "PVE01" overlaps "blank".',
        }),
      );

      const blankBlank = resolve(
        parse('rack "Rack" 12U 19in\n10 blank\n10 blank'),
      );
      expect(blankBlank.diagnostics).toContainEqual(
        expect.objectContaining({
          message: 'Device "blank" overlaps "blank".',
        }),
      );

      const partialBlank = resolve(
        parse('rack "Rack" 12U 19in\n10 2U blank\n11 switch "Core"'),
      );
      expect(partialBlank.diagnostics).toContainEqual(
        expect.objectContaining({
          message: 'Device "Core" overlaps "blank".',
        }),
      );
    });

    it('allows front blank and rear device in same U interval without warning', () => {
      const layout = resolve(
        parse(
          'rack "Rack" 12U 19in views front rear\n1 2U blank\nrear 1 2U pdu "Rear PDU"',
        ),
      );

      expect(layout.devices).toHaveLength(2);
      expect(layout.devices[0]?.mountFace).toBe('front');
      expect(layout.devices[1]?.mountFace).toBe('rear');
      expect(layout.diagnostics).toEqual([]);
    });

    it('allows shelf to coexist with same-face equipment without overlap warning', () => {
      const layout = resolve(
        parse('rack "Rack" 12U 19in\n10 2U shelf\n10 2U server "Server 01"'),
      );

      expect(layout.devices).toHaveLength(2);
      expect(layout.diagnostics).toEqual([]);

      const knownDevices: DeviceIndex = {
        'dell-optiplex-3070-micro': {
          slug: 'dell-optiplex-3070-micro',
          model: 'OptiPlex 3070 Micro',
          uHeight: 0,
        },
      };
      const knownLayout = resolve(
        parse(
          'rack "Rack" 12U 19in\n10 2U shelf\n10 2U dell-optiplex-3070-micro "Micro 01"',
        ),
        knownDevices,
      );

      expect(knownLayout.devices).toHaveLength(2);
      expect(knownLayout.diagnostics).toEqual([]);
    });

    it('allows equipment smaller than or within the shelf interval without warning', () => {
      const layout = resolve(
        parse(
          'rack "Rack" 12U 19in\n10 2U shelf\n10 1U server "Lower"\n11 1U server "Upper"',
        ),
      );

      expect(layout.devices).toHaveLength(3);
      expect(layout.diagnostics).toEqual([]);
    });

    it('warns when two shelves overlap on the same face', () => {
      const layout = resolve(
        parse('rack "Rack" 12U 19in\n10 2U shelf\n10 2U shelf'),
      );

      expect(layout.diagnostics).toContainEqual(
        expect.objectContaining({
          message: 'Device "shelf" overlaps "shelf".',
        }),
      );
    });

    it('warns when a shelf and a blank overlap on the same face', () => {
      const layout = resolve(
        parse('rack "Rack" 12U 19in\n10 2U shelf\n10 2U blank'),
      );

      expect(layout.diagnostics).toContainEqual(
        expect.objectContaining({
          message: 'Device "blank" overlaps "shelf".',
        }),
      );
    });

    it('preserves front and rear independence for ordinary devices alongside special items', () => {
      const layout = resolve(
        parse(
          'rack "Rack" 12U 19in views front rear\n10 2U shelf\nrear 10 2U pdu "Rear PDU"\n5 2U server "Front Server"\nrear 5 2U server "Rear Server"',
        ),
      );

      expect(layout.devices).toHaveLength(4);
      expect(layout.diagnostics).toEqual([]);
    });
  });

  describe('rack width metadata and diagram geometry', () => {
    it('preserves widthInches metadata while resolving to uniform diagram rack width', () => {
      const layout19 = resolve(
        parse('rack "Rack 19" 12U 19in\n10 server "S1"'),
      );
      const layout10 = resolve(
        parse('rack "Rack 10" 12U 10in\n10 server "S1"'),
      );
      const layoutDefault = resolve(
        parse('rack "Rack Default" 12U\n10 server "S1"'),
      );

      expect(layout19.racks[0]?.widthInches).toBe(19);
      expect(layout10.racks[0]?.widthInches).toBe(10);
      expect(layoutDefault.racks[0]?.widthInches).toBe(19);

      expect(layout19.racks[0]?.widthMm).toBe(DIAGRAM_RACK_WIDTH_MM);
      expect(layout10.racks[0]?.widthMm).toBe(DIAGRAM_RACK_WIDTH_MM);
      expect(layoutDefault.racks[0]?.widthMm).toBe(DIAGRAM_RACK_WIDTH_MM);

      expect(layout19.devices[0]?.widthMm).toBe(DIAGRAM_RACK_WIDTH_MM);
      expect(layout10.devices[0]?.widthMm).toBe(DIAGRAM_RACK_WIDTH_MM);
    });
  });

  describe('external endpoint resolution and deduplication', () => {
    it('plain external preserves label and no link', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:1 -- external "ISP Handover"',
        ),
      );
      expect(layout.externals).toEqual([
        { id: 'external-1', label: 'ISP Handover' },
      ]);
      expect(layout.connections[0]?.to).toEqual({
        kind: 'external',
        externalId: 'external-1',
        label: 'ISP Handover',
      });
    });

    it('wiki external preserves target, style, and label', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:1 -- [[Garage/Rack|Garage Switch]]',
        ),
      );
      expect(layout.externals).toEqual([
        {
          id: 'external-1',
          label: 'Garage Switch',
          link: { style: 'wiki', target: 'Garage/Rack' },
        },
      ]);
      expect(layout.connections[0]?.to).toEqual({
        kind: 'external',
        externalId: 'external-1',
        label: 'Garage Switch',
        link: { style: 'wiki', target: 'Garage/Rack' },
      });
    });

    it('Markdown external preserves target, style, and label', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:1 -- [Garage Switch](Garage/Rack.md)',
        ),
      );
      expect(layout.externals).toEqual([
        {
          id: 'external-1',
          label: 'Garage Switch',
          link: { style: 'markdown', target: 'Garage/Rack.md' },
        },
      ]);
      expect(layout.connections[0]?.to).toEqual({
        kind: 'external',
        externalId: 'external-1',
        label: 'Garage Switch',
        link: { style: 'markdown', target: 'Garage/Rack.md' },
      });
    });

    it('identical semantic externals deduplicate', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:1 -- [[Garage|Garage Rack]]\ns:2 -- [[Garage|Garage Rack]]',
        ),
      );
      expect(layout.externals).toHaveLength(1);
      expect(layout.externals[0]).toEqual({
        id: 'external-1',
        label: 'Garage Rack',
        link: { style: 'wiki', target: 'Garage' },
      });
      expect(layout.connections[0]?.to).toEqual({
        kind: 'external',
        externalId: 'external-1',
        label: 'Garage Rack',
        link: { style: 'wiki', target: 'Garage' },
      });
      expect(layout.connections[1]?.to).toEqual({
        kind: 'external',
        externalId: 'external-1',
        label: 'Garage Rack',
        link: { style: 'wiki', target: 'Garage' },
      });
    });

    it('same target with different labels do not deduplicate', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:1 -- [[Garage|Garage East]]\ns:2 -- [[Garage|Garage West]]',
        ),
      );
      expect(layout.externals).toHaveLength(2);
      expect(layout.externals[0]?.label).toBe('Garage East');
      expect(layout.externals[1]?.label).toBe('Garage West');
      expect(layout.externals[0]?.id).not.toBe(layout.externals[1]?.id);
    });

    it('plain and linked external with same visible text do not deduplicate', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:1 -- external "ISP Handover"\ns:2 -- [[Handover|ISP Handover]]',
        ),
      );
      expect(layout.externals).toHaveLength(2);
      expect(layout.externals[0]).toEqual({
        id: 'external-1',
        label: 'ISP Handover',
      });
      expect(layout.externals[1]).toEqual({
        id: 'external-2',
        label: 'ISP Handover',
        link: { style: 'wiki', target: 'Handover' },
      });
    });

    it('external IDs remain deterministic', () => {
      const text =
        'rack "R" 12U\n10 switch "S" as s\ns:1 -- external "ISP"\ns:2 -- [[Target A]]\ns:3 -- [Docs](docs.md)';
      const layout1 = resolve(parse(text));
      const layout2 = resolve(parse(text));
      expect(layout1.externals.map((e) => e.id)).toEqual([
        'external-1',
        'external-2',
        'external-3',
      ]);
      expect(layout1.externals).toEqual(layout2.externals);
    });
  });

  describe('connection endpoint anchor ownership (#199 item 1)', () => {
    it('does not alias the layout port anchor into connection endpoints', () => {
      const layout = resolve(
        parse('rack "R" 12U\n10 switch "S" as s\ns:1 -- external "ISP"'),
      );

      const device = layout.devices[0];
      const endpoint = layout.connections[0]?.from;
      expect(device).toBeDefined();
      expect(endpoint?.kind).toBe('device');
      const port = device?.ports?.find((candidate) => candidate.name === '1');
      expect(port).toBeDefined();
      if (
        !port ||
        endpoint?.kind !== 'device' ||
        endpoint.anchor === undefined
      ) {
        throw new Error('expected a resolved port-bearing device endpoint');
      }

      expect(endpoint.anchor).toEqual(port.anchor);
      expect(endpoint.anchor).not.toBe(port.anchor);

      endpoint.anchor.xMm += 1000;
      expect(port.anchor.xMm).not.toBe(endpoint.anchor.xMm);
    });

    it('does not alias two connection endpoints resolving from one port', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:1 -- external "A"\ns:1 -- external "B"',
        ),
      );

      const first = layout.connections[0]?.from;
      const second = layout.connections[1]?.from;
      if (
        first?.kind !== 'device' ||
        second?.kind !== 'device' ||
        first.anchor === undefined ||
        second.anchor === undefined
      ) {
        throw new Error('expected two resolved device endpoints');
      }

      expect(first.anchor).toEqual(second.anchor);
      expect(first.anchor).not.toBe(second.anchor);

      const originalY = second.anchor.yMm;
      first.anchor.yMm += 500;
      expect(second.anchor.yMm).toBe(originalY);
    });

    it('does not alias ad-hoc port anchors into connection endpoints', () => {
      const layout = resolve(
        parse(
          'rack "R" 12U\n10 switch "S" as s\ns:"Odd Port" adhoc -- external "ISP"',
        ),
      );

      const device = layout.devices[0];
      const endpoint = layout.connections[0]?.from;
      const port = device?.ports?.find(
        (candidate) => candidate.name === 'Odd Port',
      );
      if (
        !port ||
        endpoint?.kind !== 'device' ||
        endpoint.anchor === undefined
      ) {
        throw new Error('expected a resolved ad-hoc port endpoint');
      }

      expect(endpoint.anchor).toEqual(port.anchor);
      expect(endpoint.anchor).not.toBe(port.anchor);
    });
  });

  describe('sub-U1 placement diagnostics (#199 item 3)', () => {
    it('reports only the actionable position warning for a U0 placement', () => {
      const layout = resolve(parse('rack "R" 4U\n0 server "Low"'));

      expect(layout.diagnostics).toEqual([
        expect.objectContaining({
          severity: 'warn',
          message: 'Invalid rack position U0; rack positions begin at U1.',
        }),
      ]);
    });

    it('still reports bounds for a sub-U1 placement that also overshoots the top', () => {
      const layout = resolve(parse('rack "R" 4U\n0 6U server "Huge"'));

      expect(layout.diagnostics.map((entry) => entry.message)).toEqual([
        'Invalid rack position U0; rack positions begin at U1.',
        'Device "Huge" extends beyond rack "R" bounds.',
      ]);
    });

    it('still reports bounds for a valid start that extends beyond the rack', () => {
      const layout = resolve(parse('rack "R" 4U\n4 2U server "Tall"'));

      expect(layout.diagnostics).toEqual([
        expect.objectContaining({
          severity: 'warn',
          message: 'Device "Tall" extends beyond rack "R" bounds.',
        }),
      ]);
    });

    it('still reports bounds for a start above the rack range', () => {
      const layout = resolve(parse('rack "R" 4U\n9 server "High"'));

      expect(layout.diagnostics).toEqual([
        expect.objectContaining({
          severity: 'warn',
          message: 'Device "High" extends beyond rack "R" bounds.',
        }),
      ]);
    });
  });
});
