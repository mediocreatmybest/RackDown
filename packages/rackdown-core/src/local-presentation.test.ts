import { describe, expect, it } from 'vitest';
import {
  isClassHEligible,
  localRouteIsClear,
  type RoutingConnection,
  type RoutingEndpoint,
  type RoutingObstacle,
  type RoutingRack,
  routeConnections,
} from './routing.js';

const rack: RoutingRack = {
  key: 'rack:front',
  xMm: 0,
  yMm: 0,
  widthMm: 200,
  heightMm: 200,
};
function endpoint(
  leftX: number,
  width = 25,
  topY = 80,
  key = rack.key,
): RoutingEndpoint {
  return {
    rackKey: key,
    anchor: { xMm: leftX + width, yMm: topY + 10 },
    slotBounds: { leftX, rightX: leftX + width, topY, bottomY: topY + 20 },
  };
}
function connection(
  id: string,
  from = endpoint(0),
  to = endpoint(50),
): RoutingConnection {
  return { id, from, to };
}
function repeat(count: number, from = endpoint(0), to = endpoint(50)) {
  return Array.from({ length: count }, (_, i) => connection(`c${i}`, from, to));
}

describe('C3 presentation allocation', () => {
  it('pins six locals, fan order, tracks, bottom overflow and exhausted fallback', () => {
    const routes = [
      ...routeConnections(repeat(8), [rack], 'perimeter').values(),
    ];
    for (let i = 0; i < 6; i++) {
      const offset = [0, -2.5, 2.5][i % 3] as number;
      const boundary = i < 3 ? 80 : 100;
      const seam = boundary + (i < 3 ? -1 : 1) * (6 + (i % 3) * 4);
      expect(routes[i]).toEqual([
        { xMm: 12.5 + offset, yMm: boundary },
        { xMm: 12.5 + offset, yMm: seam },
        { xMm: 62.5 + offset, yMm: seam },
        { xMm: 62.5 + offset, yMm: boundary },
      ]);
    }
    expect(
      routes
        .slice(6)
        .every((route) => route.some((p) => p.xMm > 200 || p.xMm < 0)),
    ).toBe(true);
  });

  it.each([1, 2.5, 4.999, 5, 10, 25])(
    'does not clamp or compress a %s mm slot',
    (width) => {
      const from = endpoint(0, width);
      const to = endpoint(50, width);
      const routes = [
        ...routeConnections(repeat(8, from, to), [rack], 'perimeter').values(),
      ];
      const local = routes.filter((route) =>
        route.every((p) => p.xMm >= 0 && p.xMm <= 200),
      );
      expect(local).toHaveLength(width < 5 ? 2 : 6);
      for (const route of local) {
        expect([width / 2, width / 2 - 2.5, width / 2 + 2.5]).toContain(
          route[0]?.xMm,
        );
        expect(route[0]?.xMm).toBeGreaterThanOrEqual(0);
        expect(route[0]?.xMm).toBeLessThanOrEqual(width);
      }
    },
  );

  it('shares slot capacity across distinct raw ports and reversed endpoints', () => {
    const connections = repeat(8).map((c, i) => {
      const from = { ...c.from, anchor: { xMm: 25, yMm: 81 + i } };
      return i % 2 ? { ...c, from: c.to, to: from } : { ...c, from };
    });
    const forward = routeConnections(connections, [rack], 'perimeter');
    const reverse = routeConnections(
      connections.map((c) => ({ ...c, from: c.to, to: c.from })),
      [rack],
      'perimeter',
    );
    expect(
      [...forward.values()].filter((route) => route.every((p) => p.xMm <= 200)),
    ).toHaveLength(6);
    for (const c of connections.slice(0, 6))
      expect(forward.get(c.id)).toEqual(
        [...(reverse.get(c.id) ?? [])].reverse(),
      );
  });

  it('allows interval reuse exactly at 2.5 mm separation', () => {
    for (const gap of [2.499, 2.5, 2.501]) {
      const connections = [
        connection('a', endpoint(0, 1), endpoint(10, 1)),
        connection('b', endpoint(10 + gap, 1), endpoint(20 + gap, 1)),
      ];
      const routes = routeConnections(connections, [rack], 'perimeter');
      expect(routes.get('b')?.[1]?.yMm).toBe(gap < 2.5 ? 70 : 74);
    }
  });

  it('rejects a blocked preview without consuming attachment or seam capacity', () => {
    // Only the leftmost device cannot leave upwards. The next pair can still
    // use their centres on top track zero, including the shared middle device.
    const obstacle: RoutingObstacle = {
      rackKey: rack.key,
      xMm: 0,
      yMm: 76,
      widthMm: 25,
      heightMm: 4,
    };
    const connections = [
      connection('ab'),
      connection('bc', endpoint(50), endpoint(100)),
    ];
    const routes = routeConnections(connections, [rack], 'perimeter', [
      obstacle,
    ]);
    expect(routes.get('ab')?.[0]?.yMm).toBe(100);
    expect(routes.get('bc')).toEqual([
      { xMm: 62.5, yMm: 80 },
      { xMm: 62.5, yMm: 74 },
      { xMm: 112.5, yMm: 74 },
      { xMm: 112.5, yMm: 80 },
    ]);
    for (const route of routes.values())
      expect(localRouteIsClear(rack.key, route, [obstacle])).toBe(true);
  });

  it('shares approximately equal rows and slots and attaches at each actual boundary', () => {
    const first = connection(
      'a',
      endpoint(0, 25, 80),
      endpoint(50, 25, 80.0008),
    );
    const second = connection(
      'b',
      endpoint(0, 25, 80.0007),
      endpoint(50, 25, 80.0001),
    );
    const routes = routeConnections([first, second], [rack], 'perimeter');
    expect(routes.get('a')).toEqual([
      { xMm: 12.5, yMm: 80 },
      { xMm: 12.5, yMm: 74 },
      { xMm: 62.5, yMm: 74 },
      { xMm: 62.5, yMm: 80.0008 },
    ]);
    expect(routes.get('b')?.[0]?.xMm).toBe(10);
    expect(routes.get('b')?.[1]?.yMm).toBeCloseTo(70.0001, 8);
  });

  it('does not let a wholly rejected row seed approximate seam identity', () => {
    const blocked = connection('blocked');
    const accepted = connection(
      'accepted',
      endpoint(100, 25, 80.0008),
      endpoint(150, 25, 80.0008),
    );
    const next = connection(
      'next',
      endpoint(100, 25, 80.0015),
      endpoint(150, 25, 80.0015),
    );
    const obstacles = [
      { rackKey: rack.key, xMm: 0, yMm: 70, widthMm: 75, heightMm: 10 },
      { rackKey: rack.key, xMm: 0, yMm: 100, widthMm: 75, heightMm: 10 },
    ];
    const routes = routeConnections(
      [blocked, accepted, next],
      [rack],
      'perimeter',
      obstacles,
    );
    expect(
      routes.get('blocked')?.some((point) => point.xMm < 0 || point.xMm > 200),
    ).toBe(true);
    expect(routes.get('accepted')?.[1]?.yMm).toBeCloseTo(74.0008, 8);
    expect(routes.get('next')?.[1]?.yMm).toBeCloseTo(70.0015, 8);
  });

  it('keeps rear siblings eligible and front/rear ineligible', () => {
    const rear = { ...rack, key: 'rack:rear' };
    const c = connection(
      'rear',
      endpoint(0, 25, 80, rear.key),
      endpoint(50, 25, 80, rear.key),
    );
    expect(routeConnections([c], [rear], 'perimeter').get(c.id)?.[0]).toEqual({
      xMm: 12.5,
      yMm: 80,
    });
    expect(isClassHEligible(endpoint(0), c.to)).toBe(false);
  });

  it('places an unequal bottom seam beyond the larger caller boundary', () => {
    const c = connection(
      'bottom',
      endpoint(0, 25, 80),
      endpoint(50, 25, 80.0008),
    );
    const obstacle: RoutingObstacle = {
      rackKey: rack.key,
      xMm: 0,
      yMm: 70,
      widthMm: 200,
      heightMm: 10,
    };
    const route = routeConnections([c], [rack], 'perimeter', [obstacle]).get(
      'bottom',
    );
    expect(route?.[0]).toEqual({ xMm: 12.5, yMm: 100 });
    expect(route?.[1]?.yMm).toBeCloseTo(106.0008, 8);
    expect(route?.at(-1)?.yMm).toBeCloseTo(100.0008, 8);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'requires finite positive slot dimensions (%s)',
    (width) => {
      expect(isClassHEligible(endpoint(0, width), endpoint(50))).toBe(false);
      const from = endpoint(0);
      if (!from.slotBounds) throw new Error('missing bounds');
      from.slotBounds.bottomY = from.slotBounds.topY + width;
      expect(isClassHEligible(from, endpoint(50))).toBe(false);
    },
  );
});
