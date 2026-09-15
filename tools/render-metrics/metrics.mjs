/**
 * Geometric quality measures for rendered RackDown SVG.
 *
 * These exist because renderer changes need a signal between "the unit tests
 * still pass" and "it looks alright in the playground". Every measure here is
 * derived from emitted geometry rather than from markup shape, so reordering an
 * attribute or renaming a class does not move a number, while a route that
 * starts tunnelling through a rack does.
 *
 * The SVG is parsed with regular expressions rather than a DOM. That is normally
 * a poor idea, but the input is this repository's own renderer output, which is
 * generated line by line from templates in `renderer.ts` and is not arbitrary
 * SVG. Keeping the harness dependency-free is worth more here than generality.
 */

/** Sampling resolution for length-inside-rectangle measures, in millimetres. */
const SAMPLE_STEP_MM = 0.5;

/** Point-in-rectangle tolerance, so a route running exactly along an edge is not counted as inside. */
const EDGE_EPSILON_MM = 0.01;

/**
 * Parametric-intersection tolerance. Excludes shared endpoints and T-junctions,
 * which are how routes legitimately meet, from the crossing count.
 */
const INTERSECTION_EPSILON = 1e-6;

/** Collinear segments have a near-zero cross product and are not treated as crossing. */
const PARALLEL_EPSILON = 1e-9;

/** Direction change below this cross product reads as a straight join rather than a bend. */
const BEND_EPSILON = 1e-6;

function parsePointPair(token) {
  return token.split(',').map(Number);
}

/**
 * Logical route points recovered from one routed-connection `d`.
 *
 * Routed connections are drawn with rounded elbows (#203 R7), so the markup
 * carries approach and departure points that are presentation only. The
 * measures here are about the route the renderer decided, not about how softly
 * it was drawn, so those are dropped and the original corner is recovered from
 * the quadratic control point.
 *
 * This is not a general SVG path parser and is not meant to become one. It
 * understands exactly the `M / L / Q` grammar `roundedRoutePath` emits:
 *
 *   M start (L approach Q corner departure | L point)* L final
 */
export function parseRoutePath(d) {
  const tokens = d.trim().split(/\s+/);
  const points = [];

  let index = 0;
  while (index < tokens.length) {
    const command = tokens[index];
    if (command === 'M') {
      points.push(parsePointPair(tokens[index + 1]));
      index += 2;
    } else if (command === 'L') {
      // An `L` immediately before a `Q` is that corner's approach point: the
      // logical corner is the `Q` control point, so this one is not a route
      // point. Any other `L` is an original route point.
      if (tokens[index + 2] !== 'Q') {
        points.push(parsePointPair(tokens[index + 1]));
      }
      index += 2;
    } else if (command === 'Q') {
      // Control point is the original corner; the endpoint is the departure
      // point, which is presentation only.
      points.push(parsePointPair(tokens[index + 1]));
      index += 3;
    } else {
      throw new Error(`Unsupported command "${command}" in route path: ${d}`);
    }
  }

  return points;
}

/** Connection routes, as arrays of [x, y] points in millimetres. */
export function extractRoutes(svg) {
  const routes = [];

  for (const match of svg.matchAll(
    /<path [^>]*data-connection-id="([^"]+)"[^>]*d="([^"]+)"/g,
  )) {
    routes.push({ id: match[1], points: parseRoutePath(match[2]) });
  }

  // `direct` routing emits <line> rather than a routed <path>.
  for (const match of svg.matchAll(
    /<line [^>]*data-connection-id="([^"]+)"[^>]*x1="([-\d.]+)" y1="([-\d.]+)" x2="([-\d.]+)" y2="([-\d.]+)"/g,
  )) {
    routes.push({
      id: match[1],
      points: [
        [Number(match[2]), Number(match[3])],
        [Number(match[4]), Number(match[5])],
      ],
    });
  }

  return routes;
}

/**
 * Device body rectangles. Matches the `rackdown-device` rect emitted by
 * `renderDevice`, including its blank/shelf variants, and deliberately not the
 * unclassed clipPath rect that precedes it or the `rackdown-device-label` text.
 */
export function extractDeviceRects(svg) {
  const rects = [];
  for (const match of svg.matchAll(
    /<rect class="rackdown-device(?:[^"]*)" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g,
  )) {
    rects.push(toRect(match));
  }
  return rects;
}

/** Rack body rectangles, keyed by the projection they belong to. */
export function extractRackRects(svg) {
  const racks = [];
  for (const match of svg.matchAll(
    /class="rackdown-rack-group rackdown-rack-(\w+)" data-rack-id="([^"]+)"[^>]*>\s*<rect class="rackdown-rack" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g,
  )) {
    racks.push({
      key: `${match[2]}:${match[1]}`,
      x: Number(match[3]),
      y: Number(match[4]),
      w: Number(match[5]),
      h: Number(match[6]),
    });
  }
  return racks;
}

/** Device group rectangles keyed by device id, used to map a device to its rack projection. */
export function extractDeviceRectsById(svg) {
  const byId = new Map();
  for (const match of svg.matchAll(
    /<g id="[^"]*" class="rackdown-device-group[^"]*" data-device-id="([^"]+)"[\s\S]{0,400}?<rect class="rackdown-device(?:[^"]*)" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g,
  )) {
    byId.set(match[1], {
      x: Number(match[2]),
      y: Number(match[3]),
      w: Number(match[4]),
      h: Number(match[5]),
    });
  }
  return byId;
}

/** External identity and placement are semantic; only boxes contribute extents. */
export function extractExternalRects(svg) {
  return [
    ...svg.matchAll(
      /<g [^>]*class="rackdown-external-group"[^>]*data-external-id="([^"]+)"[^>]*data-placement="([^"]+)"[^>]*>\s*<title>[\s\S]*?<\/title>\s*<rect class="rackdown-external-box" x="([-\d.]+)" y="([-\d.]+)" width="([-\d.]+)" height="([-\d.]+)"/g,
    ),
  ].map((match) => ({
    id: match[1],
    placement: match[2],
    x: Number(match[3]),
    y: Number(match[4]),
    w: Number(match[5]),
    h: Number(match[6]),
  }));
}

/** Exact open-interior segment test, including direct-mode diagonal segments. */
export function routeEntersRect(points, rect) {
  return points.slice(1).some((b, index) => {
    const a = points[index];
    let low = 0;
    let high = 1;
    for (const [axis, minimum, maximum] of [
      [0, rect.x + EDGE_EPSILON_MM, rect.x + rect.w - EDGE_EPSILON_MM],
      [1, rect.y + EDGE_EPSILON_MM, rect.y + rect.h - EDGE_EPSILON_MM],
    ]) {
      const delta = b[axis] - a[axis];
      if (delta === 0) {
        if (a[axis] <= minimum || a[axis] >= maximum) return false;
      } else {
        const first = (minimum - a[axis]) / delta;
        const last = (maximum - a[axis]) / delta;
        low = Math.max(low, Math.min(first, last));
        high = Math.min(high, Math.max(first, last));
      }
    }
    return low < high;
  });
}

export function extractViewport(svg) {
  const match = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(svg);
  if (!match) {
    throw new Error('Rendered SVG has no viewBox.');
  }
  return { widthMm: Number(match[3]), heightMm: Number(match[4]) };
}

function toRect(match) {
  return {
    x: Number(match[1]),
    y: Number(match[2]),
    w: Number(match[3]),
    h: Number(match[4]),
  };
}

function contains(rect, x, y) {
  return (
    x >= rect.x + EDGE_EPSILON_MM &&
    x <= rect.x + rect.w - EDGE_EPSILON_MM &&
    y >= rect.y + EDGE_EPSILON_MM &&
    y <= rect.y + rect.h - EDGE_EPSILON_MM
  );
}

function segments(points) {
  return points.slice(1).map((point, index) => [points[index], point]);
}

function segmentLength([a, b]) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** Route length in millimetres, summed over segments. */
export function routeLength(points) {
  return segments(points).reduce((total, seg) => total + segmentLength(seg), 0);
}

/** Direction changes along a route. A straight join between collinear segments is not a bend. */
export function bendCount(points) {
  let bends = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const cross =
      (current[0] - previous[0]) * (next[1] - current[1]) -
      (current[1] - previous[1]) * (next[0] - current[0]);
    if (Math.abs(cross) > BEND_EPSILON) {
      bends += 1;
    }
  }
  return bends;
}

/**
 * Length of a route running inside any of `rects`, by sampling.
 *
 * Sampling rather than exact segment/rectangle clipping: the clipping maths has
 * more edge cases than it is worth here, and at a 0.5mm step the error is far
 * below anything that would change a verdict.
 */
export function lengthInsideRects(points, rects) {
  if (rects.length === 0) {
    return 0;
  }

  let total = 0;
  for (const [a, b] of segments(points)) {
    const length = segmentLength([a, b]);
    if (length === 0) {
      continue;
    }

    const steps = Math.max(2, Math.ceil(length / SAMPLE_STEP_MM));
    let inside = 0;
    for (let step = 0; step < steps; step += 1) {
      const t = (step + 0.5) / steps;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      if (rects.some((rect) => contains(rect, x, y))) {
        inside += 1;
      }
    }
    total += (inside / steps) * length;
  }
  return total;
}

/** True when two segments cross at an interior point of both. */
export function segmentsCross(first, second) {
  const [[x1, y1], [x2, y2]] = first;
  const [[x3, y3], [x4, y4]] = second;

  const denominator = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(denominator) < PARALLEL_EPSILON) {
    return false;
  }

  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / denominator;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / denominator;
  return (
    t > INTERSECTION_EPSILON &&
    t < 1 - INTERSECTION_EPSILON &&
    u > INTERSECTION_EPSILON &&
    u < 1 - INTERSECTION_EPSILON
  );
}

/** Crossings between distinct routes. Self-intersection within one route is not counted. */
export function crossingCount(routes) {
  let crossings = 0;
  for (let i = 0; i < routes.length; i += 1) {
    for (let j = i + 1; j < routes.length; j += 1) {
      for (const first of segments(routes[i].points)) {
        for (const second of segments(routes[j].points)) {
          if (segmentsCross(first, second)) {
            crossings += 1;
          }
        }
      }
    }
  }
  return crossings;
}

/** The rack projection a device rectangle sits within, by centre point. */
function rackKeyForDeviceRect(deviceRect, rackRects) {
  const x = deviceRect.x + deviceRect.w / 2;
  const y = deviceRect.y + deviceRect.h / 2;
  return rackRects.find((rack) => contains(rack, x, y))?.key;
}

/**
 * Compute every measure for one rendered layout.
 *
 * Takes the layout as well as the SVG because endpoint identity is semantic
 * (which devices a connection joins) while geometry is projected (where those
 * devices ended up on the canvas). Only the SVG knows the second.
 */
export function computeMetrics(layout, svg) {
  const routes = extractRoutes(svg);
  const deviceRects = extractDeviceRects(svg);
  const rackRects = extractRackRects(svg);
  const deviceRectById = extractDeviceRectsById(svg);
  const viewport = extractViewport(svg);
  const externalRects = extractExternalRects(svg);

  const rackKeyByDeviceId = new Map();
  for (const [deviceId, rect] of deviceRectById) {
    const key = rackKeyForDeviceRect(rect, rackRects);
    if (key !== undefined) {
      rackKeyByDeviceId.set(deviceId, key);
    }
  }

  const endpointsByConnectionId = new Map(
    layout.connections.map((connection) => [
      connection.id,
      [connection.from, connection.to],
    ]),
  );

  let occludedMm = 0;
  let foreignRackTransitMm = 0;
  let totalLengthMm = 0;
  let bends = 0;
  let externalBoxInteriorRoutes = 0;
  let foreignExternalStemRoutes = 0;
  let localDeviceInteriorRoutes = 0;

  for (const route of routes) {
    totalLengthMm += routeLength(route.points);
    bends += bendCount(route.points);
    occludedMm += lengthInsideRects(route.points, deviceRects);

    const endpoints = endpointsByConnectionId.get(route.id) ?? [];
    const ownExternalIds = new Set(
      endpoints
        .filter((endpoint) => endpoint.kind === 'external')
        .map((endpoint) => endpoint.externalId),
    );
    if (externalRects.some((rect) => routeEntersRect(route.points, rect)))
      externalBoxInteriorRoutes++;
    if (
      externalRects
        .filter(
          (rect) => rect.placement === 'bottom' && !ownExternalIds.has(rect.id),
        )
        .some((rect) =>
          routeEntersRect(route.points, {
            x: rect.x + rect.w / 2 - 1.25,
            y: rect.y - 6,
            w: 2.5,
            h: 6,
          }),
        )
    )
      foreignExternalStemRoutes++;
    const [from, to] = endpoints.map((endpoint) =>
      endpoint.kind === 'device'
        ? deviceRectById.get(endpoint.deviceId)
        : undefined,
    );
    if (
      from &&
      to &&
      from !== to &&
      Math.abs(from.y - to.y) <= 0.001 &&
      Math.abs(from.h - to.h) <= 0.001 &&
      rackKeyForDeviceRect(from, rackRects) ===
        rackKeyForDeviceRect(to, rackRects) &&
      deviceRects.some((rect) => routeEntersRect(route.points, rect))
    )
      localDeviceInteriorRoutes++;

    // Racks this route legitimately terminates in; every other rack is foreign.
    const ownRackKeys = new Set();
    for (const endpoint of endpointsByConnectionId.get(route.id) ?? []) {
      if (endpoint.kind === 'device') {
        const key = rackKeyByDeviceId.get(endpoint.deviceId);
        if (key !== undefined) {
          ownRackKeys.add(key);
        }
      }
    }
    foreignRackTransitMm += lengthInsideRects(
      route.points,
      rackRects.filter((rack) => !ownRackKeys.has(rack.key)),
    );
  }

  return {
    connections: routes.length,
    externalBoxInteriorRoutes,
    foreignExternalStemRoutes,
    localDeviceInteriorRoutes,
    externalRows: new Set(
      externalRects
        .filter((rect) => rect.placement === 'bottom')
        .map((rect) => rect.y),
    ).size,
    crossings: crossingCount(routes),
    occludedMm: round(occludedMm),
    foreignRackTransitMm: round(foreignRackTransitMm),
    totalLengthMm: round(totalLengthMm),
    bends,
    viewportWidthMm: round(viewport.widthMm),
    viewportHeightMm: round(viewport.heightMm),
  };
}

/** Whole millimetres. Sub-millimetre precision is noise at rack scale and makes baselines brittle. */
function round(value) {
  return Math.round(value);
}

/** Metrics where a lower value is better, used by the assert mode's direction check. */
export const LOWER_IS_BETTER = Object.freeze([
  'crossings',
  'externalBoxInteriorRoutes',
  'foreignExternalStemRoutes',
  'localDeviceInteriorRoutes',
  'occludedMm',
  'foreignRackTransitMm',
  'totalLengthMm',
  'bends',
  'viewportWidthMm',
  'viewportHeightMm',
]);
