import { describe, expect, it } from 'vitest';
import type { PointMm } from './layout.js';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';
import {
  type RoutingConnection,
  type RoutingRack,
  routeConnections,
  type SlotBounds,
} from './routing.js';

function links(count: number, target = 'target'): string[] {
  return Array.from(
    { length: count },
    (_, index) => `core:p${index + 1} -- ${target}:p${index + 1}`,
  );
}

function render(source: string) {
  const layout = resolve(parse(source));
  const original = JSON.stringify(layout);
  const options = {
    namespace: 'attachment-fanout',
    connectionRouting: 'perimeter' as const,
  };
  const svg = toSvg(layout, options);
  expect(JSON.stringify(layout)).toBe(original);
  expect(toSvg(layout, options)).toBe(svg);
  const endpoints = new Map<string, [PointMm, PointMm]>();
  for (const match of svg.matchAll(
    /<path [^>]*data-connection-id="([^"]+)"[^>]*d="([^"]+)"/g,
  )) {
    const [, id, d] = match;
    const start = d?.match(/^M ([-\d.]+),([-\d.]+)/);
    const end = d?.match(/ L ([-\d.]+),([-\d.]+)$/);
    if (!id || !start || !end) throw new Error('Expected routed endpoints');
    endpoints.set(id, [
      { xMm: Number(start[1]), yMm: Number(start[2]) },
      { xMm: Number(end[1]), yMm: Number(end[2]) },
    ]);
  }
  expect(endpoints.size).toBe(layout.connections.length);
  return { layout, endpoints };
}

function expectSpan(ys: number[], top: number, bottom: number) {
  const ordered = [...ys].sort((a, b) => a - b);
  expect(ordered[0]).toBeCloseTo(top, 3);
  expect(ordered.at(-1)).toBeCloseTo(bottom, 3);
  for (const y of ordered) {
    // The SVG serializer rounds coordinates to 0.001 mm.
    expect(y).toBeGreaterThanOrEqual(top - 0.001);
    expect(y).toBeLessThanOrEqual(bottom + 0.001);
  }
}

describe('bounded perimeter attachment fan-out', () => {
  const rack: RoutingRack = {
    key: 'front',
    xMm: 0,
    yMm: 0,
    widthMm: 482.6,
    heightMm: 533.4,
  };
  const slot: SlotBounds = {
    leftX: 0,
    rightX: 482.6,
    topY: 0,
    bottomY: 44.45,
  };

  function connections(count: number, bounds: SlotBounds | undefined = slot) {
    return Array.from(
      { length: count },
      (_, index): RoutingConnection => ({
        id: `fan-${index}`,
        from: {
          rackKey: rack.key,
          anchor: { xMm: 482.6, yMm: 22.225 },
          slotBounds: bounds,
        },
        to: { rackKey: rack.key, anchor: { xMm: 482.6, yMm: 466.725 } },
      }),
    );
  }

  function ysFor(inputs: RoutingConnection[]) {
    const routes = routeConnections(inputs, [rack], 'perimeter');
    expect(routes.size).toBe(inputs.length);
    return [...routes.values()].map((route) => {
      const point = route[0];
      if (!point) throw new Error('Expected an attachment');
      return point.yMm;
    });
  }

  it('bounds the exact 24-connection public-source reproduction', () => {
    const { layout, endpoints } = render(
      [
        'rack "Fan-out probe" 12U',
        '12 switch "Core" as core',
        '2 server "Target" as target',
        ...links(24),
      ].join('\n'),
    );
    expect(layout.diagnostics).toEqual([]);
    expect(layout.connections).toHaveLength(24);
    const core = layout.devices.find((device) => device.alias === 'core');
    expect(core?.yMm).toBe(0);
    expect(core?.heightMm).toBe(44.45);
    const ys = [...endpoints.values()].map(([from]) => from.yMm);
    // Previously these extremes were -6.525 and 50.975 mm.
    expectSpan(ys, 0, 44.45);
    for (let index = 1; index < ys.length; index += 1) {
      // Two independently rounded endpoints can differ by up to 0.001 mm.
      expect(
        Math.abs((ys[index] ?? 0) - (ys[index - 1] ?? 0) - 44.45 / 23),
      ).toBeLessThanOrEqual(0.001);
    }
    expectSpan(
      [...endpoints.values()].map(([, to]) => to.yMm),
      444.5,
      488.95,
    );
  });

  it('preserves the entire nominal 18-occurrence route and compresses at 19', () => {
    const ordinary = connections(18);
    const unbounded = ordinary.map((c) => ({
      ...c,
      from: { ...c.from, slotBounds: undefined },
    }));
    expect(routeConnections(ordinary, [rack], 'perimeter')).toEqual(
      routeConnections(unbounded, [rack], 'perimeter'),
    );
    expect(ysFor(ordinary)).toEqual(
      Array.from({ length: 18 }, (_, index) => 22.225 + (index - 8.5) * 2.5),
    );
    const dense = ysFor(connections(19));
    expectSpan(dense, 0, 44.45);
    expect((dense[1] ?? 0) - (dense[0] ?? 0)).toBeCloseTo(44.45 / 18, 10);
  });

  it.each([
    [0.5, 8, 2.5],
    [0.5, 24, 22.225 / 23],
    [2, 24, 2.5],
    [2, 48, 88.9 / 47],
  ])('uses %sU bounds with %s occurrences', (height, count, spacing) => {
    const { layout, endpoints } = render(
      [
        'rack "Sized" 12U u1 top',
        `1 ${height}U switch "Core" as core`,
        `10 ${height}U server "Target" as target`,
        ...links(count),
      ].join('\n'),
    );
    expect(layout.diagnostics).toEqual([]);
    const ys = [...endpoints.values()].map(([from]) => from.yMm);
    const halfSpan = ((count - 1) * spacing) / 2;
    expectSpan(
      ys,
      (height * 44.45) / 2 - halfSpan,
      (height * 44.45) / 2 + halfSpan,
    );
    expect((ys[1] ?? 0) - (ys[0] ?? 0)).toBeCloseTo(spacing, 3);
  });

  it.each([
    ['top', 1, 10, 0],
    ['top', 12, 2, 488.95],
    ['bottom', 12, 2, 0],
    ['bottom', 1, 10, 488.95],
  ] as const)(
    'bounds rear endpoints with U1 %s at position %s',
    (u1, position, target, top) => {
      const { layout, endpoints } = render(
        [
          `rack "Rear" 12U u1 ${u1} views front rear`,
          `rear ${position} switch "Core" as core`,
          `rear ${target} server "Target" as target`,
          ...links(24),
        ].join('\n'),
      );
      expect(layout.diagnostics).toEqual([]);
      expectSpan(
        [...endpoints.values()].map(([from]) => from.yMm),
        top,
        top + 44.45,
      );
      // The rear is the second projection; attachment X must remain projected.
      for (const [from] of endpoints.values())
        expect([508, 990.6]).toContain(from.xMm);
    },
  );

  it('counts local occurrences without moving their raw shared-row anchors', () => {
    const { layout, endpoints } = render(
      [
        'rack "Shared and local" 12U',
        '10 switch "Core" as core',
        '10 device "Sibling" as sibling',
        '2 server "Target" as target',
        ...links(8, 'sibling'),
        ...links(16),
      ].join('\n'),
    );
    expect(layout.diagnostics).toEqual([]);
    const all = [...endpoints.values()];
    for (const [from, to] of all.slice(0, 8)) {
      expect(from).toEqual({ xMm: 241.3, yMm: 111.125 });
      expect(to).toEqual({ xMm: 482.6, yMm: 111.125 });
    }
    // Local routes occupy indices 0..7 in the same 24-occurrence group.
    const perimeter = all.slice(8).map(([from]) => from.yMm);
    expect(perimeter[0]).toBeCloseTo(88.9 + 8 * (44.45 / 23), 3);
    expect(perimeter.at(-1)).toBeCloseTo(133.35, 3);
    expect(layout.connections).toHaveLength(24);
  });

  it('counts both endpoints of each self-connection', () => {
    const { layout, endpoints } = render(
      [
        'rack "Self" 12U',
        '12 switch "Core" as core',
        ...links(12, 'core'),
      ].join('\n'),
    );
    expect(layout.connections).toHaveLength(12);
    const ys = [...endpoints.values()].flatMap((pair) =>
      pair.map((p) => p.yMm),
    );
    expect(ys).toHaveLength(24);
    expectSpan(ys, 0, 44.45);
    expect(ys[1]).toBeCloseTo(44.45 / 23, 3);
  });

  it.each([
    ['missing', undefined],
    ['non-finite top', { ...slot, topY: Number.NaN }],
    ['non-finite bottom', { ...slot, bottomY: Number.POSITIVE_INFINITY }],
    ['zero height', { ...slot, bottomY: 0 }],
    ['reversed', { ...slot, topY: 44.45, bottomY: 0 }],
  ] as const)(
    'preserves old attachment results with %s bounds',
    (_, bounds) => {
      // Explicitly remove bounds: the helper's default is a valid slot.
      const inputs = connections(24).map((c) => ({
        ...c,
        from: { ...c.from, slotBounds: bounds },
      }));
      expect(ysFor(inputs)).toEqual(
        Array.from({ length: 24 }, (_, index) => 22.225 + (index - 11.5) * 2.5),
      );
    },
  );

  it('retains a single anchor even when it is outside valid bounds', () => {
    expect(ysFor(connections(1, { ...slot, topY: 30, bottomY: 40 }))).toEqual([
      22.225,
    ]);
  });

  it.each([
    [19.725, 24.725],
    [19.725, 30],
    [10, 24.725],
  ])('keeps nominal output on the boundary of [%s, %s]', (topY, bottomY) => {
    expect(ysFor(connections(3, { ...slot, topY, bottomY }))).toEqual([
      19.725, 22.225, 24.725,
    ]);
  });

  it.each([
    [20, 30, [22.5, 25, 27.5]],
    [10, 24, [14.5, 17, 19.5]],
  ] as const)(
    'recentres an off-centre fan overflowing [%s, %s]',
    (topY, bottomY, expected) => {
      // The span permits nominal spacing; one extreme still overflows the slot.
      expect(ysFor(connections(3, { ...slot, topY, bottomY }))).toEqual(
        expected,
      );
    },
  );

  it.each(['direct', 'orthogonal', 'lanes'] as const)(
    'leaves dense %s routes unchanged',
    (mode) => {
      const inputs = connections(48);
      const noBounds = inputs.map((c) => ({
        ...c,
        from: { ...c.from, slotBounds: undefined },
      }));
      expect(routeConnections(inputs, [rack], mode)).toEqual(
        routeConnections(noBounds, [rack], mode),
      );
    },
  );
});
