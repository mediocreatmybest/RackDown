import { describe, expect, it } from 'vitest';
import { parse } from './parser.js';
import { roundedRoutePath, toSvg } from './renderer.js';
import { resolve } from './resolver.js';
import {
  anchorIsOnVerticalBoundary,
  CORRIDOR_LANE_CAPACITY,
  consumeLane,
  isClassHEligible,
  LOCAL_SEAM_OFFSET_MM,
  localRouteIsClear,
  NORMAL_ROUTING_ENVELOPE_MM,
  peekLane,
  type RoutingConnection,
  type RoutingCorridor,
  type RoutingObstacle,
  type RoutingRack,
  routeConnections,
  SHORT_HOP_THRESHOLD_MM,
  type SlotBounds,
} from './routing.js';

function everySegmentIsOrthogonal(
  points: readonly { xMm: number; yMm: number }[],
): boolean {
  return points.slice(1).every((point, index) => {
    const previous = points[index];
    return (
      previous !== undefined &&
      (previous.xMm === point.xMm || previous.yMm === point.yMm)
    );
  });
}

/**
 * The route for `id`, asserted present and narrowed for the caller.
 *
 * Keeps the assertion and the narrowing in one place so tests can index into a
 * route without a non-null assertion at every use.
 */
function expectRoute(
  routes: Map<string, { xMm: number; yMm: number }[]>,
  id: string,
): { xMm: number; yMm: number }[] {
  const route = routes.get(id);
  expect(route).toBeDefined();
  if (route === undefined) {
    throw new Error(`expected a route for "${id}"`);
  }
  return route;
}

/**
 * Every point of a local route lies inside or on the boundary of its own rack.
 *
 * The rack rectangle is convex and local routes are axis-aligned, so checking
 * the vertices covers the whole polyline.
 */
function routeStaysWithinRack(
  points: readonly { xMm: number; yMm: number }[],
  rack: RoutingRack,
): boolean {
  const epsilon = 0.01;
  return points.every(
    (point) =>
      point.xMm >= rack.xMm - epsilon &&
      point.xMm <= rack.xMm + rack.widthMm + epsilon &&
      point.yMm >= rack.yMm - epsilon &&
      point.yMm <= rack.yMm + rack.heightMm + epsilon,
  );
}

function rootId(svg: string): string {
  const match = svg.match(/<svg id="([^"]+)"/);
  if (!match?.[1]) {
    throw new Error('SVG is missing a root id');
  }
  return match[1];
}

function segmentsCross(
  [x1, y1]: [number, number],
  [x2, y2]: [number, number],
  [x3, y3]: [number, number],
  [x4, y4]: [number, number],
): boolean {
  const denominator = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(denominator) < 1e-9) {
    return false;
  }
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / denominator;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / denominator;
  return t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6;
}

function countCrossings(
  routes: readonly (readonly { xMm: number; yMm: number }[])[],
): number {
  let crossings = 0;
  for (let i = 0; i < routes.length; i += 1) {
    const routeA = routes[i];
    if (!routeA) continue;
    for (let j = i + 1; j < routes.length; j += 1) {
      const routeB = routes[j];
      if (!routeB) continue;
      for (let s1 = 0; s1 < routeA.length - 1; s1 += 1) {
        const a1 = routeA[s1];
        const a2 = routeA[s1 + 1];
        if (!a1 || !a2) continue;
        for (let s2 = 0; s2 < routeB.length - 1; s2 += 1) {
          const b1 = routeB[s2];
          const b2 = routeB[s2 + 1];
          if (!b1 || !b2) continue;
          if (
            segmentsCross(
              [a1.xMm, a1.yMm],
              [a2.xMm, a2.yMm],
              [b1.xMm, b1.yMm],
              [b2.xMm, b2.yMm],
            )
          ) {
            crossings += 1;
          }
        }
      }
    }
  }
  return crossings;
}

function routeLength(points: readonly { xMm: number; yMm: number }[]): number {
  let len = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a && b) {
      len += Math.hypot(b.xMm - a.xMm, b.yMm - a.yMm);
    }
  }
  return len;
}

function totalRouteLength(
  routes: Iterable<readonly { xMm: number; yMm: number }[]>,
): number {
  let total = 0;
  for (const route of routes) {
    total += routeLength(route);
  }
  return Math.round(total);
}

function bendCount(points: readonly { xMm: number; yMm: number }[]): number {
  let bends = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    if (prev && curr && next) {
      const cross =
        (curr.xMm - prev.xMm) * (next.yMm - curr.yMm) -
        (curr.yMm - prev.yMm) * (next.xMm - curr.xMm);
      if (Math.abs(cross) > 1e-6) {
        bends += 1;
      }
    }
  }
  return bends;
}

function totalBendCount(
  routes: Iterable<readonly { xMm: number; yMm: number }[]>,
): number {
  let total = 0;
  for (const route of routes) {
    total += bendCount(route);
  }
  return total;
}

function corridorLanesPerSide(
  routes: Iterable<readonly { xMm: number; yMm: number }[]>,
  rack: RoutingRack,
): { rightLanes: Set<number>; leftLanes: Set<number> } {
  const rightLanes = new Set<number>();
  const leftLanes = new Set<number>();
  for (const route of routes) {
    for (let i = 0; i < route.length - 1; i += 1) {
      const p1 = route[i];
      const p2 = route[i + 1];
      if (p1 && p2 && Math.abs(p1.xMm - p2.xMm) < 1e-6) {
        const x = Number(p1.xMm.toFixed(2));
        if (x >= rack.xMm + rack.widthMm + 12.6) {
          rightLanes.add(x);
        } else if (x <= rack.xMm - 12.6) {
          leftLanes.add(x);
        }
      }
    }
  }
  return { rightLanes, leftLanes };
}

function maxPhysicalLanesPerSide(
  routes: Iterable<readonly { xMm: number; yMm: number }[]>,
  rack: RoutingRack,
): number {
  const { rightLanes, leftLanes } = corridorLanesPerSide(routes, rack);
  return Math.max(rightLanes.size, leftLanes.size);
}

function maxPhysicalGutterMm(
  routes: Iterable<readonly { xMm: number; yMm: number }[]>,
  rack: RoutingRack,
): number {
  const { rightLanes, leftLanes } = corridorLanesPerSide(routes, rack);
  const rightGutter =
    rightLanes.size > 0
      ? Math.max(...rightLanes) - (rack.xMm + rack.widthMm)
      : 0;
  const leftGutter = leftLanes.size > 0 ? rack.xMm - Math.min(...leftLanes) : 0;
  return Number(Math.max(rightGutter, leftGutter).toFixed(1));
}

describe('normal routing envelope', () => {
  // Pins the derived value so a change to CORRIDOR_LANE_CAPACITY,
  // LANE_SPACING_MM, PERIMETER_GUTTER_MM or TOP_DECORATION_CLEARANCE_MM cannot
  // silently move the renderer's reserved viewport floor.
  it('derives the capped corridor reach from the routing constants', () => {
    expect(NORMAL_ROUTING_ENVELOPE_MM).toEqual({
      topMm: 40.2,
      rightMm: 32.7,
      bottomMm: 32.7,
      leftMm: 32.7,
    });
  });

  it('reserves the top decoration clearance above the side reach', () => {
    expect(NORMAL_ROUTING_ENVELOPE_MM.leftMm).toBe(
      NORMAL_ROUTING_ENVELOPE_MM.rightMm,
    );
    expect(NORMAL_ROUTING_ENVELOPE_MM.bottomMm).toBe(
      NORMAL_ROUTING_ENVELOPE_MM.rightMm,
    );
    expect(NORMAL_ROUTING_ENVELOPE_MM.topMm).toBeGreaterThan(
      NORMAL_ROUTING_ENVELOPE_MM.bottomMm,
    );
  });

  it('bounds the furthest lane a capped corridor can allocate', () => {
    const corridor: RoutingCorridor = {
      id: 'rack:test:left',
      axis: 'x',
      capacity: CORRIDOR_LANE_CAPACITY,
      allocations: 0,
      coordinate: (laneIndex: number) => -12.7 - laneIndex * 4,
    };

    let furthest = 0;
    for (let index = 0; index < CORRIDOR_LANE_CAPACITY * 5; index += 1) {
      const preview = peekLane(corridor);
      furthest = Math.max(furthest, Math.abs(preview.coordinateMm));
      consumeLane(preview);
    }

    expect(furthest).toBeCloseTo(NORMAL_ROUTING_ENVELOPE_MM.leftMm, 6);
  });
});

describe('connection routing', () => {
  const racks: RoutingRack[] = [
    { key: 'rack:front', xMm: 0, yMm: 0, widthMm: 100, heightMm: 200 },
    { key: 'rack:rear', xMm: 125, yMm: 0, widthMm: 100, heightMm: 200 },
  ];

  const sameRack: RoutingConnection = {
    id: 'same-rack',
    from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
    to: { anchor: { xMm: 100, yMm: 100 }, rackKey: 'rack:front' },
  };
  const crossRack: RoutingConnection = {
    id: 'cross-rack',
    from: { anchor: { xMm: 100, yMm: 30 }, rackKey: 'rack:front' },
    to: { anchor: { xMm: 225, yMm: 120 }, rackKey: 'rack:rear' },
  };
  const external: RoutingConnection = {
    id: 'external',
    from: { anchor: { xMm: 100, yMm: 40 }, rackKey: 'rack:front' },
    to: { anchor: { xMm: 50, yMm: 250 } },
  };

  it('preserves direct endpoint-to-endpoint routing as the baseline', () => {
    const routes = routeConnections([crossRack], racks, 'direct');

    expect(routes.get('cross-rack')).toEqual([
      { xMm: 100, yMm: 30 },
      { xMm: 225, yMm: 120 },
    ]);
  });

  it('produces deterministic orthogonal bends', () => {
    const first = routeConnections([crossRack], racks, 'orthogonal');
    const second = routeConnections([crossRack], racks, 'orthogonal');
    const route = first.get('cross-rack');

    expect(first).toEqual(second);
    expect(route).toHaveLength(4);
    expect(route && everySegmentIsOrthogonal(route)).toBe(true);
  });

  it('uses successive right-side lanes for same-rack connections', () => {
    const secondSameRack: RoutingConnection = {
      id: 'same-rack-2',
      from: { anchor: { xMm: 100, yMm: 50 }, rackKey: 'rack:front' },
      to: { anchor: { xMm: 100, yMm: 150 }, rackKey: 'rack:front' },
    };
    const routes = routeConnections([sameRack, secondSameRack], racks, 'lanes');

    expect(routes.get('same-rack')).toEqual([
      { xMm: 100, yMm: 20 },
      { xMm: 106.35, yMm: 20 },
      { xMm: 106.35, yMm: 100 },
      { xMm: 100, yMm: 100 },
    ]);
    expect(routes.get('same-rack-2')).toContainEqual({ xMm: 110.35, yMm: 50 });
  });

  it('routes cross-rack and external connections through bottom lanes', () => {
    const routes = routeConnections([crossRack, external], racks, 'lanes');
    const crossRoute = routes.get('cross-rack');
    const externalRoute = routes.get('external');

    expect(crossRoute).toContainEqual({ xMm: 100, yMm: 206.35 });
    expect(crossRoute).toContainEqual({ xMm: 225, yMm: 206.35 });
    expect(externalRoute).toContainEqual({ xMm: 100, yMm: 210.35 });
    expect(externalRoute).toContainEqual({ xMm: 50, yMm: 210.35 });
    expect(crossRoute && everySegmentIsOrthogonal(crossRoute)).toBe(true);
    expect(externalRoute && everySegmentIsOrthogonal(externalRoute)).toBe(true);
  });

  it('fans shared visual endpoints and scores same-rack perimeter sides', () => {
    const first: RoutingConnection = {
      id: 'first',
      from: { anchor: { xMm: 100, yMm: 50 }, rackKey: 'rack:front' },
      to: { anchor: { xMm: 100, yMm: 140 }, rackKey: 'rack:front' },
    };
    const second: RoutingConnection = {
      id: 'second',
      from: { anchor: { xMm: 100, yMm: 50 }, rackKey: 'rack:front' },
      to: { anchor: { xMm: 100, yMm: 150 }, rackKey: 'rack:front' },
    };

    const routes = routeConnections([first, second], racks, 'perimeter');
    const firstRoute = routes.get('first');
    const secondRoute = routes.get('second');

    expect(firstRoute?.[0]).toEqual({ xMm: 100, yMm: 48.75 });
    expect(secondRoute?.[0]).toEqual({ xMm: 0, yMm: 51.25 });
    expect(firstRoute).toContainEqual({ xMm: 112.7, yMm: 48.75 });
    expect(secondRoute).toContainEqual({ xMm: -12.7, yMm: 51.25 });
    expect(firstRoute && everySegmentIsOrthogonal(firstRoute)).toBe(true);
    expect(secondRoute && everySegmentIsOrthogonal(secondRoute)).toBe(true);
  });

  it('uses the gap between adjacent rack views for perimeter routing', () => {
    const routes = routeConnections([crossRack], racks, 'perimeter');
    const route = routes.get('cross-rack');

    expect(route).toEqual([
      { xMm: 100, yMm: 30 },
      { xMm: 106.35, yMm: 30 },
      { xMm: 106.35, yMm: 75 },
      { xMm: 118.65, yMm: 75 },
      { xMm: 118.65, yMm: 120 },
      { xMm: 125, yMm: 120 },
    ]);
    expect(route && everySegmentIsOrthogonal(route)).toBe(true);
  });

  it('routes wrapped cross-rack connections around endpoint rack bodies', () => {
    const wrappedRacks: RoutingRack[] = [
      {
        key: 'primary:front',
        xMm: 0,
        yMm: 0,
        widthMm: 100,
        heightMm: 200,
      },
      {
        key: 'primary:rear',
        xMm: 125,
        yMm: 0,
        widthMm: 100,
        heightMm: 200,
      },
      {
        key: 'garage:front',
        xMm: 0,
        yMm: 240,
        widthMm: 100,
        heightMm: 100,
      },
    ];
    const wrappedCrossRack: RoutingConnection = {
      id: 'wrapped-cross-rack',
      from: {
        anchor: { xMm: 100, yMm: 30 },
        rackKey: 'primary:front',
      },
      to: {
        anchor: { xMm: 100, yMm: 280 },
        rackKey: 'garage:front',
      },
    };

    const routes = routeConnections(
      [wrappedCrossRack],
      wrappedRacks,
      'perimeter',
    );
    const route = routes.get('wrapped-cross-rack');

    expect(route).toEqual([
      { xMm: 100, yMm: 30 },
      { xMm: 106.35, yMm: 30 },
      { xMm: 106.35, yMm: -20.2 },
      { xMm: -6.35, yMm: -20.2 },
      { xMm: -6.35, yMm: 280 },
      { xMm: 0, yMm: 280 },
    ]);
    expect(route && everySegmentIsOrthogonal(route)).toBe(true);
  });

  it('keeps bottom externals below the rack subject', () => {
    const routes = routeConnections([external], racks, 'perimeter');
    const route = routes.get('external');

    expect(route).toEqual([
      { xMm: 100, yMm: 40 },
      { xMm: 106.35, yMm: 40 },
      { xMm: 106.35, yMm: 212.7 },
      { xMm: 50, yMm: 212.7 },
      { xMm: 50, yMm: 250 },
    ]);
    expect(route && everySegmentIsOrthogonal(route)).toBe(true);
  });

  it('takes the shorter top perimeter clear of rack titles when a rack blocks a right external', () => {
    const rightExternal: RoutingConnection = {
      id: 'right-external-blocked',
      from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
      to: { anchor: { xMm: 250, yMm: 20 } },
    };

    const routes = routeConnections([rightExternal], racks, 'perimeter');
    const route = routes.get('right-external-blocked');

    expect(route).toEqual([
      { xMm: 100, yMm: 20 },
      { xMm: 106.35, yMm: 20 },
      { xMm: 106.35, yMm: -20.2 },
      { xMm: 250, yMm: -20.2 },
      { xMm: 250, yMm: 20 },
    ]);
    expect(route && everySegmentIsOrthogonal(route)).toBe(true);
  });

  it('uses a short side route when a right external has a clear corridor', () => {
    const rightExternal: RoutingConnection = {
      id: 'right-external-clear',
      from: { anchor: { xMm: 225, yMm: 120 }, rackKey: 'rack:rear' },
      to: { anchor: { xMm: 250, yMm: 120 } },
    };

    const routes = routeConnections([rightExternal], racks, 'perimeter');

    expect(routes.get('right-external-clear')).toEqual([
      { xMm: 225, yMm: 120 },
      { xMm: 231.35, yMm: 120 },
      { xMm: 250, yMm: 120 },
    ]);
  });

  it('keeps direct rendering as the default and exposes routing as renderer data', () => {
    const layout = resolve(
      parse(
        `rack "Rack" 4U views front rear\n4 switch "Front" as front\nrear 2 pdu "Rear" as rear\nfront:1 -- rear:1 power`,
      ),
    );

    const defaultSvg = toSvg(layout);
    const directSvg = toSvg(layout, { connectionRouting: 'direct' });
    const orthogonalSvg = toSvg(layout, { connectionRouting: 'orthogonal' });
    const laneSvg = toSvg(layout, { connectionRouting: 'lanes' });
    const perimeterSvg = toSvg(layout, { connectionRouting: 'perimeter' });

    expect(defaultSvg).toContain('data-connection-routing="direct"');
    expect(defaultSvg).toContain('<line ');
    expect(defaultSvg).not.toContain('<path ');
    expect(directSvg).toBe(defaultSvg);

    expect(orthogonalSvg).toContain('data-connection-routing="orthogonal"');
    expect(orthogonalSvg).toContain('data-routing="orthogonal"');
    expect(orthogonalSvg).toContain('<path ');
    expect(orthogonalSvg).not.toContain('<polyline ');

    expect(laneSvg).toContain('data-connection-routing="lanes"');
    expect(laneSvg).toContain('data-routing="lanes"');
    expect(laneSvg).toContain('<path ');
    expect(laneSvg).not.toContain('<polyline ');

    expect(perimeterSvg).toContain('data-connection-routing="perimeter"');
    expect(perimeterSvg).toContain('data-routing="perimeter"');
    expect(perimeterSvg).toContain('<path ');
    expect(perimeterSvg).not.toContain('<polyline ');

    expect(rootId(defaultSvg)).not.toBe(rootId(orthogonalSvg));
    expect(rootId(orthogonalSvg)).not.toBe(rootId(laneSvg));
    expect(rootId(laneSvg)).not.toBe(rootId(perimeterSvg));
    expect(orthogonalSvg).toBe(
      toSvg(layout, { connectionRouting: 'orthogonal' }),
    );
    expect(laneSvg).toBe(toSvg(layout, { connectionRouting: 'lanes' }));
    expect(perimeterSvg).toBe(
      toSvg(layout, { connectionRouting: 'perimeter' }),
    );
  });

  it('reduces crossings in dense fan-out by allocating perimeter routes by geometry (R4)', () => {
    const denseRack: RoutingRack = {
      key: 'dense',
      xMm: 0,
      yMm: 0,
      widthMm: 100,
      heightMm: 1000,
    };
    const denseConnectionsReverse: RoutingConnection[] = Array.from(
      { length: 20 },
      (_, index) => {
        const i = 19 - index;
        return {
          id: `c-${i}`,
          from: { anchor: { xMm: 100, yMm: 50 }, rackKey: 'dense' },
          to: { anchor: { xMm: 100, yMm: 100 + i * 44.45 }, rackKey: 'dense' },
        };
      },
    );

    const routes = routeConnections(
      denseConnectionsReverse,
      [denseRack],
      'perimeter',
    );
    const crossings = countCrossings(Array.from(routes.values()));
    expect(crossings).toBe(74);
  });

  it('produces identical perimeter route geometry regardless of authoring order for distinct geometry', () => {
    const denseRack: RoutingRack = {
      key: 'dense',
      xMm: 0,
      yMm: 0,
      widthMm: 100,
      heightMm: 1000,
    };
    const forwardConnections: RoutingConnection[] = Array.from(
      { length: 20 },
      (_, i) => ({
        id: `c-${i}`,
        from: { anchor: { xMm: 100, yMm: 50 }, rackKey: 'dense' },
        to: { anchor: { xMm: 100, yMm: 100 + i * 44.45 }, rackKey: 'dense' },
      }),
    );
    const reverseConnections: RoutingConnection[] = Array.from(
      { length: 20 },
      (_, index) => {
        const i = 19 - index;
        return {
          id: `c-${i}`,
          from: { anchor: { xMm: 100, yMm: 50 }, rackKey: 'dense' },
          to: { anchor: { xMm: 100, yMm: 100 + i * 44.45 }, rackKey: 'dense' },
        };
      },
    );

    const forwardRoutes = routeConnections(
      forwardConnections,
      [denseRack],
      'perimeter',
    );
    const reverseRoutes = routeConnections(
      reverseConnections,
      [denseRack],
      'perimeter',
    );

    for (let i = 0; i < 20; i += 1) {
      const id = `c-${i}`;
      expect(reverseRoutes.get(id)).toEqual(forwardRoutes.get(id));
    }
  });

  it('uses original source order as deterministic tie-break when mean endpoint Y is equal', () => {
    const connA: RoutingConnection = {
      id: 'conn-a',
      from: { anchor: { xMm: 100, yMm: 40 }, rackKey: 'rack:front' },
      to: { anchor: { xMm: 100, yMm: 160 }, rackKey: 'rack:front' },
    };
    const connB: RoutingConnection = {
      id: 'conn-b',
      from: { anchor: { xMm: 100, yMm: 50 }, rackKey: 'rack:front' },
      to: { anchor: { xMm: 100, yMm: 150 }, rackKey: 'rack:front' },
    };

    // Both connections have mean endpoint Y = (40 + 160) / 2 = (50 + 150) / 2 = 100.
    const orderAB = routeConnections([connA, connB], racks, 'perimeter');
    const orderBA = routeConnections([connB, connA], racks, 'perimeter');

    // In orderAB, connA is first in source order, so it gets the first right-side lane (x=112.7)
    // and connB takes the alternate left-side lane (x=-12.7).
    expect(orderAB.get('conn-a')).toContainEqual({ xMm: 112.7, yMm: 40 });
    expect(orderAB.get('conn-b')).toContainEqual({ xMm: -12.7, yMm: 50 });

    // In orderBA, connB is first in source order, so connB gets the first right-side lane (x=112.7)
    // and connA takes the alternate left-side lane (x=-12.7).
    expect(orderBA.get('conn-b')).toContainEqual({ xMm: 112.7, yMm: 50 });
    expect(orderBA.get('conn-a')).toContainEqual({ xMm: -12.7, yMm: 40 });

    // Confirms tie-break differs deterministically by source order:
    expect(orderAB.get('conn-a')).not.toEqual(orderBA.get('conn-a'));
    expect(orderAB.get('conn-b')).not.toEqual(orderBA.get('conn-b'));
  });

  describe('explicit routing corridors (R2)', () => {
    it('peekLane does not mutate corridor allocations and exposes index, coordinate, and pressure', () => {
      const corridor: RoutingCorridor = {
        id: 'rack:front:right',
        axis: 'x',
        capacity: undefined,
        allocations: 0,
        coordinate(laneIndex: number) {
          return 100 + 12.7 + laneIndex * 4;
        },
      };

      const first = peekLane(corridor);
      expect(first.corridor).toBe(corridor);
      expect(first.index).toBe(0);
      expect(first.coordinateMm).toBe(112.7);
      expect(first.pressure).toBe(0);
      expect(corridor.allocations).toBe(0);

      const second = peekLane(corridor);
      expect(second.index).toBe(0);
      expect(second.coordinateMm).toBe(112.7);
      expect(corridor.allocations).toBe(0);
    });

    it('consumeLane advances corridor allocations exactly once', () => {
      const corridor: RoutingCorridor = {
        id: 'rack:front:right',
        axis: 'x',
        capacity: undefined,
        allocations: 0,
        coordinate(laneIndex: number) {
          return 100 + 12.7 + laneIndex * 4;
        },
      };

      const first = peekLane(corridor);
      expect(consumeLane(first)).toBe(0);
      expect(corridor.allocations).toBe(1);

      const second = peekLane(corridor);
      expect(second.index).toBe(1);
      expect(second.coordinateMm).toBe(116.7);
      expect(second.pressure).toBe(1);

      expect(consumeLane(second)).toBe(1);
      expect(corridor.allocations).toBe(2);
    });

    it('wraps physical lane index at capacity 6 while pressure continues tracking total allocations', () => {
      const corridor: RoutingCorridor = {
        id: 'rack:front:right',
        axis: 'x',
        capacity: CORRIDOR_LANE_CAPACITY,
        allocations: 0,
        coordinate(laneIndex: number) {
          return 100 + 12.7 + laneIndex * 4;
        },
      };

      const expectedIndices = [0, 1, 2, 3, 4, 5, 0, 1];
      const expectedPressures = [0, 1, 2, 3, 4, 5, 6, 7];

      for (let cycle = 0; cycle < 8; cycle += 1) {
        const preview = peekLane(corridor);
        expect(preview.index).toBe(expectedIndices[cycle]);
        expect(preview.pressure).toBe(expectedPressures[cycle]);
        expect(preview.coordinateMm).toBe(
          100 + 12.7 + (expectedIndices[cycle] ?? 0) * 4,
        );
        expect(consumeLane(preview)).toBe(expectedIndices[cycle]);
        expect(corridor.allocations).toBe(cycle + 1);
      }
    });

    it('does not wrap physical lane index when capacity is undefined', () => {
      const corridor: RoutingCorridor = {
        id: 'gap:pair',
        axis: 'y',
        capacity: undefined,
        allocations: 0,
        coordinate(laneIndex: number) {
          return 100 + laneIndex * 4;
        },
      };

      const expectedIndices = [0, 1, 2, 3, 4, 5, 6, 7];
      for (let cycle = 0; cycle < 8; cycle += 1) {
        const preview = peekLane(corridor);
        expect(preview.index).toBe(expectedIndices[cycle]);
        expect(preview.pressure).toBe(cycle);
        expect(preview.coordinateMm).toBe(100 + cycle * 4);
        expect(consumeLane(preview)).toBe(cycle);
        expect(corridor.allocations).toBe(cycle + 1);
      }
    });

    it('1. selects right rack-side corridor for a single same-rack route on exact tie', () => {
      const conn: RoutingConnection = {
        id: 'c1',
        from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 120 }, rackKey: 'rack:front' },
      };
      const routes = routeConnections([conn], racks, 'perimeter');
      const route = routes.get('c1');
      expect(route).toContainEqual({ xMm: 112.7, yMm: 20 });
      expect(route).toContainEqual({ xMm: 112.7, yMm: 120 });
    });

    it('2 & 3. allocates successive same-rack rack-side lanes and chooses left when right has pressure', () => {
      const conn1: RoutingConnection = {
        id: 'c1',
        from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 120 }, rackKey: 'rack:front' },
      };
      const conn2: RoutingConnection = {
        id: 'c2',
        from: { anchor: { xMm: 100, yMm: 30 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 130 }, rackKey: 'rack:front' },
      };
      const conn3: RoutingConnection = {
        id: 'c3',
        from: { anchor: { xMm: 100, yMm: 40 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 140 }, rackKey: 'rack:front' },
      };

      const routes = routeConnections(
        [conn1, conn2, conn3],
        racks,
        'perimeter',
      );
      expect(routes.get('c1')).toContainEqual({ xMm: 112.7, yMm: 20 });
      expect(routes.get('c2')).toContainEqual({ xMm: -12.7, yMm: 30 });
      expect(routes.get('c3')).toContainEqual({ xMm: 116.7, yMm: 40 });
    });

    it('4. allocates global top corridor when a right external route is blocked near the top', () => {
      const conn: RoutingConnection = {
        id: 'top-conn',
        from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 250, yMm: 20 } },
      };
      const routes = routeConnections([conn], racks, 'perimeter');
      expect(routes.get('top-conn')).toContainEqual({
        xMm: 106.35,
        yMm: -20.2,
      });
      expect(routes.get('top-conn')).toContainEqual({ xMm: 250, yMm: -20.2 });
    });

    it('5. allocates global bottom corridor when a right external route is blocked near the bottom', () => {
      const conn: RoutingConnection = {
        id: 'bottom-conn',
        from: { anchor: { xMm: 100, yMm: 180 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 250, yMm: 180 } },
      };
      const routes = routeConnections([conn], racks, 'perimeter');
      expect(routes.get('bottom-conn')).toContainEqual({
        xMm: 106.35,
        yMm: 212.7,
      });
      expect(routes.get('bottom-conn')).toContainEqual({
        xMm: 250,
        yMm: 212.7,
      });
    });

    it('6. preserves top-before-bottom tie behaviour on exact score tie', () => {
      const tieConn: RoutingConnection = {
        id: 'tie-conn',
        from: { anchor: { xMm: 100, yMm: 96.25 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 250, yMm: 96.25 } },
      };
      const routes = routeConnections([tieConn], racks, 'perimeter');
      expect(routes.get('tie-conn')).toContainEqual({
        xMm: 106.35,
        yMm: -20.2,
      });
    });

    it('7 & 8. routes multiple cross-rack connections through shared gap corridor with offsets 0, +4, -4', () => {
      const conn1: RoutingConnection = {
        id: 'g1',
        from: { anchor: { xMm: 100, yMm: 50 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 125, yMm: 50 }, rackKey: 'rack:rear' },
      };
      const conn2: RoutingConnection = {
        id: 'g2',
        from: { anchor: { xMm: 100, yMm: 60 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 125, yMm: 40 }, rackKey: 'rack:rear' },
      };
      const conn3: RoutingConnection = {
        id: 'g3',
        from: { anchor: { xMm: 100, yMm: 40 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 125, yMm: 60 }, rackKey: 'rack:rear' },
      };

      const routes = routeConnections(
        [conn1, conn2, conn3],
        racks,
        'perimeter',
      );
      expect(routes.get('g1')).toContainEqual({ xMm: 106.35, yMm: 50 });
      expect(routes.get('g2')).toContainEqual({ xMm: 106.35, yMm: 54 });
      expect(routes.get('g3')).toContainEqual({ xMm: 106.35, yMm: 46 });
    });

    it('9 & 10. falls back to global corridor when pair gap is blocked and advances attempt ordinal', () => {
      const blockingRacks: RoutingRack[] = [
        ...racks,
        { key: 'rack:middle', xMm: 105, yMm: 0, widthMm: 15, heightMm: 200 },
      ];
      const conn: RoutingConnection = {
        id: 'blocked-gap',
        from: { anchor: { xMm: 100, yMm: 30 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 125, yMm: 30 }, rackKey: 'rack:rear' },
      };
      const routes = routeConnections([conn], blockingRacks, 'perimeter');
      expect(routes.get('blocked-gap')).toContainEqual({
        xMm: 106.35,
        yMm: -20.2,
      });
    });

    it('11. preserves blocked-then-clear later route at Y = 194 mm (frozen gap attempt ordinal semantics)', () => {
      const rackA: RoutingRack = {
        key: 'rack:a',
        xMm: 0,
        yMm: 0,
        widthMm: 100,
        heightMm: 300,
      };
      const rackB: RoutingRack = {
        key: 'rack:b',
        xMm: 150,
        yMm: 0,
        widthMm: 100,
        heightMm: 300,
      };
      const rackObs: RoutingRack = {
        key: 'rack:obs',
        xMm: 110,
        yMm: 185,
        widthMm: 30,
        heightMm: 7,
      };

      const connBlocked: RoutingConnection = {
        id: 'blocked-route',
        from: { anchor: { xMm: 100, yMm: 180 }, rackKey: 'rack:a' },
        to: { anchor: { xMm: 150, yMm: 200 }, rackKey: 'rack:b' },
      };
      const connClear: RoutingConnection = {
        id: 'clear-route',
        from: { anchor: { xMm: 100, yMm: 185 }, rackKey: 'rack:a' },
        to: { anchor: { xMm: 150, yMm: 195 }, rackKey: 'rack:b' },
      };

      const routes = routeConnections(
        [connBlocked, connClear],
        [rackA, rackB, rackObs],
        'perimeter',
      );
      const clearRoute = routes.get('clear-route');

      expect(clearRoute).toContainEqual({ xMm: 106.35, yMm: 194 });
      expect(clearRoute).toContainEqual({ xMm: 143.65, yMm: 194 });
      expect(clearRoute?.some((p) => p.yMm === 190)).toBe(false);
    });

    it('12 & 14. rack-side rejected candidate does not advance and winning corridor advances exactly once', () => {
      const conn1: RoutingConnection = {
        id: 'c1',
        from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 120 }, rackKey: 'rack:front' },
      };
      const conn2: RoutingConnection = {
        id: 'c2',
        from: { anchor: { xMm: 100, yMm: 30 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 130 }, rackKey: 'rack:front' },
      };
      const conn3: RoutingConnection = {
        id: 'c3',
        from: { anchor: { xMm: 100, yMm: 40 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 140 }, rackKey: 'rack:front' },
      };

      const routes = routeConnections(
        [conn1, conn2, conn3],
        racks,
        'perimeter',
      );
      expect(routes.get('c1')).toContainEqual({ xMm: 112.7, yMm: 20 });
      expect(routes.get('c2')).toContainEqual({ xMm: -12.7, yMm: 30 });
      expect(routes.get('c3')).toContainEqual({ xMm: 116.7, yMm: 40 });
    });

    it('13 & 14. global rejected candidate does not advance and winning global corridor advances exactly once', () => {
      const conn1: RoutingConnection = {
        id: 'c1',
        from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 250, yMm: 20 } },
      };
      const conn2: RoutingConnection = {
        id: 'c2',
        from: { anchor: { xMm: 100, yMm: 180 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 250, yMm: 180 } },
      };
      const conn3: RoutingConnection = {
        id: 'c3',
        from: { anchor: { xMm: 100, yMm: 25 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 250, yMm: 25 } },
      };

      const routes = routeConnections(
        [conn1, conn2, conn3],
        racks,
        'perimeter',
      );
      expect(routes.get('c1')).toContainEqual({ xMm: 250, yMm: -20.2 });
      expect(routes.get('c2')).toContainEqual({ xMm: 250, yMm: 212.7 });
      expect(routes.get('c3')).toContainEqual({ xMm: 250, yMm: -24.2 });
    });

    it('15. clear right external route consumes no corridor', () => {
      const connClear: RoutingConnection = {
        id: 'c-clear',
        from: { anchor: { xMm: 225, yMm: 120 }, rackKey: 'rack:rear' },
        to: { anchor: { xMm: 250, yMm: 120 } },
      };
      const connSameRack: RoutingConnection = {
        id: 'c-same',
        from: { anchor: { xMm: 225, yMm: 50 }, rackKey: 'rack:rear' },
        to: { anchor: { xMm: 225, yMm: 150 }, rackKey: 'rack:rear' },
      };

      const routes = routeConnections(
        [connClear, connSameRack],
        racks,
        'perimeter',
      );
      expect(routes.get('c-clear')).toEqual([
        { xMm: 225, yMm: 120 },
        { xMm: 231.35, yMm: 120 },
        { xMm: 250, yMm: 120 },
      ]);
      expect(routes.get('c-same')).toContainEqual({ xMm: 237.7, yMm: 50 });
    });

    it('16. clear left external route consumes no corridor', () => {
      const connClear: RoutingConnection = {
        id: 'c-clear-left',
        from: { anchor: { xMm: 0, yMm: 120 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: -50, yMm: 120 } },
      };
      const conn1: RoutingConnection = {
        id: 'c1',
        from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 120 }, rackKey: 'rack:front' },
      };
      const conn2: RoutingConnection = {
        id: 'c2',
        from: { anchor: { xMm: 100, yMm: 30 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 130 }, rackKey: 'rack:front' },
      };

      const routes = routeConnections(
        [connClear, conn1, conn2],
        racks,
        'perimeter',
      );
      expect(routes.get('c-clear-left')).toEqual([
        { xMm: 0, yMm: 120 },
        { xMm: -6.35, yMm: 120 },
        { xMm: -50, yMm: 120 },
      ]);
      expect(routes.get('c2')).toContainEqual({ xMm: -12.7, yMm: 30 });
    });

    it('17 & 18. allocates global top and bottom corridors for top and bottom external routes', () => {
      const connTop: RoutingConnection = {
        id: 'c-top',
        from: { anchor: { xMm: 100, yMm: 40 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 50, yMm: -50 } },
      };
      const connBottom: RoutingConnection = {
        id: 'c-bottom',
        from: { anchor: { xMm: 100, yMm: 160 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 50, yMm: 250 } },
      };

      const routes = routeConnections(
        [connTop, connBottom],
        racks,
        'perimeter',
      );
      expect(routes.get('c-top')).toContainEqual({ xMm: 50, yMm: -20.2 });
      expect(routes.get('c-bottom')).toContainEqual({ xMm: 50, yMm: 212.7 });
    });

    it('19. preserves endpoint order when reversing external -> device route', () => {
      const deviceToExt: RoutingConnection = {
        id: 'dev-to-ext',
        from: { anchor: { xMm: 100, yMm: 40 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 50, yMm: 250 } },
      };
      const extToDev: RoutingConnection = {
        id: 'ext-to-dev',
        from: { anchor: { xMm: 50, yMm: 250 } },
        to: { anchor: { xMm: 100, yMm: 40 }, rackKey: 'rack:front' },
      };

      const fwdRoutes = routeConnections([deviceToExt], racks, 'perimeter');
      const revRoutes = routeConnections([extToDev], racks, 'perimeter');
      const fwd = fwdRoutes.get('dev-to-ext');
      const rev = revRoutes.get('ext-to-dev');

      expect(fwd?.[0]).toEqual({ xMm: 100, yMm: 40 });
      expect(fwd?.at(-1)).toEqual({ xMm: 50, yMm: 250 });
      expect(rev?.[0]).toEqual({ xMm: 50, yMm: 250 });
      expect(rev?.at(-1)).toEqual({ xMm: 100, yMm: 40 });
      expect(rev).toEqual([...(fwd ?? [])].reverse());
    });

    it('20. R4 geometry ordering remains deterministic regardless of input connection order', () => {
      const c1: RoutingConnection = {
        id: 'c1',
        from: { anchor: { xMm: 100, yMm: 30 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 70 }, rackKey: 'rack:front' },
      };
      const c2: RoutingConnection = {
        id: 'c2',
        from: { anchor: { xMm: 100, yMm: 120 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 180 }, rackKey: 'rack:front' },
      };

      const fwd = routeConnections([c1, c2], racks, 'perimeter');
      const rev = routeConnections([c2, c1], racks, 'perimeter');

      expect(fwd.get('c1')).toEqual(rev.get('c1'));
      expect(fwd.get('c2')).toEqual(rev.get('c2'));
    });

    it('21. bounds perimeter gutter growth to six physical lanes and 32.7 mm in dense fan-out', () => {
      const denseRack: RoutingRack = {
        key: 'dense',
        xMm: 0,
        yMm: 0,
        widthMm: 100,
        heightMm: 1000,
      };
      const denseConnections: RoutingConnection[] = Array.from(
        { length: 20 },
        (_, index) => {
          const i = 19 - index;
          return {
            id: `c-${i}`,
            from: { anchor: { xMm: 100, yMm: 50 }, rackKey: 'dense' },
            to: {
              anchor: { xMm: 100, yMm: 100 + i * 44.45 },
              rackKey: 'dense',
            },
          };
        },
      );

      const routes = routeConnections(
        denseConnections,
        [denseRack],
        'perimeter',
      );
      const routeList = Array.from(routes.values());

      expect(maxPhysicalLanesPerSide(routeList, denseRack)).toBe(6);
      expect(maxPhysicalGutterMm(routeList, denseRack)).toBe(32.7);
      expect(countCrossings(routeList)).toBe(74);
      expect(totalBendCount(routeList)).toBe(40);
      expect(totalRouteLength(routeList)).toBe(10253);

      const maxRightEnvelopeX = denseRack.xMm + denseRack.widthMm + 32.7;
      const minLeftEnvelopeX = denseRack.xMm - 32.7;
      for (const route of routeList) {
        for (const point of route) {
          expect(point.xMm).toBeLessThanOrEqual(maxRightEnvelopeX + 1e-6);
          expect(point.xMm).toBeGreaterThanOrEqual(minLeftEnvelopeX - 1e-6);
        }
      }
    });

    it('22. verifies gutter width bounds across 8, 12, 16, and 20 connection thresholds', () => {
      const denseRack: RoutingRack = {
        key: 'dense',
        xMm: 0,
        yMm: 0,
        widthMm: 100,
        heightMm: 1000,
      };

      const runDense = (n: number) => {
        const conns: RoutingConnection[] = Array.from(
          { length: n },
          (_, index) => {
            const i = n - 1 - index;
            return {
              id: `c-${i}`,
              from: { anchor: { xMm: 100, yMm: 50 }, rackKey: 'dense' },
              to: {
                anchor: { xMm: 100, yMm: 100 + i * 44.45 },
                rackKey: 'dense',
              },
            };
          },
        );
        const routes = routeConnections(conns, [denseRack], 'perimeter');
        return Array.from(routes.values());
      };

      // 8 connections: no reuse required beyond 4 lanes/side;
      // c-0 is a short-hop hugging the rack side.
      const routes8 = runDense(8);
      expect(maxPhysicalLanesPerSide(routes8, denseRack)).toBe(4);
      expect(maxPhysicalGutterMm(routes8, denseRack)).toBe(24.7);
      expect(countCrossings(routes8)).toBe(9);
      expect(totalBendCount(routes8)).toBe(16);
      expect(totalRouteLength(routes8)).toBe(1907);

      // 12 connections: physical lane count reaches the six-lane bound;
      // reuse may begin if allocations are uneven between sides.
      const routes12 = runDense(12);
      expect(maxPhysicalLanesPerSide(routes12, denseRack)).toBe(6);
      expect(maxPhysicalGutterMm(routes12, denseRack)).toBe(32.7);
      expect(countCrossings(routes12)).toBe(25);
      expect(totalBendCount(routes12)).toBe(24);
      expect(totalRouteLength(routes12)).toBe(4026);

      // 16 connections: still six lanes/side, reuse active
      const routes16 = runDense(16);
      expect(maxPhysicalLanesPerSide(routes16, denseRack)).toBe(6);
      expect(maxPhysicalGutterMm(routes16, denseRack)).toBe(32.7);
      expect(countCrossings(routes16)).toBe(48);
      expect(totalBendCount(routes16)).toBe(32);
      expect(totalRouteLength(routes16)).toBe(6792);

      // 20 connections: still six lanes/side
      const routes20 = runDense(20);
      expect(maxPhysicalLanesPerSide(routes20, denseRack)).toBe(6);
      expect(maxPhysicalGutterMm(routes20, denseRack)).toBe(32.7);
      expect(countCrossings(routes20)).toBe(74);
      expect(totalBendCount(routes20)).toBe(40);
      expect(totalRouteLength(routes20)).toBe(10253);
    });

    it('23. reuses physical lanes round-robin in global top corridor when allocations exceed capacity', () => {
      const topConns: RoutingConnection[] = Array.from(
        { length: 7 },
        (_, i) => ({
          id: `top-${i}`,
          from: {
            anchor: { xMm: 100, yMm: 20 + i * 2 },
            rackKey: 'rack:front',
          },
          to: { anchor: { xMm: 250, yMm: 20 + i * 2 } },
        }),
      );

      const routes = routeConnections(topConns, racks, 'perimeter');

      const expectedTopY = [
        -20.2, // lane 0
        -24.2, // lane 1
        -28.2, // lane 2
        -32.2, // lane 3
        -36.2, // lane 4
        -40.2, // lane 5
        -20.2, // lane 0 reused
      ];

      for (let i = 0; i < 7; i += 1) {
        const route = routes.get(`top-${i}`);
        expect(route).toBeDefined();
        const y = expectedTopY[i];
        expect(route).toContainEqual({ xMm: 106.35, yMm: y });
        expect(route).toContainEqual({ xMm: 250, yMm: y });
      }

      // Proves no seventh physical top lane (-44.2 mm) is created
      for (const route of routes.values()) {
        expect(route.some((p) => p.yMm === -44.2)).toBe(false);
      }
    });

    it('24. continues pair-gap ordinal beyond index 5 without wrapping to index 0', () => {
      const gapConns: RoutingConnection[] = Array.from(
        { length: 8 },
        (_, i) => ({
          id: `gap-${i}`,
          from: {
            anchor: { xMm: 100, yMm: 100 + i * 5 },
            rackKey: 'rack:front',
          },
          to: { anchor: { xMm: 125, yMm: 100 - i * 5 }, rackKey: 'rack:rear' },
        }),
      );

      const routes = routeConnections(gapConns, racks, 'perimeter');

      // Alternating sequence around baseY = 100:
      // 0: 100, 1: 104, 2: 96, 3: 108, 4: 92, 5: 112, 6: 88 (not 100), 7: 116 (not 104)
      const expectedY = [100, 104, 96, 108, 92, 112, 88, 116];

      for (let i = 0; i < 8; i += 1) {
        const route = routes.get(`gap-${i}`);
        expect(route).toBeDefined();
        const y = expectedY[i];
        expect(route).toContainEqual({ xMm: 106.35, yMm: y });
        expect(route).toContainEqual({ xMm: 118.65, yMm: y });
      }

      // gap-6 uses Y=88 and does not wrap to index 0 (Y=100)
      const route6 = routes.get('gap-6');
      expect(route6?.some((p) => p.yMm === 100)).toBe(false);

      // gap-7 uses Y=116 and does not wrap to index 1 (Y=104)
      const route7 = routes.get('gap-7');
      expect(route7?.some((p) => p.yMm === 104)).toBe(false);
    });
  });

  describe('Class V short-hop routing (R5)', () => {
    const singleRack: RoutingRack = {
      key: 'rack:front',
      xMm: 0,
      yMm: 0,
      widthMm: 100,
      heightMm: 500,
    };

    it('freezes SHORT_HOP_THRESHOLD_MM at 88.90 mm', () => {
      expect(SHORT_HOP_THRESHOLD_MM).toBe(88.9);
    });

    it('routes same-rack 1U-like short span shallow along exit-stub line and pins endpoints', () => {
      const conn: RoutingConnection = {
        id: 'c1',
        from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 64.45 }, rackKey: 'rack:front' },
      };
      const routes = routeConnections([conn], [singleRack], 'perimeter');
      const route = expectRoute(routes, 'c1');
      expect(route).toEqual([
        { xMm: 100, yMm: 20 },
        { xMm: 106.35, yMm: 20 },
        { xMm: 106.35, yMm: 64.45 },
        { xMm: 100, yMm: 64.45 },
      ]);
      // Both endpoints are full-width single connections here, so the
      // attachment projection happens to coincide with the raw anchor. That is
      // this fixture's geometry, not a general Class V invariant.
      expect(route[0]).toEqual(conn.from.anchor);
      expect(route.at(-1)).toEqual(conn.to.anchor);
    });

    it('routes connection with span exactly 88.90 mm as Class V short hop', () => {
      const conn: RoutingConnection = {
        id: 'c-exact',
        from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 108.9 }, rackKey: 'rack:front' },
      };
      const routes = routeConnections([conn], [singleRack], 'perimeter');
      const route = routes.get('c-exact');
      expect(route).toContainEqual({ xMm: 106.35, yMm: 20 });
      expect(route).toContainEqual({ xMm: 106.35, yMm: 108.9 });
      expect(route?.some((p) => p.xMm === 112.7)).toBe(false);
    });

    it('routes connection with span just over 88.90 mm via perimeter corridor', () => {
      const conn: RoutingConnection = {
        id: 'c-over',
        from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 108.95 }, rackKey: 'rack:front' },
      };
      const routes = routeConnections([conn], [singleRack], 'perimeter');
      const route = routes.get('c-over');
      expect(route).toContainEqual({ xMm: 112.7, yMm: 20 });
      expect(route).toContainEqual({ xMm: 112.7, yMm: 108.95 });
    });

    it('routes connection with zero vertical span via perimeter corridor', () => {
      const conn: RoutingConnection = {
        id: 'c-zero',
        from: { anchor: { xMm: 20, yMm: 50 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 80, yMm: 50 }, rackKey: 'rack:front' },
      };
      const routes = routeConnections([conn], [singleRack], 'perimeter');
      const route = routes.get('c-zero');
      expect(route).toContainEqual({ xMm: 112.7, yMm: 50 });
    });

    it('chooses right shallow candidate on exact tie', () => {
      const conn: RoutingConnection = {
        id: 'c-tie',
        from: { anchor: { xMm: 100, yMm: 30 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 60 }, rackKey: 'rack:front' },
      };
      const routes = routeConnections([conn], [singleRack], 'perimeter');
      const route = routes.get('c-tie');
      expect(route).toContainEqual({ xMm: 106.35, yMm: 30 });
      expect(route?.some((p) => p.xMm === -6.35)).toBe(false);
    });

    it('chooses left shallow candidate when right corridor has pressure without consuming left corridor', () => {
      // connLong is a perimeter connection that allocates the right corridor (pressure 1).
      // meanY = (10 + 120) / 2 = 65, deltaY = 110 > 88.90
      const connLong: RoutingConnection = {
        id: 'c-long',
        from: { anchor: { xMm: 100, yMm: 10 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 120 }, rackKey: 'rack:front' },
      };
      // connShort is a short hop with meanY = (180 + 220) / 2 = 200, deltaY = 40 <= 88.90.
      // It sorts after connLong, observes right pressure = 1, and chooses left shallow candidate.
      const connShort: RoutingConnection = {
        id: 'c-short',
        from: { anchor: { xMm: 100, yMm: 180 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 220 }, rackKey: 'rack:front' },
      };
      // connThird is another perimeter connection to test corridor allocations.
      // meanY = (250 + 400) / 2 = 325, deltaY = 150 > 88.90
      const connThird: RoutingConnection = {
        id: 'c-third',
        from: { anchor: { xMm: 100, yMm: 250 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 400 }, rackKey: 'rack:front' },
      };

      const routes = routeConnections(
        [connLong, connShort, connThird],
        [singleRack],
        'perimeter',
      );
      const rShort = routes.get('c-short');
      expect(rShort).toContainEqual({ xMm: -6.35, yMm: 180 });
      expect(rShort).toContainEqual({ xMm: -6.35, yMm: 220 });

      // Because connShort did NOT consume a left lane, connThird (the second perimeter connection)
      // takes the left corridor at index 0 (x = -12.7) rather than index 1 (x = -16.7).
      const rThird = routes.get('c-third');
      expect(rThird).toContainEqual({ xMm: -12.7, yMm: 250 });
    });

    it('produces identical visual route under endpoint reversal', () => {
      const fwdConn: RoutingConnection = {
        id: 'c1',
        from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 60 }, rackKey: 'rack:front' },
      };
      const revConn: RoutingConnection = {
        id: 'c1',
        from: { anchor: { xMm: 100, yMm: 60 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
      };

      const fwd = routeConnections([fwdConn], [singleRack], 'perimeter');
      const rev = routeConnections([revConn], [singleRack], 'perimeter');

      const fwdRoute = expectRoute(fwd, 'c1');
      const revRoute = expectRoute(rev, 'c1');

      expect(fwdRoute).toEqual([...revRoute].reverse());
    });

    it('routes multiple shallow routes without consuming perimeter corridors', () => {
      const conns: RoutingConnection[] = [
        {
          id: 'c1',
          from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
          to: { anchor: { xMm: 100, yMm: 50 }, rackKey: 'rack:front' },
        },
        {
          id: 'c2',
          from: { anchor: { xMm: 100, yMm: 60 }, rackKey: 'rack:front' },
          to: { anchor: { xMm: 100, yMm: 90 }, rackKey: 'rack:front' },
        },
        {
          id: 'c3',
          from: { anchor: { xMm: 100, yMm: 100 }, rackKey: 'rack:front' },
          to: { anchor: { xMm: 100, yMm: 130 }, rackKey: 'rack:front' },
        },
      ];

      const routes = routeConnections(conns, [singleRack], 'perimeter');
      for (const c of conns) {
        const r = routes.get(c.id);
        expect(r).toBeDefined();
        expect(r?.some((p) => p.xMm === 112.7 || p.xMm === -12.7)).toBe(false);
      }
    });

    it('leaves perimeter allocations unchanged after successful Class V routes', () => {
      const shortConn: RoutingConnection = {
        id: 'short',
        from: { anchor: { xMm: 100, yMm: 20 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 60 }, rackKey: 'rack:front' },
      };
      const longConn: RoutingConnection = {
        id: 'long',
        from: { anchor: { xMm: 100, yMm: 10 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 100, yMm: 200 }, rackKey: 'rack:front' },
      };

      const routes = routeConnections(
        [shortConn, longConn],
        [singleRack],
        'perimeter',
      );
      // longConn was routed after shortConn and must receive the first lane index 0 (x=112.7)
      expect(routes.get('long')).toContainEqual({ xMm: 112.7, yMm: 10 });
    });

    it('treats cross-rack connections with short vertical delta as ineligible for Class V', () => {
      const rackA: RoutingRack = {
        key: 'rack:a',
        xMm: 0,
        yMm: 0,
        widthMm: 100,
        heightMm: 500,
      };
      const rackB: RoutingRack = {
        key: 'rack:b',
        xMm: 125,
        yMm: 0,
        widthMm: 100,
        heightMm: 500,
      };
      const crossConn: RoutingConnection = {
        id: 'cross',
        from: { anchor: { xMm: 100, yMm: 30 }, rackKey: 'rack:a' },
        to: { anchor: { xMm: 125, yMm: 50 }, rackKey: 'rack:b' },
      };

      const routes = routeConnections([crossConn], [rackA, rackB], 'perimeter');
      const r = routes.get('cross');
      // Cross-rack uses gap corridor (baseY = 40), not same-rack exit stub
      expect(r).toContainEqual({ xMm: 106.35, yMm: 40 });
      expect(r).toContainEqual({ xMm: 118.65, yMm: 40 });
    });
  });

  describe('Class H same-row sibling routing (R5)', () => {
    const sharedRack: RoutingRack = {
      key: 'rack:1:front',
      xMm: 0,
      yMm: 0,
      widthMm: 482.6,
      heightMm: 400,
    };

    const siblingA: SlotBounds = {
      leftX: 0,
      rightX: 160.867,
      topY: 88.9,
      bottomY: 177.8,
    };

    const siblingB: SlotBounds = {
      leftX: 160.867,
      rightX: 321.733,
      topY: 88.9,
      bottomY: 177.8,
    };

    const siblingC: SlotBounds = {
      leftX: 321.733,
      rightX: 482.6,
      topY: 88.9,
      bottomY: 177.8,
    };

    it('1. routes two equal-height horizontal siblings along shallow seam', () => {
      const conn: RoutingConnection = {
        id: 'h1',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };

      const routes = routeConnections([conn], [sharedRack], 'perimeter');
      const route = routes.get('h1');
      expect(route).toBeDefined();
      expect(route).toEqual([
        { xMm: 80.4335, yMm: 88.9 },
        { xMm: 80.4335, yMm: 82.9 },
        { xMm: 241.3, yMm: 82.9 },
        { xMm: 241.3, yMm: 88.9 },
      ]);
    });

    it('2. attaches to presentation boundaries while preserving semantic anchors', () => {
      const conn: RoutingConnection = {
        id: 'h-anchor',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };
      const routes = routeConnections([conn], [sharedRack], 'perimeter');
      const route = expectRoute(routes, 'h-anchor');
      expect(route[0]).toEqual({ xMm: 80.4335, yMm: 88.9 });
      expect(route.at(-1)).toEqual({ xMm: 241.3, yMm: 88.9 });
      expect(conn.from.anchor).toEqual({ xMm: 160.867, yMm: 133.35 });
      expect(conn.to.anchor).toEqual({ xMm: 321.733, yMm: 133.35 });
    });

    it('3. reverses endpoint direction deterministically', () => {
      const fwdConn: RoutingConnection = {
        id: 'h-fwd',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };
      const revConn: RoutingConnection = {
        id: 'h-rev',
        from: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
        to: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
      };

      const fwd = routeConnections([fwdConn], [sharedRack], 'perimeter');
      const rev = routeConnections([revConn], [sharedRack], 'perimeter');

      expect(fwd.get('h-fwd')).toEqual(
        [...expectRoute(rev, 'h-rev')].reverse(),
      );
    });

    it('4. routes two sibling connections along the seam', () => {
      const conn1: RoutingConnection = {
        id: 'h1',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };
      const conn2: RoutingConnection = {
        id: 'h2',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };

      const routes = routeConnections(
        [conn1, conn2],
        [sharedRack],
        'perimeter',
      );
      expect(routes.get('h1')).toBeDefined();
      expect(routes.get('h2')).toBeDefined();
    });

    it('5. routes three sibling devices', () => {
      const connAB: RoutingConnection = {
        id: 'ab',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };
      const connBC: RoutingConnection = {
        id: 'bc',
        from: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
        to: {
          anchor: { xMm: 482.6, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingC,
        },
      };

      const routes = routeConnections(
        [connAB, connBC],
        [sharedRack],
        'perimeter',
      );
      expect(routes.get('ab')).toEqual([
        { xMm: 80.4335, yMm: 88.9 },
        { xMm: 80.4335, yMm: 82.9 },
        { xMm: 241.3, yMm: 82.9 },
        { xMm: 241.3, yMm: 88.9 },
      ]);
      expect(routes.get('bc')).toEqual([
        { xMm: 238.8, yMm: 88.9 },
        { xMm: 238.8, yMm: 78.9 },
        { xMm: 402.16650000000004, yMm: 78.9 },
        { xMm: 402.16650000000004, yMm: 88.9 },
      ]);
    });

    it('6. routes four sibling devices in a quad row', () => {
      const q1: SlotBounds = {
        leftX: 0,
        rightX: 120.65,
        topY: 88.9,
        bottomY: 177.8,
      };
      const q2: SlotBounds = {
        leftX: 120.65,
        rightX: 241.3,
        topY: 88.9,
        bottomY: 177.8,
      };
      const q3: SlotBounds = {
        leftX: 241.3,
        rightX: 361.95,
        topY: 88.9,
        bottomY: 177.8,
      };
      const q4: SlotBounds = {
        leftX: 361.95,
        rightX: 482.6,
        topY: 88.9,
        bottomY: 177.8,
      };

      const conn1: RoutingConnection = {
        id: 'q12',
        from: {
          anchor: { xMm: 120.65, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: q1,
        },
        to: {
          anchor: { xMm: 241.3, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: q2,
        },
      };
      const conn2: RoutingConnection = {
        id: 'q34',
        from: {
          anchor: { xMm: 361.95, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: q3,
        },
        to: {
          anchor: { xMm: 482.6, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: q4,
        },
      };

      const routes = routeConnections(
        [conn1, conn2],
        [sharedRack],
        'perimeter',
      );
      expect(routes.get('q12')).toEqual([
        { xMm: 60.325, yMm: 88.9 },
        { xMm: 60.325, yMm: 82.9 },
        { xMm: 180.97500000000002, yMm: 82.9 },
        { xMm: 180.97500000000002, yMm: 88.9 },
      ]);
      expect(routes.get('q34')).toEqual([
        { xMm: 301.625, yMm: 88.9 },
        { xMm: 301.625, yMm: 82.9 },
        { xMm: 422.275, yMm: 82.9 },
        { xMm: 422.275, yMm: 88.9 },
      ]);
    });

    it('7. routes non-adjacent siblings spanning across an intermediate device', () => {
      const connAC: RoutingConnection = {
        id: 'ac',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 482.6, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingC,
        },
      };
      const routes = routeConnections([connAC], [sharedRack], 'perimeter');
      expect(routes.get('ac')).toEqual([
        { xMm: 80.4335, yMm: 88.9 },
        { xMm: 80.4335, yMm: 82.9 },
        { xMm: 402.16650000000004, yMm: 82.9 },
        { xMm: 402.16650000000004, yMm: 88.9 },
      ]);
    });

    it('8. rejects unequal-height slots as ineligible', () => {
      const unequalB: SlotBounds = {
        leftX: 160.867,
        rightX: 321.733,
        topY: 88.9,
        bottomY: 133.35, // 1U height instead of 2U
      };
      const conn: RoutingConnection = {
        id: 'h-unequal',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 111.125 },
          rackKey: 'rack:1:front',
          slotBounds: unequalB,
        },
      };
      expect(isClassHEligible(conn.from, conn.to)).toBe(false);
      const routes = routeConnections([conn], [sharedRack], 'perimeter');
      expect(routes.get('h-unequal')?.some((p) => p.yMm === 82.9)).toBe(false);
    });

    it('9. rejects vertically offset slots as ineligible', () => {
      const offsetB: SlotBounds = {
        leftX: 160.867,
        rightX: 321.733,
        topY: 44.45,
        bottomY: 133.35,
      };
      const conn: RoutingConnection = {
        id: 'h-offset',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 88.9 },
          rackKey: 'rack:1:front',
          slotBounds: offsetB,
        },
      };
      expect(isClassHEligible(conn.from, conn.to)).toBe(false);
    });

    it('10. rejects horizontally overlapping slots as ineligible', () => {
      const overlapB: SlotBounds = {
        leftX: 100, // Overlaps siblingA [0, 160.867]
        rightX: 250,
        topY: 88.9,
        bottomY: 177.8,
      };
      const conn: RoutingConnection = {
        id: 'h-overlap',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 250, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: overlapB,
        },
      };
      expect(isClassHEligible(conn.from, conn.to)).toBe(false);
    });

    it('11. rejects anchor inside device interior as ineligible', () => {
      const connInterior: RoutingConnection = {
        id: 'h-interior',
        from: {
          anchor: { xMm: 80, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };
      expect(anchorIsOnVerticalBoundary(80, siblingA)).toBe(false);
      expect(isClassHEligible(connInterior.from, connInterior.to)).toBe(false);
    });

    it('12. accepts anchor on slot left boundary', () => {
      expect(anchorIsOnVerticalBoundary(0, siblingA)).toBe(true);
      expect(anchorIsOnVerticalBoundary(0.01, siblingA)).toBe(true);
      expect(anchorIsOnVerticalBoundary(-0.01, siblingA)).toBe(true);
    });

    it('13. accepts anchor on slot right boundary', () => {
      expect(anchorIsOnVerticalBoundary(160.867, siblingA)).toBe(true);
      expect(anchorIsOnVerticalBoundary(160.867 + 0.01, siblingA)).toBe(true);
      expect(anchorIsOnVerticalBoundary(160.867 - 0.01, siblingA)).toBe(true);
    });

    it('13a. rejects anchors clearly beyond the 0.01 mm boundary tolerance', () => {
      // The safety guard must not be looser than the 0.01 mm interior tolerance
      // it protects: an anchor further inside than that would put the vertical
      // leg through the device body rather than along its edge.
      expect(anchorIsOnVerticalBoundary(0.05, siblingA)).toBe(false);
      expect(anchorIsOnVerticalBoundary(0.1, siblingA)).toBe(false);
      expect(anchorIsOnVerticalBoundary(160.9, siblingA)).toBe(false);
      expect(anchorIsOnVerticalBoundary(160.867 - 0.1, siblingA)).toBe(false);
    });

    it('13b. keeps slot-interval equality at 0.001 mm, distinct from the 0.01 mm anchor guard', () => {
      // Two epsilons, two jobs. A 0.005 mm slot mismatch is not the same row
      // even though 0.005 mm would pass the anchor-boundary guard.
      const nearlyEqualRow: SlotBounds = {
        leftX: 160.867,
        rightX: 321.733,
        topY: 88.9 + 0.005,
        bottomY: 177.8,
      };
      const conn: RoutingConnection = {
        id: 'h-epsilon-split',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: nearlyEqualRow,
        },
      };
      expect(isClassHEligible(conn.from, conn.to)).toBe(false);
      expect(anchorIsOnVerticalBoundary(160.867 + 0.005, siblingA)).toBe(true);
    });

    it('14. chooses top seam when bottom seam is blocked by an obstacle', () => {
      const bottomObstacle: RoutingObstacle = {
        rackKey: 'rack:1:front',
        xMm: 0,
        yMm: 177.8,
        widthMm: 482.6,
        heightMm: 44.45,
      };
      const conn: RoutingConnection = {
        id: 'h-top-free',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };

      const routes = routeConnections([conn], [sharedRack], 'perimeter', [
        bottomObstacle,
      ]);
      const route = routes.get('h-top-free');
      expect(route).toContainEqual({ xMm: 80.4335, yMm: 82.9 });
    });

    it('15. chooses bottom seam when top seam is blocked by an obstacle', () => {
      const topObstacle: RoutingObstacle = {
        rackKey: 'rack:1:front',
        xMm: 0,
        yMm: 44.45,
        widthMm: 482.6,
        heightMm: 44.45,
      };
      const conn: RoutingConnection = {
        id: 'h-bottom-free',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };

      const routes = routeConnections([conn], [sharedRack], 'perimeter', [
        topObstacle,
      ]);
      const route = routes.get('h-bottom-free');
      expect(route).toContainEqual({ xMm: 80.4335, yMm: 183.8 });
    });

    it('16. chooses top even when raw endpoint anchors are closer to bottom', () => {
      const connCloserToBottom: RoutingConnection = {
        id: 'h-near-bottom',
        from: {
          anchor: { xMm: 160.867, yMm: 160 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 160 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };
      const routes = routeConnections(
        [connCloserToBottom],
        [sharedRack],
        'perimeter',
      );
      const route = routes.get('h-near-bottom');
      expect(route).toContainEqual({ xMm: 80.4335, yMm: 82.9 });
    });

    it('17. deterministically chooses top on exact top/bottom tie', () => {
      const connMid: RoutingConnection = {
        id: 'h-mid',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };
      const routes = routeConnections([connMid], [sharedRack], 'perimeter');
      const route = routes.get('h-mid');
      expect(route).toContainEqual({ xMm: 80.4335, yMm: 82.9 });
    });

    it('18. falls back to perimeter routing when both top and bottom seams are blocked', () => {
      const topObstacle: RoutingObstacle = {
        rackKey: 'rack:1:front',
        xMm: 0,
        yMm: 44.45,
        widthMm: 482.6,
        heightMm: 44.45,
      };
      const bottomObstacle: RoutingObstacle = {
        rackKey: 'rack:1:front',
        xMm: 0,
        yMm: 177.8,
        widthMm: 482.6,
        heightMm: 44.45,
      };
      const conn: RoutingConnection = {
        id: 'h-blocked',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };

      const routes = routeConnections([conn], [sharedRack], 'perimeter', [
        topObstacle,
        bottomObstacle,
      ]);
      const route = routes.get('h-blocked');
      // Falls back to perimeter candidate routing at rack edge + perimeter gutter
      expect(route).toContainEqual({ xMm: 482.6 + 12.7, yMm: 133.35 });
    });

    it('19. successful Class H route consumes no perimeter corridor lanes', () => {
      const connH: RoutingConnection = {
        id: 'h-conn',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };
      const connPerimeter: RoutingConnection = {
        id: 'perim-conn',
        from: { anchor: { xMm: 482.6, yMm: 20 }, rackKey: 'rack:1:front' },
        to: { anchor: { xMm: 482.6, yMm: 200 }, rackKey: 'rack:1:front' },
      };

      const routes = routeConnections(
        [connH, connPerimeter],
        [sharedRack],
        'perimeter',
      );
      // connPerimeter receives index 0 at rack edge + 12.7 (495.3)
      expect(routes.get('perim-conn')).toContainEqual({
        xMm: 482.6 + 12.7,
        yMm: 20,
      });
    });

    it('20. verifies seam offset is exactly 6 mm', () => {
      expect(LOCAL_SEAM_OFFSET_MM).toBe(6);
    });

    it('21. evaluates localRouteIsClear helper directly', () => {
      const obs: RoutingObstacle = {
        rackKey: 'rack:1',
        xMm: 100,
        yMm: 50,
        widthMm: 100,
        heightMm: 50,
      };
      const horizontal = (y: number, x1: number, x2: number) => [
        { xMm: x1, yMm: y },
        { xMm: x2, yMm: y },
      ];

      // Outside horizontally: clear
      expect(localRouteIsClear('rack:1', horizontal(75, 0, 50), [obs])).toBe(
        true,
      );
      // Through the interior: blocked
      expect(localRouteIsClear('rack:1', horizontal(75, 50, 150), [obs])).toBe(
        false,
      );
      // Different rack: clear
      expect(localRouteIsClear('rack:2', horizontal(75, 50, 150), [obs])).toBe(
        true,
      );
      // Riding the top edge is contact, not penetration: legal
      expect(localRouteIsClear('rack:1', horizontal(50, 50, 150), [obs])).toBe(
        true,
      );
      // Riding a vertical edge is contact, not penetration: legal
      expect(
        localRouteIsClear(
          'rack:1',
          [
            { xMm: 100, yMm: 0 },
            { xMm: 100, yMm: 120 },
          ],
          [obs],
        ),
      ).toBe(true);
      // A vertical leg crossing the interior is blocked
      expect(
        localRouteIsClear(
          'rack:1',
          [
            { xMm: 150, yMm: 0 },
            { xMm: 150, yMm: 120 },
          ],
          [obs],
        ),
      ).toBe(false);
    });

    it('22. D1: rejects the top seam when a fractional-U device clips the top transition band', () => {
      // The 0.1U device sits flush above the row: y 84.455 .. 88.9, so it is
      // 4.445 mm tall and the top seam scanline at 82.9 passes clear above it.
      // Only the two 6 mm vertical transition legs touch it, which the previous
      // scanline-only check could not see.
      const thinAbove: RoutingObstacle = {
        rackKey: 'rack:1:front',
        xMm: 0,
        yMm: 84.455,
        widthMm: 482.6,
        heightMm: 4.445,
      };
      const conn: RoutingConnection = {
        id: 'h-frac-top',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };

      const seamY = siblingA.topY - LOCAL_SEAM_OFFSET_MM;
      // The seam scanline alone really is clear — that is what made the bug
      // reachable — so the regression only holds if the legs are checked too.
      expect(
        localRouteIsClear(
          'rack:1:front',
          [
            { xMm: 160.867, yMm: seamY },
            { xMm: 321.733, yMm: seamY },
          ],
          [thinAbove],
        ),
      ).toBe(true);

      const routes = routeConnections([conn], [sharedRack], 'perimeter', [
        thinAbove,
      ]);
      const route = routes.get('h-frac-top');
      expect(route).toBeDefined();
      if (route === undefined) {
        throw new Error('expected a route');
      }

      // Top rejected, bottom clear: the bottom seam is taken.
      expect(route).toContainEqual({
        xMm: 80.4335,
        yMm: siblingA.bottomY + LOCAL_SEAM_OFFSET_MM,
      });
      expect(route).not.toContainEqual({ xMm: 80.4335, yMm: seamY });
      // And no segment of the chosen route enters the thin device.
      expect(localRouteIsClear('rack:1:front', route, [thinAbove])).toBe(true);
    });

    it('23. D1: rejects the bottom seam when a fractional-U device clips the bottom transition band', () => {
      const blockedAbove: RoutingObstacle = {
        rackKey: 'rack:1:front',
        xMm: 0,
        yMm: 44.45,
        widthMm: 482.6,
        heightMm: 44.45,
      };
      // Flush below the row: y 177.8 .. 182.245. The bottom seam scanline at
      // 183.8 clears it; only the transition legs touch it.
      const thinBelow: RoutingObstacle = {
        rackKey: 'rack:1:front',
        xMm: 0,
        yMm: 177.8,
        widthMm: 482.6,
        heightMm: 4.445,
      };
      const conn: RoutingConnection = {
        id: 'h-frac-bottom',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };

      const bottomSeamY = siblingA.bottomY + LOCAL_SEAM_OFFSET_MM;
      expect(
        localRouteIsClear(
          'rack:1:front',
          [
            { xMm: 160.867, yMm: bottomSeamY },
            { xMm: 321.733, yMm: bottomSeamY },
          ],
          [thinBelow],
        ),
      ).toBe(true);

      const routes = routeConnections([conn], [sharedRack], 'perimeter', [
        blockedAbove,
        thinBelow,
      ]);
      const route = routes.get('h-frac-bottom');
      expect(route).toBeDefined();
      if (route === undefined) {
        throw new Error('expected a route');
      }

      // Top blocked outright, bottom rejected by the leg check: perimeter.
      expect(route).not.toContainEqual({ xMm: 160.867, yMm: bottomSeamY });
      expect(route[0]).toEqual({ xMm: 482.6, yMm: 133.35 });
      expect(
        localRouteIsClear('rack:1:front', route, [blockedAbove, thinBelow]),
      ).toBe(true);
    });

    it('24. D2: shared row at the rack top rejects the outward seam and routes inward', () => {
      const topRowRack: RoutingRack = {
        key: 'rack:2:front',
        xMm: 0,
        yMm: 0,
        widthMm: 482.6,
        heightMm: 355.6,
      };
      const topLeft: SlotBounds = {
        leftX: 0,
        rightX: 241.3,
        topY: 0,
        bottomY: 44.45,
      };
      const topRight: SlotBounds = {
        leftX: 241.3,
        rightX: 482.6,
        topY: 0,
        bottomY: 44.45,
      };
      const conn: RoutingConnection = {
        id: 'h-rack-top',
        from: {
          anchor: { xMm: 241.3, yMm: 22.225 },
          rackKey: 'rack:2:front',
          slotBounds: topLeft,
        },
        to: {
          anchor: { xMm: 482.6, yMm: 22.225 },
          rackKey: 'rack:2:front',
          slotBounds: topRight,
        },
      };

      const routes = routeConnections([conn], [topRowRack], 'perimeter');
      const route = routes.get('h-rack-top');
      expect(route).toBeDefined();
      if (route === undefined) {
        throw new Error('expected a route');
      }

      // The outward seam would sit at y = -6, above the rack and inside the
      // reserved title band, so it must not be chosen.
      expect(route).not.toContainEqual({
        xMm: 120.65,
        yMm: -LOCAL_SEAM_OFFSET_MM,
      });
      expect(route).toContainEqual({
        xMm: 120.65,
        yMm: topLeft.bottomY + LOCAL_SEAM_OFFSET_MM,
      });
      expect(routeStaysWithinRack(route, topRowRack)).toBe(true);
    });

    it('25. D2: shared row at the rack bottom rejects the outward seam and routes inward', () => {
      const bottomRowRack: RoutingRack = {
        key: 'rack:3:front',
        xMm: 0,
        yMm: 0,
        widthMm: 482.6,
        heightMm: 355.6,
      };
      const bottomLeft: SlotBounds = {
        leftX: 0,
        rightX: 241.3,
        topY: 311.15,
        bottomY: 355.6,
      };
      const bottomRight: SlotBounds = {
        leftX: 241.3,
        rightX: 482.6,
        topY: 311.15,
        bottomY: 355.6,
      };
      const conn: RoutingConnection = {
        id: 'h-rack-bottom',
        from: {
          anchor: { xMm: 241.3, yMm: 333.375 },
          rackKey: 'rack:3:front',
          slotBounds: bottomLeft,
        },
        to: {
          anchor: { xMm: 482.6, yMm: 333.375 },
          rackKey: 'rack:3:front',
          slotBounds: bottomRight,
        },
      };

      const routes = routeConnections([conn], [bottomRowRack], 'perimeter');
      const route = routes.get('h-rack-bottom');
      expect(route).toBeDefined();
      if (route === undefined) {
        throw new Error('expected a route');
      }

      expect(route).not.toContainEqual({
        xMm: 120.65,
        yMm: bottomLeft.bottomY + LOCAL_SEAM_OFFSET_MM,
      });
      expect(route).toContainEqual({
        xMm: 120.65,
        yMm: bottomLeft.topY - LOCAL_SEAM_OFFSET_MM,
      });
      expect(routeStaysWithinRack(route, bottomRowRack)).toBe(true);
    });

    it('26. D2: falls back to perimeter when neither local candidate can stay in the rack', () => {
      // A single-U-tall rack: the row fills it, so both seams would leave.
      const tightRack: RoutingRack = {
        key: 'rack:4:front',
        xMm: 0,
        yMm: 0,
        widthMm: 482.6,
        heightMm: 44.45,
      };
      const onlyLeft: SlotBounds = {
        leftX: 0,
        rightX: 241.3,
        topY: 0,
        bottomY: 44.45,
      };
      const onlyRight: SlotBounds = {
        leftX: 241.3,
        rightX: 482.6,
        topY: 0,
        bottomY: 44.45,
      };
      const conn: RoutingConnection = {
        id: 'h-no-local',
        from: {
          anchor: { xMm: 241.3, yMm: 22.225 },
          rackKey: 'rack:4:front',
          slotBounds: onlyLeft,
        },
        to: {
          anchor: { xMm: 482.6, yMm: 22.225 },
          rackKey: 'rack:4:front',
          slotBounds: onlyRight,
        },
      };

      const routes = routeConnections([conn], [tightRack], 'perimeter');
      const route = routes.get('h-no-local');
      expect(route).toBeDefined();
      if (route === undefined) {
        throw new Error('expected a route');
      }

      // Perimeter fallback: leaves via the rack-side stub, not a local seam.
      expect(route).toContainEqual({ xMm: 482.6 + 6.35, yMm: 22.225 });
      expect(route).not.toContainEqual({
        xMm: 120.65,
        yMm: -LOCAL_SEAM_OFFSET_MM,
      });
      expect(route).not.toContainEqual({
        xMm: 241.3,
        yMm: 44.45 + LOCAL_SEAM_OFFSET_MM,
      });
    });

    it('27. D2: no accepted local route leaves and re-enters its own rack', () => {
      const conn: RoutingConnection = {
        id: 'h-containment',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:1:front',
          slotBounds: siblingB,
        },
      };

      const routes = routeConnections([conn], [sharedRack], 'perimeter');
      const route = routes.get('h-containment');
      expect(route).toBeDefined();
      if (route === undefined) {
        throw new Error('expected a route');
      }
      expect(routeStaysWithinRack(route, sharedRack)).toBe(true);
    });
  });

  describe('R5 shared-row regression & R7 path', () => {
    it('24. produces exact C3 logical route, length, bends, and clearance on shared-row proof', () => {
      const sharedRack: RoutingRack = {
        key: 'rack:Shared Equipment:front',
        xMm: 0,
        yMm: 0,
        widthMm: 482.6,
        heightMm: 400,
      };
      const computeA: SlotBounds = {
        leftX: 0,
        rightX: 160.867,
        topY: 88.9,
        bottomY: 177.8,
      };
      const computeB: SlotBounds = {
        leftX: 160.867,
        rightX: 321.733,
        topY: 88.9,
        bottomY: 177.8,
      };

      const conn: RoutingConnection = {
        id: 'c-sibling',
        from: {
          anchor: { xMm: 160.867, yMm: 133.35 },
          rackKey: 'rack:Shared Equipment:front',
          slotBounds: computeA,
        },
        to: {
          anchor: { xMm: 321.733, yMm: 133.35 },
          rackKey: 'rack:Shared Equipment:front',
          slotBounds: computeB,
        },
      };

      const routes = routeConnections([conn], [sharedRack], 'perimeter');
      const route = expectRoute(routes, 'c-sibling');

      const expectedRoute = [
        { xMm: 80.4335, yMm: 88.9 },
        { xMm: 80.4335, yMm: 82.9 },
        { xMm: 241.3, yMm: 82.9 },
        { xMm: 241.3, yMm: 88.9 },
      ];

      expect(route).toEqual(expectedRoute);
      // C3 presentation endpoints leave the semantic side anchors unchanged.
      expect(route[0]).toEqual({ xMm: 80.4335, yMm: 88.9 });
      expect(route.at(-1)).toEqual({ xMm: 241.3, yMm: 88.9 });
      expect(conn.from.anchor).toEqual({ xMm: 160.867, yMm: 133.35 });
      expect(conn.to.anchor).toEqual({ xMm: 321.733, yMm: 133.35 });

      expect(totalBendCount([route])).toBe(2);
      expect(countCrossings([route])).toBe(0);

      // Route length: 6 + 160.8665 + 6 = 172.8665 mm (~172.87 mm)
      const len = routeLength(route);
      expect(Math.round(len * 100) / 100).toBe(172.87);
    });

    it('25. verifies nominal 3mm radius on Class H 6mm seam offset with roundedRoutePath', () => {
      const logicalRoute = [
        { xMm: 80.4335, yMm: 88.9 },
        { xMm: 80.4335, yMm: 82.9 },
        { xMm: 241.3, yMm: 82.9 },
        { xMm: 241.3, yMm: 88.9 },
      ];

      const pathString = roundedRoutePath(logicalRoute);

      // Both 6mm legs admit the full 3mm corner radius at the C3 seam.
      expect(pathString).toBe(
        'M 80.434,88.9 L 80.434,85.9 Q 80.434,82.9 83.434,82.9 L 238.3,82.9 Q 241.3,82.9 241.3,85.9 L 241.3,88.9',
      );
    });
  });

  describe('external-endpoint routing requires exactly one device (#199 item 2)', () => {
    // The renderer always derives routing racks and endpoint rack keys from the
    // same scene, so these inputs are constructed directly: they exercise the
    // structural guard rather than a reachable renderer state.
    const missingRackKey = 'rack:missing';

    it('does not treat a second device endpoint as an external position', () => {
      const inconsistent: RoutingConnection = {
        id: 'inconsistent',
        from: { anchor: { xMm: 100, yMm: 40 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 300, yMm: 160 }, rackKey: missingRackKey },
      };

      const routes = routeConnections([inconsistent], racks, 'perimeter');
      const route = expectRoute(routes, 'inconsistent');

      // The safe fallback is a plain orthogonal route between the two raw
      // anchors: it starts and ends on them and never attaches to a rack edge.
      expect(route[0]).toEqual({ xMm: 100, yMm: 40 });
      expect(route[route.length - 1]).toEqual({ xMm: 300, yMm: 160 });
      expect(route).toEqual([
        { xMm: 100, yMm: 40 },
        { xMm: 200, yMm: 40 },
        { xMm: 200, yMm: 160 },
        { xMm: 300, yMm: 160 },
      ]);
      expect(everySegmentIsOrthogonal(route)).toBe(true);
    });

    it('uses the same fallback when the device endpoint order is reversed', () => {
      const inconsistent: RoutingConnection = {
        id: 'inconsistent-reversed',
        from: { anchor: { xMm: 300, yMm: 160 }, rackKey: missingRackKey },
        to: { anchor: { xMm: 100, yMm: 40 }, rackKey: 'rack:front' },
      };

      const routes = routeConnections([inconsistent], racks, 'perimeter');
      const route = expectRoute(routes, 'inconsistent-reversed');

      expect(route).toEqual([
        { xMm: 300, yMm: 160 },
        { xMm: 200, yMm: 160 },
        { xMm: 200, yMm: 40 },
        { xMm: 100, yMm: 40 },
      ]);
    });

    it('leaves a normal device-to-external perimeter route unchanged', () => {
      const routes = routeConnections([external], racks, 'perimeter');
      const route = expectRoute(routes, 'external');

      // Geometry recorded from the pre-hardening implementation: the device
      // endpoint attaches to a rack edge and the route terminates on the
      // external anchor.
      expect(route).toEqual([
        { xMm: 100, yMm: 40 },
        { xMm: 106.35, yMm: 40 },
        { xMm: 106.35, yMm: 212.7 },
        { xMm: 50, yMm: 212.7 },
        { xMm: 50, yMm: 250 },
      ]);
      expect(everySegmentIsOrthogonal(route)).toBe(true);
    });

    it('leaves normal device-to-device perimeter routes unchanged', () => {
      const routes = routeConnections(
        [crossRack, sameRack],
        racks,
        'perimeter',
      );

      expect(everySegmentIsOrthogonal(expectRoute(routes, 'cross-rack'))).toBe(
        true,
      );
      expect(everySegmentIsOrthogonal(expectRoute(routes, 'same-rack'))).toBe(
        true,
      );
    });

    it('routes two external endpoints through the fallback as before', () => {
      const bothExternal: RoutingConnection = {
        id: 'both-external',
        from: { anchor: { xMm: 300, yMm: 40 } },
        to: { anchor: { xMm: 320, yMm: 160 } },
      };

      const routes = routeConnections([bothExternal], racks, 'perimeter');
      const route = expectRoute(routes, 'both-external');

      expect(route[0]).toEqual({ xMm: 300, yMm: 40 });
      expect(route[route.length - 1]).toEqual({ xMm: 320, yMm: 160 });
    });
  });

  describe('external region selection', () => {
    // Subject bounds over the shared fixture: x 0..225, y -7.5..200.
    // rack:front spans x 0..100 (midpoint 50), rack:rear x 125..225
    // (midpoint 175).

    it('leaves rightwards for a target beyond the subject right edge', () => {
      const conn: RoutingConnection = {
        id: 'ext-right',
        from: { anchor: { xMm: 225, yMm: 100 }, rackKey: 'rack:rear' },
        to: { anchor: { xMm: 300, yMm: 100 } },
      };

      const route = expectRoute(
        routeConnections([conn], racks, 'perimeter'),
        'ext-right',
      );

      expect(route).toEqual([
        { xMm: 225, yMm: 100 },
        { xMm: 231.35, yMm: 100 },
        { xMm: 300, yMm: 100 },
      ]);
    });

    it('leaves leftwards for a target beyond the subject left edge', () => {
      const conn: RoutingConnection = {
        id: 'ext-left',
        from: { anchor: { xMm: 0, yMm: 100 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: -60, yMm: 100 } },
      };

      const route = expectRoute(
        routeConnections([conn], racks, 'perimeter'),
        'ext-left',
      );

      expect(route).toEqual([
        { xMm: 0, yMm: 100 },
        { xMm: -6.35, yMm: 100 },
        { xMm: -60, yMm: 100 },
      ]);
    });

    it('uses the global bottom channel for a target below the subject', () => {
      const conn: RoutingConnection = {
        id: 'ext-bottom',
        from: { anchor: { xMm: 100, yMm: 160 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 50, yMm: 260 } },
      };

      const route = expectRoute(
        routeConnections([conn], racks, 'perimeter'),
        'ext-bottom',
      );

      expect(route).toContainEqual({ xMm: 50, yMm: 212.7 });
    });

    it('uses the global top channel for a target above the subject', () => {
      const conn: RoutingConnection = {
        id: 'ext-top',
        from: { anchor: { xMm: 100, yMm: 40 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 50, yMm: -60 } },
      };

      const route = expectRoute(
        routeConnections([conn], racks, 'perimeter'),
        'ext-top',
      );

      expect(route).toContainEqual({ xMm: 50, yMm: -20.2 });
    });

    it('prefers the horizontal side when a target is both beyond the right edge and below the subject', () => {
      const conn: RoutingConnection = {
        id: 'ext-right-and-below',
        from: { anchor: { xMm: 225, yMm: 100 }, rackKey: 'rack:rear' },
        to: { anchor: { xMm: 300, yMm: 260 } },
      };

      const route = expectRoute(
        routeConnections([conn], racks, 'perimeter'),
        'ext-right-and-below',
      );

      // Horizontal wins the cascade, so this leaves the rack face rightwards
      // rather than diving into the global bottom channel at y = 212.7.
      expect(route).toEqual([
        { xMm: 225, yMm: 100 },
        { xMm: 231.35, yMm: 100 },
        { xMm: 300, yMm: 100 },
        { xMm: 300, yMm: 260 },
      ]);
    });

    it('falls back to the device rack midpoint for a target inside the subject bounds', () => {
      const leftOfMidpoint: RoutingConnection = {
        id: 'ext-interior-left',
        from: { anchor: { xMm: 0, yMm: 100 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 20, yMm: 100 } },
      };
      const rightOfMidpoint: RoutingConnection = {
        id: 'ext-interior-right',
        from: { anchor: { xMm: 100, yMm: 140 }, rackKey: 'rack:front' },
        to: { anchor: { xMm: 110, yMm: 140 } },
      };

      const routes = routeConnections(
        [leftOfMidpoint, rightOfMidpoint],
        racks,
        'perimeter',
      );

      // x = 20 sits in rack:front's left half, so the route leaves the left
      // face at x = 0; x = 110 sits in its right half and leaves x = 100.
      expect(expectRoute(routes, 'ext-interior-left')).toEqual([
        { xMm: 0, yMm: 100 },
        { xMm: -6.35, yMm: 100 },
        { xMm: 20, yMm: 100 },
      ]);
      expect(expectRoute(routes, 'ext-interior-right')).toEqual([
        { xMm: 100, yMm: 140 },
        { xMm: 106.35, yMm: 140 },
        { xMm: 110, yMm: 140 },
      ]);
    });

    it('splits an interior target on its own device rack rather than on the whole subject', () => {
      const conn: RoutingConnection = {
        id: 'ext-interior-rear',
        from: { anchor: { xMm: 125, yMm: 100 }, rackKey: 'rack:rear' },
        to: { anchor: { xMm: 140, yMm: 100 } },
      };

      const route = expectRoute(
        routeConnections([conn], racks, 'perimeter'),
        'ext-interior-rear',
      );

      // x = 140 is right of the subject midpoint (112.5) but left of
      // rack:rear's own midpoint (175), so it leaves the rack's left face.
      // Splitting on the subject instead would leave x = 225.
      expect(route).toEqual([
        { xMm: 125, yMm: 100 },
        { xMm: 118.65, yMm: 100 },
        { xMm: 140, yMm: 100 },
      ]);
    });
  });

  describe('zero-anchored routing subject bounds', () => {
    // Every rack sits well right of the origin, which is the only arrangement
    // that can tell the zero seed apart from a first-rack seed.
    const offsetRacks: RoutingRack[] = [
      { key: 'rack:offset', xMm: 150, yMm: 0, widthMm: 100, heightMm: 200 },
    ];

    it('keeps the projected origin inside the subject when every rack is right of it', () => {
      const conn: RoutingConnection = {
        id: 'ext-below-left',
        from: { anchor: { xMm: 250, yMm: 100 }, rackKey: 'rack:offset' },
        to: { anchor: { xMm: 50, yMm: 300 } },
      };

      const route = expectRoute(
        routeConnections([conn], offsetRacks, 'perimeter'),
        'ext-below-left',
      );

      // The seed pins subjectLeftX at 0, so x = 50 is *inside* the subject and
      // the target is classified by its Y as below it, taking the global bottom
      // channel at 200 + 12.7. Seeding from the first rack would put
      // subjectLeftX at 150, classify x = 50 as a left-side target, and produce
      // a short side route with no channel at all.
      expect(route).toContainEqual({ xMm: 50, yMm: 212.7 });
    });

    it('routes without racks, where the seed is the only bound available', () => {
      const conn: RoutingConnection = {
        id: 'no-racks',
        from: { anchor: { xMm: 10, yMm: 10 } },
        to: { anchor: { xMm: 90, yMm: 70 } },
      };

      const perimeter = expectRoute(
        routeConnections([conn], [], 'perimeter'),
        'no-racks',
      );
      const lanes = expectRoute(
        routeConnections([conn], [], 'lanes'),
        'no-racks',
      );

      expect(perimeter[0]).toEqual({ xMm: 10, yMm: 10 });
      expect(perimeter.at(-1)).toEqual({ xMm: 90, yMm: 70 });
      // The bottom lane is measured from the zero-seeded subject bottom.
      expect(lanes).toContainEqual({ xMm: 10, yMm: 6.35 });
    });
  });
});
