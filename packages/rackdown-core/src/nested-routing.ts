import type { PointMm } from './layout.js';

/** A bracket in coordinates along (start/end) and across (edges) a device row. */
export interface BracketEndpoint {
  key: string;
  start: number;
  end: number;
  edges: readonly [number, number];
}

export interface BracketRequest {
  id: string;
  from: BracketEndpoint;
  to: BracketEndpoint;
  offset: number;
}

const SPACING = 2.5;
const LANE_SPACING = 4;
const EPSILON = 0.001;
const centre = (endpoint: BracketEndpoint) =>
  (endpoint.start + endpoint.end) / 2;
const span = (request: BracketRequest) => {
  const a = centre(request.from);
  const b = centre(request.to);
  return [Math.min(a, b), Math.max(a, b)] as const;
};

function interleaves(a: BracketRequest, b: BracketRequest): boolean {
  const [lo, hi] = span(a);
  const [otherLo, otherHi] = span(b);
  return (
    (lo < otherLo - EPSILON &&
      otherLo < hi - EPSILON &&
      hi < otherHi - EPSILON) ||
    (otherLo < lo - EPSILON && lo < otherHi - EPSILON && otherHi < hi - EPSILON)
  );
}

/**
 * Nest short spans inside longer ones. Disjoint spans reuse their distance.
 * Preview the entire side whenever its endpoint fan changes: a new attachment
 * must not move an already accepted route into an obstacle.
 */
export function nestedBrackets(
  requests: readonly BracketRequest[],
  axis: 'x' | 'y',
  clear: (request: BracketRequest, route: PointMm[]) => boolean,
  maxLanes = Number.POSITIVE_INFINITY,
  fixedRoutes: readonly PointMm[][] = [],
): Map<string, PointMm[]> {
  const ordered = [...requests].sort((a, b) => {
    const [a0, a1] = span(a);
    const [b0, b1] = span(b);
    const length = a1 - a0 - (b1 - b0);
    // Treat sub-micron projection rounding as equal geometry.
    if (Math.abs(length) > EPSILON) return length;
    if (Math.abs(a0 - b0) > EPSILON) return a0 - b0;
    return 0;
  });
  const sides: [BracketRequest[], BracketRequest[]] = [[], []];
  const result = new Map<string, PointMm[]>();
  const sameRow = (a: BracketRequest, b: BracketRequest) =>
    axis === 'y' ||
    a.from.edges.every(
      (edge, i) => Math.abs(edge - (b.from.edges[i] as number)) <= EPSILON,
    );
  function conflicts(routes: Map<string, PointMm[]>) {
    let count = 0;
    for (const route of routes.values()) {
      for (const other of fixedRoutes) {
        for (let i = 1; i < route.length; i++) {
          const a = route[i - 1] as PointMm;
          const b = route[i] as PointMm;
          const dx = b.xMm - a.xMm;
          const dy = b.yMm - a.yMm;
          const length = Math.hypot(dx, dy);
          if (length === 0) continue;
          for (let j = 1; j < other.length; j++) {
            const c = other[j - 1] as PointMm;
            const d = other[j] as PointMm;
            const cross =
              (b.xMm - a.xMm) * (d.yMm - c.yMm) -
              (b.yMm - a.yMm) * (d.xMm - c.xMm);
            if (Math.abs(cross) < 1e-9) {
              // Parallel segments conflict only when they share a positive
              // length, not when they merely touch or lie on separate lines.
              const ux = dx / length;
              const uy = dy / length;
              if (
                [c, d].some(
                  (p) =>
                    Math.abs((p.xMm - a.xMm) * uy - (p.yMm - a.yMm) * ux) >
                    1e-9,
                )
              )
                continue;
              const cAlong = (c.xMm - a.xMm) * ux + (c.yMm - a.yMm) * uy;
              const dAlong = (d.xMm - a.xMm) * ux + (d.yMm - a.yMm) * uy;
              const overlap =
                Math.min(length, Math.max(cAlong, dAlong)) -
                Math.max(0, Math.min(cAlong, dAlong));
              if (overlap > 1e-9) count++;
              continue;
            }
            const t =
              ((c.xMm - a.xMm) * (d.yMm - c.yMm) -
                (c.yMm - a.yMm) * (d.xMm - c.xMm)) /
              cross;
            const u =
              ((c.xMm - a.xMm) * (b.yMm - a.yMm) -
                (c.yMm - a.yMm) * (b.xMm - a.xMm)) /
              cross;
            if (t > 1e-6 && t < 1 - 1e-6 && u > 1e-6 && u < 1 - 1e-6) count++;
          }
        }
      }
    }
    return count;
  }
  function preview(entries: BracketRequest[], side: 0 | 1) {
    const occurrences = new Map<
      string,
      Array<{
        request: BracketRequest;
        endpoint: BracketEndpoint;
        partner: BracketEndpoint;
        end: 'from' | 'to';
        ordinal: number;
      }>
    >();
    for (const [ordinal, request] of entries.entries()) {
      for (const end of ['from', 'to'] as const) {
        const endpoint = request[end];
        const group = occurrences.get(endpoint.key) ?? [];
        group.push({
          request,
          endpoint,
          partner: request[end === 'from' ? 'to' : 'from'],
          end,
          ordinal,
        });
        occurrences.set(endpoint.key, group);
      }
    }
    const positions = new Map<string, number>();
    for (const group of occurrences.values()) {
      group.sort((a, b) => {
        const origin = centre(a.endpoint);
        const pa = centre(a.partner);
        const pb = centre(b.partner);
        const da = pa < origin ? -1 : 1;
        const db = pb < origin ? -1 : 1;
        return (
          da - db ||
          pb - pa ||
          (da < 0 ? a.ordinal - b.ordinal : b.ordinal - a.ordinal)
        );
      });
      for (const [i, occurrence] of group.entries()) {
        const { start, end } = occurrence.endpoint;
        const length = end - start;
        const n = group.length;
        // Even interior points normally; retain minimum spacing until the
        // complete edge is exhausted, then compress to its boundaries.
        const spacing =
          n === 1
            ? 0
            : Math.min(length / (n - 1), Math.max(SPACING, length / (n + 1)));
        positions.set(
          `${occurrence.request.id}:${occurrence.end}`,
          (start + end) / 2 + (i - (n - 1) / 2) * spacing,
        );
      }
    }
    const occupied: Array<{
      request: BracketRequest;
      start: number;
      end: number;
      distance: number;
      lane: number;
    }> = [];
    const routes = new Map<string, PointMm[]>();
    for (const request of entries) {
      const from = positions.get(`${request.id}:from`) as number;
      const to = positions.get(`${request.id}:to`) as number;
      const start = Math.min(from, to);
      const end = Math.max(from, to);
      const overlaps = occupied.filter(
        (other) =>
          sameRow(request, other.request) &&
          !(
            end + SPACING <= other.start + 1e-9 ||
            start >= other.end + SPACING - 1e-9
          ),
      );
      const lane = Math.max(-1, ...overlaps.map((other) => other.lane)) + 1;
      if (lane >= maxLanes) return undefined;
      const distance = Math.max(
        request.offset,
        ...overlaps.map((other) => other.distance + LANE_SPACING),
      );
      const fromEdge = request.from.edges[side];
      const toEdge = request.to.edges[side];
      const seam =
        side === 0
          ? Math.min(fromEdge, toEdge) - distance
          : Math.max(fromEdge, toEdge) + distance;
      const point = (along: number, across: number): PointMm =>
        axis === 'x'
          ? { xMm: along, yMm: across }
          : { xMm: across, yMm: along };
      const route =
        axis === 'y' && distance > 6.35
          ? [
              point(from, fromEdge),
              point(from, fromEdge + (side === 0 ? -6.35 : 6.35)),
              point(from, seam),
              point(to, seam),
              point(to, toEdge + (side === 0 ? -6.35 : 6.35)),
              point(to, toEdge),
            ]
          : [
              point(from, fromEdge),
              point(from, seam),
              point(to, seam),
              point(to, toEdge),
            ];
      if (!clear(request, route)) return undefined;
      occupied.push({ request, start, end, distance, lane });
      routes.set(request.id, route);
    }
    return routes;
  }
  for (const request of ordered) {
    const preference: [0 | 1, 0 | 1] = axis === 'x' ? [0, 1] : [1, 0];
    let best:
      | { side: 0 | 1; routes: Map<string, PointMm[]>; score: number }
      | undefined;
    for (const side of preference) {
      const routes = preview([...sides[side], request], side);
      if (!routes) continue;
      const previous = new Map(
        sides[side].map((entry) => [
          entry.id,
          result.get(entry.id) as PointMm[],
        ]),
      );
      const score =
        conflicts(routes) -
        conflicts(previous) +
        sides[side].filter(
          (other) => sameRow(request, other) && interleaves(request, other),
        ).length;
      if (!best || score < best.score) best = { side, routes, score };
    }
    if (!best) continue;
    sides[best.side].push(request);
    for (const [id, route] of best.routes) result.set(id, route);
  }
  return result;
}
