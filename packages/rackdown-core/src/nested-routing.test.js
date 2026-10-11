import { describe, expect, it } from 'vitest';
import {
  computeMetrics,
  extractRoutes,
  sharedSegmentLength,
} from '../../../tools/render-metrics/metrics.mjs';
import { nestedBrackets } from './nested-routing.js';
import { parse } from './parser.js';
import { toSvg } from './renderer.js';
import { resolve } from './resolver.js';
import { consumeLane, peekLane } from './routing.js';

function scene(count, shelf, height = 1, rear = false) {
  const names = ['a', 'b', 'c', 'd'];
  const prefix = rear ? 'rear ' : '';
  const devices = names
    .slice(0, count)
    .map(
      (name, i) =>
        `${prefix}${shelf ? '3 2U device' : `${10 - i * height} ${height}U server`} "Node ${name}" as ${name}`,
    );
  const cables = [];
  for (let a = 0; a < count; a++)
    for (let b = a + 1; b < count; b++)
      cables.push(`${names[a]}:nic${b} -- ${names[b]}:nic${a}`);
  return {
    header: [
      `rack "Cluster" 12U${rear ? ' views front rear' : ''}`,
      ...(shelf ? [`${prefix}3 2U shelf "Shelf"`] : []),
      ...devices,
    ],
    cables,
  };
}
const permutations = (items) =>
  items.length
    ? items.flatMap((item, i) =>
        permutations(items.filter((_, j) => i !== j)).map((rest) => [
          item,
          ...rest,
        ]),
      )
    : [[]];
function render(header, cables) {
  const layout = resolve(parse([...header, ...cables].join('\n')));
  expect(layout.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const before = JSON.stringify(layout);
  const svg = toSvg(layout, {
    namespace: 'nested',
    connectionRouting: 'perimeter',
  });
  expect(JSON.stringify(layout)).toBe(before);
  return { layout, svg, routes: extractRoutes(svg) };
}
const shapes = (routes) => routes.map((r) => JSON.stringify(r.points)).sort();

describe('bracket conflicts with fixed routes', () => {
  const request = {
    id: 'bracket',
    from: { key: 'a', start: 0, end: 20, edges: [0, 20] },
    to: { key: 'b', start: 80, end: 100, edges: [0, 20] },
    offset: 10,
  };
  for (const axis of ['x', 'y']) {
    // Reflect the horizontal case onto the vertical planner's preferred right side.
    const point = ([along, across]) =>
      axis === 'x'
        ? { xMm: along, yMm: across }
        : { xMm: 20 - across, yMm: along };
    const plan = (fixedRoutes = []) =>
      nestedBrackets([request], axis, () => true, Infinity, fixedRoutes).get(
        request.id,
      );
    for (const reversed of [false, true]) {
      it.each([
        [
          'contained seam overlap',
          [
            [30, -10],
            [70, -10],
          ],
        ],
        [
          'partial seam overlap',
          [
            [0, -10],
            [30, -10],
          ],
        ],
        [
          'coincident seam',
          [
            [10, -10],
            [90, -10],
          ],
        ],
        [
          'side-leg overlap',
          [
            [10, -8],
            [10, -2],
          ],
        ],
        [
          'proper crossing',
          [
            [50, -15],
            [50, -5],
          ],
        ],
      ])(
        `avoids %s on axis ${axis} (reversed=${reversed})`,
        (_name, segment) => {
          const fixed = segment.map(point);
          if (reversed) fixed.reverse();
          const before = JSON.stringify(fixed);
          const route = plan([fixed]);
          expect(route).toBeDefined();
          expect(route).not.toEqual(plan());
          expect(
            sharedSegmentLength(
              [route, fixed].map((points, id) => ({
                id: String(id),
                points: points.map((p) => [p.xMm, p.yMm]),
              })),
            ),
          ).toBe(0);
          expect(plan([fixed])).toEqual(route);
          expect(JSON.stringify(fixed)).toBe(before);
        },
      );
      it.each([
        [
          'parallel but separate',
          [
            [30, -9],
            [70, -9],
          ],
        ],
        [
          'collinear but disjoint',
          [
            [100, -10],
            [120, -10],
          ],
        ],
        [
          'endpoint-only contact',
          [
            [90, -10],
            [110, -10],
          ],
        ],
        [
          'zero-length segment',
          [
            [50, -10],
            [50, -10],
          ],
        ],
      ])(
        `ignores %s on axis ${axis} (reversed=${reversed})`,
        (_name, segment) => {
          const fixed = segment.map(point);
          if (reversed) fixed.reverse();
          expect(plan([fixed])).toEqual(plan());
        },
      );
    }
  }
});

describe('nested same-rack meshes (#329)', () => {
  for (const shelf of [false, true])
    for (const count of [3, 4]) {
      it(`${count} nodes ${shelf ? 'on a shelf' : 'stacked'}: every source permutation is clear and deterministic`, () => {
        const { header, cables } = scene(count, shelf);
        const original = render(header, cables);
        const expected = shapes(original.routes);
        for (const order of permutations(cables)) {
          const { layout, svg, routes } = render(header, order);
          expect(shapes(routes)).toEqual(expected);
          expect(computeMetrics(layout, svg)).toMatchObject({
            connections: cables.length,
            crossings: 0,
            sharedSegmentMm: 0,
            occludedMm: 0,
          });
          expect(sharedSegmentLength(routes)).toBe(0);
        }
        const reversed = render(
          header,
          cables.map((line) => line.split(' -- ').reverse().join(' -- ')),
        );
        expect(
          shapes(
            reversed.routes.map((r) => ({ ...r, points: r.points.reverse() })),
          ),
        ).toEqual(expected);
        expect(render(header, cables).svg).toBe(original.svg);
      });
    }
  it.each([1, 2])('keeps a %sU rear four-node mesh clear', (height) => {
    const { header, cables } = scene(4, false, height, true);
    const { layout, svg } = render(header, cables);
    expect(computeMetrics(layout, svg)).toMatchObject({
      crossings: 0,
      sharedSegmentMm: 0,
      occludedMm: 0,
    });
  });
  it('shares the inner shelf height and places the longest bracket outside', () => {
    const { header, cables } = scene(3, true);
    const { routes } = render(header, [cables[1], cables[0], cables[2]]);
    const [ac, ab, bc] = routes.map((r) => r.points);
    expect(ab[1][1]).toBe(bc[1][1]);
    expect(ac[1][1]).toBe(ab[1][1] - 4);
    const width = 482.6 / 3;
    expect(ac[0][0]).toBeCloseTo(width / 3, 3);
    expect(ab[0][0]).toBeCloseTo((width * 2) / 3, 3);
  });
  it('spreads shared-row side attachments without hiding cables at the rack boundary', () => {
    const { layout, svg, routes } = render(
      [
        'rack "Shared row" 12U',
        '12 switch "Core" as core',
        '8 device "A" as a',
        '8 device "B" as b',
        '8 device "C" as c',
      ],
      ['core:1 -- a:1', 'core:2 -- b:1', 'core:3 -- c:1'],
    );
    expect(computeMetrics(layout, svg)).toMatchObject({
      crossings: 0,
      sharedSegmentMm: 0,
      occludedMm: 0,
    });
    expect(
      new Set(routes.map((route) => route.points.at(-1).join(','))).size,
    ).toBe(3);
  });
  it('grows a dense fan without entering the neighbouring rack projection', () => {
    const { layout, svg } = render(
      [
        'rack "Crowded" 12U views front rear',
        '12 switch "Core" as core',
        '2 server "Target" as target',
        'rear 2 server "Neighbour"',
      ],
      Array.from({ length: 24 }, (_, i) => `core:${i} -- target:${i}`),
    );
    expect(computeMetrics(layout, svg)).toMatchObject({
      connections: 24,
      crossings: 0,
      sharedSegmentMm: 0,
      occludedMm: 0,
      foreignRackTransitMm: 0,
    });
  });
  it('reuses a side corridor only for disjoint spans and never wraps onto occupied spans', () => {
    const corridor = {
      id: 'rack:test:right',
      axis: 'x',
      capacity: 6,
      allocations: 0,
      coordinate: (lane) => 12.7 + lane * 4,
    };
    for (let lane = 0; lane < 8; lane++) {
      const preview = peekLane(corridor, undefined, [0, 100]);
      expect(preview.index).toBe(lane);
      expect(corridor.allocations).toBe(lane);
      consumeLane(preview);
    }
    const reuse = peekLane(corridor, undefined, [102.5, 200]);
    expect(reuse.index).toBe(0);
    consumeLane(reuse);
    expect(peekLane(corridor, undefined, [101, 150]).index).toBe(8);
  });
});
