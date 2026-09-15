import { describe, expect, it } from 'vitest';
import {
  type ConnectionSelection,
  type DeviceIndex,
  parse,
  resolve,
  type SvgRenderOptions,
  selectConnections,
  toSvg,
} from './index.js';

const index: DeviceIndex = {
  test: {
    slug: 'test',
    ports: [
      { name: 'input', kind: 'power-port' },
      { name: 'out', kind: 'power-outlet' },
      { name: 'net', kind: 'interface', managementOnly: true, poeMode: 'pse' },
      { name: 'con', kind: 'console-port' },
      { name: 'cs', kind: 'console-server-port' },
    ],
  },
};
const source = `rack "Mixed" 12U views front rear
10 test "Server" as server
10 test "UPS" as ups
8 test "PDU" as pdu
rear 5 test "Switch" as sw
ups:out -- pdu:input
pdu:out -- server:input
server:net -- sw:net
ups:net -- sw:net
pdu:net -- sw:net
server:con -- sw:cs
server:odd adhoc -- ups:odd
sw:net -- external "WAN"
ups:out -- [[Supply]]`;

function connectionTags(svg: string) {
  return [
    ...svg.matchAll(/<(?:line|path) [^>]*data-connection-id="([^"]+)"[^>]*>/g),
  ].map((match) => ({ id: match[1], tag: match[0] }));
}
function groups(svg: string, kind: string) {
  return (
    svg.match(
      new RegExp(`<g id="[^"]+" class="rackdown-${kind}[^]*?<\\/g>`, 'g'),
    ) ?? []
  );
}
function deepFreeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
}
const cases: SvgRenderOptions[] = [];
for (const connectionRouting of [
  'direct',
  'orthogonal',
  'lanes',
  'perimeter',
] as const)
  for (const externalPlacement of ['bottom', 'right'] as const)
    cases.push({ connectionRouting, externalPlacement });

describe('connection views after full-scene routing', () => {
  it.each(cases)(
    'preserves routes, styles, geometry and viewport with $connectionRouting / $externalPlacement',
    (options) => {
      const layout = resolve(parse(source), index);
      const before = JSON.stringify(layout);
      deepFreeze(layout);
      const server = layout.devices.find((d) => d.alias === 'server');
      const styled = layout.connections[1];
      if (!server || !styled) throw new Error('Missing fixture');
      const renderOptions: SvgRenderOptions = {
        ...options,
        namespace: 'stable',
        connectionStyles: {
          [styled.id]: {
            color: '#abcdef',
            pattern: 'dotted',
            width: 3.5,
            opacity: 0.4,
          },
        },
      };
      const all = toSvg(layout, renderOptions);
      const originals = new Map(connectionTags(all).map((c) => [c.id, c.tag]));
      expect(originals.size).toBe(9); // Front/rear projection does not duplicate semantic connections.
      expect(groups(all, 'device').length).toBeGreaterThanOrEqual(4);
      expect(groups(all, 'external')).toHaveLength(2);
      expect(server.widthMm).toBe(layout.devices[1]?.widthMm);
      expect(server.widthMm * 2).toBe(layout.racks[0]?.widthMm);
      const selections: ConnectionSelection[] = [
        {},
        { categories: ['power'] },
        { categories: ['network'] },
        { categories: ['console'] },
        { categories: ['unclassified'] },
        { deviceIds: [server.id] },
        { categories: ['power'], deviceIds: [server.id] },
        { connectionIds: [styled.id] },
        { categories: [] },
      ];
      for (const selection of selections) {
        const selected = selectConnections(layout, selection);
        const svg = toSvg(layout, {
          ...renderOptions,
          connectionSelection: selection,
        });
        expect(connectionTags(svg).map((c) => c.id)).toEqual(
          selected.map((c) => c.id),
        );
        const rows = selected.map((c) => ({ id: c.id, category: c.category }));
        expect(rows.map((r) => r.id)).toEqual(
          connectionTags(svg).map((c) => c.id),
        );
        for (const tag of connectionTags(svg))
          expect(tag.tag).toBe(originals.get(tag.id));
        expect(svg.match(/viewBox="[^"]+"/)?.[0]).toBe(
          all.match(/viewBox="[^"]+"/)?.[0],
        );
        expect(groups(svg, 'device')).toEqual(groups(all, 'device'));
        expect(groups(svg, 'rack')).toEqual(groups(all, 'rack'));
        const externals = groups(svg, 'external');
        for (const external of externals)
          expect(groups(all, 'external')).toContain(external);
        const externalIds = new Set(
          selected.flatMap((c) =>
            [c.from, c.to].flatMap((e) =>
              e.kind === 'external' ? [e.externalId] : [],
            ),
          ),
        );
        expect(externals).toHaveLength(externalIds.size);
        expect(svg).toBe(
          toSvg(layout, { ...renderOptions, connectionSelection: selection }),
        );
        expect(svg).toMatch(/^<svg.*<\/svg>$/s);
      }
      expect(JSON.stringify(layout)).toBe(before);
      expect(layout.diagnostics).toContainEqual(
        expect.objectContaining({
          message: expect.stringContaining('Unknown port "odd"'),
        }),
      );
    },
  );

  it('emits category metadata and accurate filtered accessible counts', () => {
    const layout = resolve(parse(source), index);
    const svg = toSvg(layout, {
      connectionSelection: { categories: ['power'] },
    });
    expect(connectionTags(svg)).toHaveLength(3);
    for (const c of connectionTags(svg))
      expect(c.tag).toContain('data-category="power"');
    expect(svg).toContain(
      'Selected 3 of 9 documented connections; excluded 6. 1 of 9 documented connections unclassified; classification does not verify cabling completeness.',
    );
    const empty = toSvg(layout, { connectionSelection: { categories: [] } });
    expect(empty).toContain('0 connections. Selected 0 of 9');
    expect(connectionTags(empty)).toHaveLength(0);
    expect(groups(empty, 'external')).toHaveLength(0);
    expect(groups(empty, 'device').length).toBeGreaterThanOrEqual(4);
    expect(
      toSvg(resolve(parse('')), { connectionSelection: { categories: [] } }),
    ).toContain('No racks');
  });

  it('normalises equivalent selections and separates different automatic namespaces', () => {
    const layout = resolve(parse(source), index);
    const power = toSvg(layout, {
      connectionSelection: { categories: ['power', 'power'] },
    });
    expect(power).toBe(
      toSvg(layout, {
        connectionSelection: {
          connectionIds: selectConnections(layout, { categories: ['power'] })
            .map((c) => c.id)
            .reverse(),
        },
      }),
    );
    const network = toSvg(layout, {
      connectionSelection: { categories: ['network'] },
    });
    const ids = (svg: string) =>
      [...svg.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
    expect(ids(power).some((id) => ids(network).includes(id))).toBe(false);
    expect(toSvg(layout, { connectionSelection: {} })).toBe(toSvg(layout));
    expect(
      toSvg(layout, {
        connectionSelection: {
          connectionIds: layout.connections.map((c) => c.id).reverse(),
        },
      }),
    ).toBe(toSvg(layout));
    expect(
      toSvg(layout, {
        namespace: 'host-power',
        connectionSelection: { categories: ['power'] },
      }),
    ).toContain('id="rackdown-host-power-root"');
  });

  it('keeps generic no-catalogue diagrams valid, with no-match category views', () => {
    const layout = resolve(parse(source));
    expect(layout.connections.every((c) => c.category === 'unclassified')).toBe(
      true,
    );
    expect(
      connectionTags(
        toSvg(layout, { connectionSelection: { categories: ['power'] } }),
      ),
    ).toEqual([]);
    expect(
      connectionTags(
        toSvg(layout, {
          connectionSelection: { categories: ['unclassified'] },
        }),
      ),
    ).toHaveLength(layout.connections.length);
  });
});
