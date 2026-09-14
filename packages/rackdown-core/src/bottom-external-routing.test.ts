import { describe, expect, it } from 'vitest';
import {
  bottomExternalRouteIsClear,
  type RoutingBottomExternal,
  type RoutingConnection,
  type RoutingRack,
  routeConnections,
} from './routing.js';

const rack: RoutingRack = {
  key: 'r',
  xMm: 0,
  yMm: 0,
  widthMm: 100,
  heightMm: 100,
};
function external(id = 'e', x = 50, y = 142.7): RoutingBottomExternal {
  return {
    id,
    placement: 'bottom',
    box: { xMm: x - 38.1, yMm: y, widthMm: 76.2, heightMm: 16 },
    target: { xMm: x, yMm: y },
    approachY: y - 10,
    protectedApproach: { xMm: x - 1.25, yMm: y - 6, widthMm: 2.5, heightMm: 6 },
  };
}
function connection(id = 'c', target = external(), y = 50): RoutingConnection {
  return {
    id,
    from: {
      rackKey: 'r',
      anchor: { xMm: 100, yMm: y },
      slotBounds: { leftX: 0, rightX: 100, topY: 20, bottomY: 80 },
    },
    to: { externalId: target.id, anchor: target.target },
  };
}

describe('complete bottom external routing', () => {
  it('uses the direct bottom candidate and enters only at top centre', () => {
    const target = external();
    const route = routeConnections(
      [connection()],
      [rack],
      'perimeter',
      [],
      [target],
    ).get('c');
    expect(route).toEqual([
      { xMm: 100, yMm: 50 },
      { xMm: 106.35, yMm: 50 },
      { xMm: 106.35, yMm: 112.7 },
      { xMm: 50, yMm: 112.7 },
      target.target,
    ]);
  });

  it('rejects every segment through boxes or foreign protected stems globally', () => {
    const target = external();
    const foreign = external('other', 150);
    const clear = (route: Array<{ xMm: number; yMm: number }>) =>
      bottomExternalRouteIsClear(route, target.id, [], [], [target, foreign]);
    expect(clear([{ xMm: 50, yMm: 160 }, target.target])).toBe(false);
    expect(
      clear([
        { xMm: 90, yMm: 150 },
        { xMm: 200, yMm: 150 },
      ]),
    ).toBe(false);
    expect(
      clear([
        { xMm: 90, yMm: 140 },
        { xMm: 200, yMm: 140 },
      ]),
    ).toBe(false);
    expect(clear([{ xMm: 50, yMm: 130 }, target.target])).toBe(true);
    expect(
      clear([
        { xMm: 0, yMm: 132.7 },
        { xMm: 200, yMm: 132.7 },
      ]),
    ).toBe(true);
    expect(
      bottomExternalRouteIsClear(
        [
          { xMm: 50, yMm: -10 },
          { xMm: 50, yMm: 110 },
        ],
        target.id,
        [rack],
        [],
        [target],
      ),
    ).toBe(false);
  });

  it('shares the final stem for the same semantic external in either connection direction', () => {
    const target = external();
    const a = connection('a');
    const b = { ...connection('b'), from: a.to, to: a.from };
    const routes = routeConnections([a, b], [rack], 'perimeter', [], [target]);
    expect(routes.get('a')?.at(-1)).toEqual(target.target);
    expect(routes.get('b')?.[0]).toEqual(target.target);
    for (const route of routes.values())
      expect(
        bottomExternalRouteIsClear(route, target.id, [rack], [], [target]),
      ).toBe(true);
  });

  it('retains bottom intent outside the subject X extent and tries both source sides', () => {
    for (const x of [-100, 200]) {
      const target = external('e', x);
      const route = routeConnections(
        [connection('c', target)],
        [rack],
        'perimeter',
        [],
        [target],
      ).get('c');
      if (!route) throw new Error('Missing route');
      expect(route[0]?.xMm).toBe(x < 0 ? 0 : 100);
      expect(route.at(-2)?.xMm).toBe(x);
      expect(route.at(-2)?.yMm).toBeLessThan(target.target.yMm);
      expect(route.at(-1)).toEqual(target.target);
    }
  });

  it('uses an outer trunk to reach a later row behind a foreign box', () => {
    const first = external('first');
    const target = external('second', 50, 172.7);
    const route = routeConnections(
      [connection('c', target)],
      [rack],
      'perimeter',
      [],
      [first, target],
    ).get('c');
    if (!route) throw new Error('Missing route');
    expect(route).toContainEqual({ xMm: 106.35, yMm: 162.7 });
    expect(route.at(-2)).toEqual({ xMm: 50, yMm: 162.7 });
    expect(
      bottomExternalRouteIsClear(route, target.id, [rack], [], [first, target]),
    ).toBe(true);
  });

  it('escapes outward at source past a wider rack below, without consuming a bottom lane', () => {
    const below: RoutingRack = {
      key: 'below',
      xMm: -50,
      yMm: 110,
      widthMm: 200,
      heightMm: 100,
    };
    const target = external('first', 50, 252.7);
    const next = external('second', 200, 252.7);
    const a = connection('a', target);
    const b = {
      ...connection('b', next, 180),
      from: { rackKey: below.key, anchor: { xMm: 150, yMm: 180 } },
    };
    const routes = routeConnections(
      [a, b],
      [rack, below],
      'perimeter',
      [],
      [target, next],
    );
    const route = routes.get('a');
    if (!route) throw new Error('Missing route');
    expect(route).toContainEqual({ xMm: -56.35, yMm: 50 });
    expect(route).toContainEqual({ xMm: -56.35, yMm: 242.7 });
    expect(route.some((p) => p.yMm === 222.7)).toBe(false);
    expect(routes.get('b')).toContainEqual({ xMm: 200, yMm: 222.7 });
    for (const [id, path] of routes)
      expect(
        bottomExternalRouteIsClear(
          path,
          id === 'a' ? target.id : next.id,
          [rack, below],
          [],
          [target, next],
        ),
      ).toBe(true);
  });
});
