import { describe, expect, it } from 'vitest';
import type { PointMm } from './layout.js';
import {
  localRouteIsClear,
  type RoutingConnection,
  type RoutingEndpoint,
  type RoutingObstacle,
  type RoutingRack,
  routeConnections,
  type SlotBounds,
} from './routing.js';

const rack: RoutingRack = {
  key: 'rack:front',
  xMm: 0,
  yMm: 0,
  widthMm: 100,
  heightMm: 500,
};
const rear: RoutingRack = { ...rack, key: 'rack:rear', xMm: 125 };
const slot = (
  leftX: number,
  rightX: number,
  topY: number,
  bottomY: number,
): SlotBounds => ({ leftX, rightX, topY, bottomY });
const upper = slot(0, 100, 20, 40);
const lower = slot(0, 100, 80, 100);
function endpoint(bounds: SlotBounds, rackKey = rack.key): RoutingEndpoint {
  return {
    rackKey,
    anchor: { xMm: bounds.rightX, yMm: (bounds.topY + bounds.bottomY) / 2 },
    slotBounds: bounds,
  };
}
function connection(id: string, from = lower, to = upper): RoutingConnection {
  return { id, from: endpoint(from), to: endpoint(to) };
}
function obstacle(
  xMm: number,
  yMm: number,
  widthMm: number,
  heightMm: number,
  rackKey = rack.key,
): RoutingObstacle {
  return { rackKey, xMm, yMm, widthMm, heightMm };
}
function body(bounds: SlotBounds, rackKey = rack.key): RoutingObstacle {
  return obstacle(
    bounds.leftX,
    bounds.topY,
    bounds.rightX - bounds.leftX,
    bounds.bottomY - bounds.topY,
    rackKey,
  );
}
function withoutBounds(connections: RoutingConnection[]): RoutingConnection[] {
  // Missing slot metadata deliberately exercises the preserved side fallback,
  // with the same raw anchors and incident totals as the candidate under test.
  return connections.map((c) => ({
    id: c.id,
    from: { anchor: c.from.anchor, rackKey: c.from.rackKey },
    to: { anchor: c.to.anchor, rackKey: c.to.rackKey },
  }));
}
function points(route: PointMm[] | undefined): number[][] {
  return (route ?? []).map((point) => [point.xMm, point.yMm]);
}
interface Case {
  name: string;
  connections: RoutingConnection[];
  obstacles?: RoutingObstacle[];
  local: Record<string, number[][]>;
}
const straight = (x: number, bottom = 80, top = 40): number[][] => [
  [x, bottom],
  [x, top],
];
const staggered = [obstacle(46, 44, 5, 4), obstacle(49, 70, 5, 4)];
const cases: Case[] = [
  {
    name: 'half-width lower to full-width upper',
    connections: [connection('a', slot(0, 50, 80, 100))],
    local: { a: straight(25) },
  },
  {
    name: 'two shared-row Mini PCs to one switch',
    connections: [
      connection('left', slot(0, 50, 80, 100)),
      connection('right', slot(50, 100, 80, 100)),
    ],
    local: { left: straight(25), right: straight(75) },
  },
  {
    name: 'one lower device to two above',
    connections: [
      connection('left', lower, slot(0, 50, 20, 40)),
      connection('right', lower, slot(50, 100, 20, 40)),
    ],
    local: { left: straight(25), right: straight(75) },
  },
  {
    name: 'aligned equal-width devices',
    connections: [connection('a')],
    local: { a: straight(50) },
  },
  {
    name: 'partial horizontal overlap',
    connections: [connection('a', slot(30, 90, 80, 100), slot(0, 60, 20, 40))],
    local: { a: straight(45) },
  },
  {
    name: 'no horizontal overlap',
    connections: [connection('a', slot(60, 100, 80, 100), slot(0, 40, 20, 40))],
    local: {},
  },
  {
    name: 'touching horizontal boundaries',
    connections: [connection('a', slot(50, 100, 80, 100), slot(0, 50, 20, 40))],
    local: {},
  },
  {
    name: 'intermediate full-width blocker',
    connections: [connection('a')],
    obstacles: [obstacle(0, 50, 100, 10)],
    local: {},
  },
  {
    name: 'quarter-U blocker',
    connections: [connection('a')],
    obstacles: [obstacle(40, 55, 20, 11.1125)],
    local: {},
  },
  {
    name: 'blocked centre uses left fan before doglegs',
    connections: [connection('a')],
    obstacles: [obstacle(49.5, 50, 1, 5)],
    local: { a: straight(47.5) },
  },
  {
    name: 'a fixed Z clears staggered blockers',
    connections: [connection('a')],
    obstacles: staggered,
    local: {
      a: [
        [47.5, 80],
        [47.5, 60],
        [52.5, 60],
        [52.5, 40],
      ],
    },
  },
  {
    name: 'rounded elbow obstruction rejects clear logical legs',
    connections: [connection('a')],
    obstacles: [...staggered, obstacle(51.7, 59.2, 0.3, 0.3)],
    local: {},
  },
  {
    name: 'three local routes and bounded fourth fallback',
    connections: Array.from({ length: 4 }, (_, i) => connection(`p${i}`)),
    local: { p0: straight(50), p1: straight(47.5), p2: straight(52.5) },
  },
  {
    name: 'distinct port anchors share physical fan capacity',
    connections: Array.from({ length: 4 }, (_, i) => ({
      ...connection(`p${i}`),
      from: { ...endpoint(lower), anchor: { xMm: 100, yMm: 85 + i } },
    })),
    local: { p0: straight(50), p1: straight(47.5), p2: straight(52.5) },
  },
  {
    name: 'narrow overlap does not clamp or compress fan positions',
    connections: [
      connection('a', slot(49, 51, 80, 100)),
      connection('b', slot(49, 51, 80, 100)),
    ],
    local: { a: straight(50) },
  },
  {
    name: 'rack-top devices',
    connections: [connection('a', slot(0, 100, 60, 80), slot(0, 100, 0, 20))],
    local: { a: straight(50, 60, 20) },
  },
  {
    name: 'rack-bottom devices',
    connections: [
      connection('a', slot(0, 100, 480, 500), slot(0, 100, 420, 440)),
    ],
    local: { a: straight(50, 480, 440) },
  },
  {
    name: 'long spans retain their consuming perimeter strategy',
    connections: [connection('a', slot(0, 100, 200, 220))],
    local: {},
  },
  {
    name: 'zero facing-edge gap',
    connections: [connection('a', slot(0, 100, 40, 60))],
    local: {},
  },
  {
    name: 'overlapping vertical intervals',
    connections: [connection('a', slot(0, 100, 30, 50))],
    local: {},
  },
  {
    name: 'front/rear separation',
    connections: [
      {
        id: 'a',
        from: endpoint(lower),
        to: endpoint(slot(125, 225, 20, 40), rear.key),
      },
    ],
    local: {},
  },
  {
    name: 'another projection cannot block a local route',
    connections: [connection('a')],
    obstacles: [obstacle(0, 50, 100, 10, rear.key)],
    local: { a: straight(50) },
  },
];

describe('bounded local vertical presentation', () => {
  it.each(cases)('$name', ({ connections, obstacles = [], local }) => {
    const racks = [rack, rear];
    const bodies = connections
      .flatMap((c) => [c.from, c.to])
      .flatMap((ep) =>
        ep.slotBounds ? [body(ep.slotBounds, ep.rackKey)] : [],
      );
    const allObstacles = [...bodies, ...obstacles];
    const before = JSON.stringify(connections);
    const routes = routeConnections(
      connections,
      racks,
      'perimeter',
      allObstacles,
    );
    const fallback = routeConnections(
      withoutBounds(connections),
      racks,
      'perimeter',
      allObstacles,
    );
    for (const c of connections) {
      const route = routes.get(c.id);
      if (local[c.id]) {
        expect(points(route)).toEqual(local[c.id]);
        expect(
          localRouteIsClear(
            c.from.rackKey as string,
            route ?? [],
            allObstacles,
          ),
        ).toBe(true);
        expect(
          route?.every(
            (p) => p.xMm >= 0 && p.xMm <= 100 && p.yMm >= 0 && p.yMm <= 500,
          ),
        ).toBe(true);
      } else expect(route).toEqual(fallback.get(c.id));
    }
    expect(JSON.stringify(connections)).toBe(before);
    expect(
      routeConnections(connections, racks, 'perimeter', allObstacles),
    ).toEqual(routes);
    const reversed = routeConnections(
      connections.map((c) => ({ ...c, from: c.to, to: c.from })),
      racks,
      'perimeter',
      allObstacles,
    );
    for (const c of connections)
      expect(reversed.get(c.id)).toEqual(
        [...(routes.get(c.id) ?? [])].reverse(),
      );
    for (const mode of ['direct', 'orthogonal', 'lanes'] as const) {
      expect(routeConnections(connections, racks, mode, allObstacles)).toEqual(
        routeConnections(withoutBounds(connections), racks, mode, allObstacles),
      );
    }
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -1,
  ])('rejects invalid slot width %s', (width) => {
    const c = connection('a', { ...lower, rightX: width });
    expect(routeConnections([c], [rack], 'perimeter')).toEqual(
      routeConnections(withoutBounds([c]), [rack], 'perimeter'),
    );
  });

  it.each([88.9, 88.9001])(
    'retains the exact old short-hop threshold (%s)',
    (delta) => {
      const c = connection(
        'a',
        slot(0, 100, delta, delta + 20),
        slot(0, 100, 0, 20),
      );
      const route = routeConnections([c], [rack], 'perimeter').get('a');
      if (delta === 88.9)
        expect(points(route)).toEqual(straight(50, delta, 20));
      else
        expect(route).toEqual(
          routeConnections(withoutBounds([c]), [rack], 'perimeter').get('a'),
        );
    },
  );

  it('ties follow source order while distinct mean-Y geometry stays ordered', () => {
    const fan = Array.from({ length: 4 }, (_, i) => connection(`p${i}`));
    for (const ordered of [fan, [...fan].reverse()]) {
      const routes = routeConnections(ordered, [rack], 'perimeter');
      expect(
        ordered.slice(0, 3).map((c) => routes.get(c.id)?.[0]?.xMm),
      ).toEqual([50, 47.5, 52.5]);
    }
    const differentMean = fan.map((c, i) => ({
      ...c,
      from: { ...c.from, anchor: { xMm: 100, yMm: 85 + i } },
    }));
    const first = routeConnections(differentMean, [rack], 'perimeter');
    const shuffled = routeConnections(
      [...differentMean].reverse(),
      [rack],
      'perimeter',
    );
    for (const c of differentMean)
      expect(first.get(c.id)).toEqual(shuffled.get(c.id));
  });

  it('rejected candidates consume no local state', () => {
    const failed = connection('failed', lower, slot(0, 100, 0, 20));
    const later = connection(
      'later',
      slot(0, 100, 150, 170),
      slot(0, 100, 90, 110),
    );
    const obstacles = [obstacle(0, 30, 100, 10)];
    expect(
      routeConnections([failed, later], [rack], 'perimeter', obstacles).get(
        'later',
      ),
    ).toEqual(
      routeConnections([later], [rack], 'perimeter', obstacles).get('later'),
    );
  });

  it.each([false, true])(
    'keeps downstream lane and shared endpoint fan allocation unchanged (blocked=%s)',
    (blocked) => {
      const local = connection('local');
      const early: RoutingConnection = {
        id: 'early',
        from: { rackKey: rack.key, anchor: { xMm: 100, yMm: 0 } },
        to: { rackKey: rack.key, anchor: { xMm: 100, yMm: 100 } },
      };
      const later: RoutingConnection = {
        id: 'later',
        from: endpoint(lower),
        to: { rackKey: rack.key, anchor: { xMm: 100, yMm: 400 } },
      };
      const cs = [early, local, later];
      const obstacles = blocked ? [obstacle(0, 50, 100, 10)] : [];
      const routes = routeConnections(cs, [rack], 'perimeter', obstacles);
      const fallback = routeConnections(
        withoutBounds(cs),
        [rack],
        'perimeter',
        obstacles,
      );
      for (const c of [early, later])
        expect(routes.get(c.id)).toEqual(fallback.get(c.id));
      if (!blocked)
        expect(routes.get('local')).not.toEqual(fallback.get('local'));
    },
  );

  it('checks endpoint interiors even when the caller omits endpoint obstacles', () => {
    const c = connection('a');
    const route = routeConnections([c], [rack], 'perimeter').get('a') ?? [];
    expect(points(route)).toEqual(straight(50));
    const endpoints = [body(upper), body(lower)];
    expect(localRouteIsClear(rack.key, route, endpoints)).toBe(true);
    expect(
      localRouteIsClear(
        rack.key,
        [
          { xMm: 50, yMm: 30 },
          { xMm: 50, yMm: 90 },
        ],
        endpoints,
      ),
    ).toBe(false);
  });
});
