import type { PointMm, RectMm } from './layout.js';

const RIGHT_LANE_GUTTER_MM = 6.35;
const BOTTOM_LANE_GUTTER_MM = 6.35;
const LANE_SPACING_MM = 4;
const PERIMETER_GUTTER_MM = 12.7;
const TOP_DECORATION_CLEARANCE_MM = 7.5;
const EXIT_STUB_MM = 6.35;
const ATTACHMENT_SPACING_MM = 2.5;
const BEND_PENALTY_MM = 6;
const LANE_USE_PENALTY_MM = 8;
const SCORE_EPSILON = 0.000001;
export const CORRIDOR_LANE_CAPACITY = 6;
export const SHORT_HOP_THRESHOLD_MM = 88.9;
export const LOCAL_SEAM_OFFSET_MM = 6;

/**
 * Nominal corner radius for rounded route elbows, in millimetres.
 *
 * Frozen by the R7 proof on #203. The exit stub is 6.35mm and lane spacing is
 * 4mm, so a 4mm nominal radius would clamp on ordinary stub-adjacent bends and
 * never actually be nominal; 3mm survives the normal stub while still visibly
 * softening the corner. Shorter segments clamp automatically.
 */
export const CONNECTION_CORNER_RADIUS_MM = 3;

/**
 * Space the router may occupy around the projected rack subject before any
 * route is actually drawn.
 *
 * Capped corridors wrap through `peekLane()`'s modulo, so they never allocate
 * past `CORRIDOR_LANE_CAPACITY - 1`. That bounds rack-side and global
 * top/bottom corridors exactly, which lets the renderer reserve a viewport
 * floor instead of letting an occupied outer lane change the apparent rack
 * scale. Uncapped corridors (pair-gap, legacy lanes) can still exceed this;
 * the renderer unions it with actual route extents so nothing is clipped.
 *
 * Kept here, beside the constants it derives from, so a routing-geometry
 * change cannot silently drift away from the renderer's reserved envelope.
 */
export const NORMAL_ROUTING_ENVELOPE_MM: {
  readonly topMm: number;
  readonly rightMm: number;
  readonly bottomMm: number;
  readonly leftMm: number;
} = (() => {
  const lastLaneOffsetMm = (CORRIDOR_LANE_CAPACITY - 1) * LANE_SPACING_MM;
  const sideMm = PERIMETER_GUTTER_MM + lastLaneOffsetMm;
  return {
    topMm: TOP_DECORATION_CLEARANCE_MM + sideMm,
    rightMm: sideMm,
    bottomMm: sideMm,
    leftMm: sideMm,
  };
})();

export type SvgConnectionRouting =
  | 'direct'
  | 'orthogonal'
  | 'lanes'
  | 'perimeter';

export interface SlotBounds {
  topY: number;
  bottomY: number;
  leftX: number;
  rightX: number;
}

export interface RoutingEndpoint {
  anchor: PointMm;
  externalId?: string;
  rackKey?: string | undefined;
  slotBounds?: SlotBounds | undefined;
}

export interface RoutingObstacle {
  rackKey: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

/**
 * Interior tolerance for local-route geometry, in millimetres.
 *
 * Matches `EDGE_EPSILON_MM` in the render-metrics harness so that a route this
 * module admits can never be one the occlusion measure then counts.
 */
const LOCAL_GEOMETRY_EPSILON_MM = 0.01;

/**
 * Equality tolerance for slot intervals and horizontal slot geometry, in
 * millimetres.
 *
 * Deliberately tighter than `LOCAL_GEOMETRY_EPSILON_MM` and deliberately a
 * separate constant: this one asks "are these two shared-row slots the same
 * row?", which ADR 0012 already guarantees exactly, while the geometry epsilon
 * asks "is this route inside a rectangle?". Merging them would loosen one or
 * tighten the other for no reason.
 */
const SLOT_EQUALITY_EPSILON_MM = 0.001;

export function anchorIsOnVerticalBoundary(
  anchorX: number,
  slotBounds: SlotBounds,
): boolean {
  // Safety guard, not an equality test: it decides whether the vertical leg
  // from this anchor rides a slot edge or cuts the device interior. It must not
  // be looser than the interior tolerance it exists to protect.
  return (
    Math.abs(anchorX - slotBounds.leftX) <= LOCAL_GEOMETRY_EPSILON_MM ||
    Math.abs(anchorX - slotBounds.rightX) <= LOCAL_GEOMETRY_EPSILON_MM
  );
}

export function isClassHEligible(
  from: RoutingEndpoint,
  to: RoutingEndpoint,
): boolean {
  if (!from.rackKey || !to.rackKey || from.rackKey !== to.rackKey) {
    return false;
  }
  if (!from.slotBounds || !to.slotBounds) {
    return false;
  }

  const sFrom = from.slotBounds;
  const sTo = to.slotBounds;
  const EPSILON = SLOT_EQUALITY_EPSILON_MM;
  if (
    [sFrom, sTo].some(
      (slot) =>
        !Object.values(slot).every(Number.isFinite) ||
        slot.rightX <= slot.leftX ||
        slot.bottomY <= slot.topY,
    )
  )
    return false;

  if (
    Math.abs(sFrom.topY - sTo.topY) > EPSILON ||
    Math.abs(sFrom.bottomY - sTo.bottomY) > EPSILON
  ) {
    return false;
  }

  if (Math.abs(sFrom.leftX - sTo.leftX) < EPSILON) {
    return false;
  }

  const nonOverlapping =
    sFrom.rightX <= sTo.leftX + EPSILON || sTo.rightX <= sFrom.leftX + EPSILON;
  if (!nonOverlapping) {
    return false;
  }

  if (
    !anchorIsOnVerticalBoundary(from.anchor.xMm, sFrom) ||
    !anchorIsOnVerticalBoundary(to.anchor.xMm, sTo)
  ) {
    return false;
  }

  return true;
}

/**
 * True when an axis-aligned segment passes through a rectangle's interior.
 *
 * Contact with a rectangle boundary is legal. Local presentation attachments
 * and external targets terminate on boundaries; only penetration of the open
 * interior counts.
 *
 * Both the segment and the rectangle are axis-aligned, so overlap is exactly
 * the conjunction of the two per-axis overlaps — no clipping or sampling
 * needed, and the segment degenerate in one axis is handled by the same test.
 */
export function segmentEntersRectInterior(
  a: PointMm,
  b: PointMm,
  rect: RectMm,
): boolean {
  const epsilon = LOCAL_GEOMETRY_EPSILON_MM;
  const minX = Math.min(a.xMm, b.xMm);
  const maxX = Math.max(a.xMm, b.xMm);
  const minY = Math.min(a.yMm, b.yMm);
  const maxY = Math.max(a.yMm, b.yMm);

  const overlapsX =
    maxX > rect.xMm + epsilon && minX < rect.xMm + rect.widthMm - epsilon;
  const overlapsY =
    maxY > rect.yMm + epsilon && minY < rect.yMm + rect.heightMm - epsilon;

  return overlapsX && overlapsY;
}

/**
 * True when no segment of a local candidate route penetrates a device interior.
 *
 * Checks the *whole* logical route rather than the seam scanline alone. The
 * scanline-only predicate this replaces could not see a device that intersects
 * one of the short vertical transition legs while leaving the seam itself
 * clear, which a fractional-U device immediately above or below the row does.
 */
export function localRouteIsClear(
  rackKey: string,
  route: readonly PointMm[],
  obstacles: readonly RoutingObstacle[],
): boolean {
  const relevant = obstacles.filter((obstacle) => obstacle.rackKey === rackKey);
  if (relevant.length === 0) {
    return true;
  }

  for (let index = 1; index < route.length; index += 1) {
    const a = route[index - 1];
    const b = route[index];
    if (a === undefined || b === undefined) {
      continue;
    }
    for (const obstacle of relevant) {
      if (segmentEntersRectInterior(a, b, obstacle)) {
        return false;
      }
    }
  }

  return true;
}

/**
 * True when every point of a local candidate route is inside or on the boundary
 * of its own rack rectangle.
 *
 * A local route is in-rack presentation geometry, so it must never leave the
 * rack and come back — that shape is perimeter corridor transit, which #203 R1
 * forbids, and above a rack it would also cross the reserved title band. The
 * rack rectangle is convex and every segment is axis-aligned, so testing the
 * vertices is sufficient for the whole polyline.
 */
function routeIsWithinRack(
  route: readonly PointMm[],
  rack: RoutingRack,
): boolean {
  const epsilon = LOCAL_GEOMETRY_EPSILON_MM;
  return route.every(
    (point) =>
      point.xMm >= rack.xMm - epsilon &&
      point.xMm <= rack.xMm + rack.widthMm + epsilon &&
      point.yMm >= rack.yMm - epsilon &&
      point.yMm <= rack.yMm + rack.heightMm + epsilon,
  );
}

/** Exact separation of axis-aligned segment centre lines, including endpoints. */
function localRoutesAreSeparated(
  route: readonly PointMm[],
  other: readonly PointMm[],
): boolean {
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1] as PointMm;
    const b = route[i] as PointMm;
    for (let j = 1; j < other.length; j++) {
      const c = other[j - 1] as PointMm;
      const d = other[j] as PointMm;
      const gapX = Math.max(
        0,
        Math.max(Math.min(a.xMm, b.xMm), Math.min(c.xMm, d.xMm)) -
          Math.min(Math.max(a.xMm, b.xMm), Math.max(c.xMm, d.xMm)),
      );
      const gapY = Math.max(
        0,
        Math.max(Math.min(a.yMm, b.yMm), Math.min(c.yMm, d.yMm)) -
          Math.min(Math.max(a.yMm, b.yMm), Math.max(c.yMm, d.yMm)),
      );
      if (Math.hypot(gapX, gapY) < ATTACHMENT_SPACING_MM - SCORE_EPSILON)
        return false;
    }
  }
  return true;
}

/** A rounded elbow stays within its approach/control/departure bounding box. */
function localVerticalElbowsAreClear(
  route: readonly PointMm[],
  obstacles: readonly RectMm[],
): boolean {
  for (let i = 1; i < route.length - 1; i++) {
    const previous = route[i - 1] as PointMm;
    const corner = route[i] as PointMm;
    const next = route[i + 1] as PointMm;
    const incoming = Math.hypot(
      previous.xMm - corner.xMm,
      previous.yMm - corner.yMm,
    );
    const outgoing = Math.hypot(next.xMm - corner.xMm, next.yMm - corner.yMm);
    const radius = Math.min(
      CONNECTION_CORNER_RADIUS_MM,
      incoming / 2,
      outgoing / 2,
    );
    const approach = {
      xMm: corner.xMm + ((previous.xMm - corner.xMm) * radius) / incoming,
      yMm: corner.yMm + ((previous.yMm - corner.yMm) * radius) / incoming,
    };
    const departure = {
      xMm: corner.xMm + ((next.xMm - corner.xMm) * radius) / outgoing,
      yMm: corner.yMm + ((next.yMm - corner.yMm) * radius) / outgoing,
    };
    const left = Math.min(approach.xMm, corner.xMm, departure.xMm);
    const right = Math.max(approach.xMm, corner.xMm, departure.xMm);
    const top = Math.min(approach.yMm, corner.yMm, departure.yMm);
    const bottom = Math.max(approach.yMm, corner.yMm, departure.yMm);
    if (
      obstacles.some(
        (rect) =>
          Math.min(right, rect.xMm + rect.widthMm) >
            Math.max(left, rect.xMm) + LOCAL_GEOMETRY_EPSILON_MM &&
          Math.min(bottom, rect.yMm + rect.heightMm) >
            Math.max(top, rect.yMm) + LOCAL_GEOMETRY_EPSILON_MM,
      )
    )
      return false;
  }
  return true;
}

function slotRectangle(bounds: SlotBounds, rackKey: string): RoutingObstacle {
  return {
    rackKey,
    xMm: bounds.leftX,
    yMm: bounds.topY,
    widthMm: bounds.rightX - bounds.leftX,
    heightMm: bounds.bottomY - bounds.topY,
  };
}

/** Renderer-owned callout presentation, separate from semantic RackLayout. */
export interface RoutingBottomExternal {
  id: string;
  placement: 'bottom';
  box: RectMm;
  target: PointMm;
  protectedApproach: RectMm;
  approachY: number;
}

export function bottomExternalRouteIsClear(
  route: readonly PointMm[],
  targetId: string,
  racks: readonly RoutingRack[],
  devices: readonly RoutingObstacle[],
  externals: readonly RoutingBottomExternal[],
): boolean {
  const rectangles: RectMm[] = [
    ...racks,
    ...devices,
    ...externals.map((external) => external.box),
    ...externals
      .filter((external) => external.id !== targetId)
      .map((external) => external.protectedApproach),
  ];
  return route
    .slice(1)
    .every((point, index) =>
      rectangles.every(
        (rect) =>
          !segmentEntersRectInterior(route[index] as PointMm, point, rect),
      ),
    );
}

export interface RoutingConnection {
  id: string;
  from: RoutingEndpoint;
  to: RoutingEndpoint;
}

export interface RoutingRack {
  key: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

type HorizontalSide = 'left' | 'right';
type PerimeterChannel = 'top' | 'bottom';

export type CorridorAxis = 'x' | 'y';

export type RoutingCorridorId =
  | `rack:${string}:left`
  | `rack:${string}:right`
  | 'global:top'
  | 'global:bottom'
  | `gap:${string}`;

export interface RoutingCorridor {
  readonly id: RoutingCorridorId;
  readonly axis: CorridorAxis;
  readonly capacity?: number | undefined;
  allocations: number;
  coordinate(laneIndex: number, requestBaseMm?: number): number;
}

export interface CorridorLanePreview {
  readonly corridor: RoutingCorridor;
  readonly index: number;
  readonly coordinateMm: number;
  readonly pressure: number;
}

export function peekLane(
  corridor: RoutingCorridor,
  requestBaseMm?: number,
): CorridorLanePreview {
  const cap = corridor.capacity;
  const index =
    cap === undefined || corridor.allocations < cap
      ? corridor.allocations
      : corridor.allocations % cap;
  return {
    corridor,
    index,
    coordinateMm: corridor.coordinate(index, requestBaseMm),
    pressure: corridor.allocations,
  };
}

export function consumeLane(preview: CorridorLanePreview): number {
  const index = preview.index;
  preview.corridor.allocations += 1;
  return index;
}

function rackCorridorId(
  rackKey: string,
  side: HorizontalSide,
): RoutingCorridorId {
  return `rack:${rackKey}:${side}`;
}

function globalCorridorId(channel: PerimeterChannel): RoutingCorridorId {
  return channel === 'top' ? 'global:top' : 'global:bottom';
}

function gapCorridorId(pairKey: string): RoutingCorridorId {
  return `gap:${pairKey}`;
}

interface Attachment {
  point: PointMm;
  stub: PointMm;
}

interface RouteCandidate {
  route: PointMm[];
  score: number;
}

function samePoint(left: PointMm, right: PointMm): boolean {
  return left.xMm === right.xMm && left.yMm === right.yMm;
}

function compactRoute(points: readonly PointMm[]): PointMm[] {
  const compacted: PointMm[] = [];
  for (const point of points) {
    const previous = compacted.at(-1);
    if (!previous || !samePoint(previous, point)) {
      compacted.push({ ...point });
    }
  }
  return compacted;
}

function orthogonalRoute(from: PointMm, to: PointMm): PointMm[] {
  if (from.xMm === to.xMm || from.yMm === to.yMm) {
    return compactRoute([from, to]);
  }

  const middleX = (from.xMm + to.xMm) / 2;
  return compactRoute([
    from,
    { xMm: middleX, yMm: from.yMm },
    { xMm: middleX, yMm: to.yMm },
    to,
  ]);
}

function directRoute(from: PointMm, to: PointMm): PointMm[] {
  return compactRoute([from, to]);
}

/**
 * Lane offset for pair-gap attempt `index`, in millimetres.
 *
 * The sequence is 0, +1, -1, +2, -2, … scaled by `LANE_SPACING_MM`, so
 * successive attempts fan outwards around the base Y they asked for rather than
 * walking continuously in one direction. A displaced route therefore stays as
 * close to its requested channel as the attempts so far allow, instead of the
 * whole bundle drifting steadily away from the geometry it belongs to.
 */
function alternatingOffset(index: number): number {
  if (index === 0) {
    return 0;
  }
  const distance = Math.ceil(index / 2) * LANE_SPACING_MM;
  return index % 2 === 1 ? distance : -distance;
}

function connectionPairKey(left: string, right: string): string {
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function visualEndpointKey(endpoint: RoutingEndpoint): string | undefined {
  return endpoint.rackKey === undefined
    ? undefined
    : `${endpoint.rackKey}:${endpoint.anchor.xMm}:${endpoint.anchor.yMm}`;
}

function endpointOccurrenceKey(
  connectionId: string,
  endpoint: 'from' | 'to',
): string {
  return `${connectionId}:${endpoint}`;
}

function routeLength(points: readonly PointMm[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (!previous || !point) {
      continue;
    }
    length +=
      Math.abs(point.xMm - previous.xMm) + Math.abs(point.yMm - previous.yMm);
  }
  return length;
}

function bendCount(points: readonly PointMm[]): number {
  let bends = 0;
  let previousDirection: 'horizontal' | 'vertical' | undefined;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    if (!previous || !point) {
      continue;
    }
    const direction =
      previous.yMm === point.yMm
        ? 'horizontal'
        : previous.xMm === point.xMm
          ? 'vertical'
          : undefined;
    if (
      direction !== undefined &&
      previousDirection !== undefined &&
      direction !== previousDirection
    ) {
      bends += 1;
    }
    if (direction !== undefined) {
      previousDirection = direction;
    }
  }

  return bends;
}

function routeScore(points: readonly PointMm[], laneUse = 0): number {
  return (
    routeLength(points) +
    bendCount(points) * BEND_PENALTY_MM +
    laneUse * LANE_USE_PENALTY_MM
  );
}

function bestCandidate<T extends RouteCandidate>(candidates: readonly T[]): T {
  const first = candidates[0];
  if (!first) {
    throw new Error('At least one route candidate is required.');
  }

  let best = first;
  for (const candidate of candidates.slice(1)) {
    if (candidate.score < best.score - SCORE_EPSILON) {
      best = candidate;
    }
  }
  return best;
}

function geometryOrderedConnections(
  connections: readonly RoutingConnection[],
): readonly RoutingConnection[] {
  return connections
    .map((connection, index) => ({
      connection,
      index,
      meanY: (connection.from.anchor.yMm + connection.to.anchor.yMm) / 2,
    }))
    .sort((left, right) => {
      if (left.meanY !== right.meanY) {
        return left.meanY - right.meanY;
      }
      return left.index - right.index;
    })
    .map((entry) => entry.connection);
}

/** Outer extent of the projected rack subject, in millimetres. */
interface RoutingSubjectBounds {
  topY: number;
  rightX: number;
  bottomY: number;
  leftX: number;
}

/**
 * Extent of the projected rack subject, seeded at the origin rather than at the
 * first rack.
 *
 * The `0` seed is load-bearing twice over, so it is not the usual "any value
 * will do" reduce accumulator. It lets an empty rack collection return usable
 * bounds instead of infinities, and it keeps the projected scene origin part of
 * the routing subject: `leftX` and `topY` can never exceed 0, and `rightX` and
 * `bottomY` can never fall below it, whatever the racks themselves do.
 *
 * That zero anchor matches the rack-subject basis the renderer uses when
 * applying `NORMAL_ROUTING_ENVELOPE_MM` (#257). Seeding from the first rack
 * instead could let the corridors these bounds place and the envelope the
 * renderer reserves disagree when layouts no longer begin at the origin.
 */
function routingSubjectBounds(
  racks: readonly RoutingRack[],
): RoutingSubjectBounds {
  return {
    topY: racks.reduce(
      (minimum, rack) =>
        Math.min(minimum, rack.yMm - TOP_DECORATION_CLEARANCE_MM),
      0,
    ),
    rightX: racks.reduce(
      (maximum, rack) => Math.max(maximum, rack.xMm + rack.widthMm),
      0,
    ),
    bottomY: racks.reduce(
      (maximum, rack) => Math.max(maximum, rack.yMm + rack.heightMm),
      0,
    ),
    leftX: racks.reduce((minimum, rack) => Math.min(minimum, rack.xMm), 0),
  };
}

/** Side or channel an external target is routed towards. */
type ExternalRegion = HorizontalSide | PerimeterChannel;

/**
 * Pick the side or channel an external target leaves by.
 *
 * Precedence is deliberate and horizontal-first: a target clearly beyond the
 * subject on the X axis takes that side even when it also sits above or below
 * the racks, so an annotation off to the right leaves rightwards rather than
 * diving under the whole diagram to reach the same place.
 *
 * The final case is the one worth stating. A target that falls *inside* the
 * overall subject bounds has no side of its own to claim, so it is assigned one
 * by the horizontal midpoint of its own device's rack: left when it sits in
 * that rack's left half, right otherwise. Splitting on the device rack rather
 * than on the subject keeps the annotation on the side it already leans towards
 * instead of pushing every interior target to one edge of the diagram.
 */
function classifyExternalRegion(
  external: PointMm,
  rack: RoutingRack,
  subject: RoutingSubjectBounds,
): ExternalRegion {
  if (external.xMm > subject.rightX) {
    return 'right';
  }
  if (external.xMm < subject.leftX) {
    return 'left';
  }
  if (external.yMm > subject.bottomY) {
    return 'bottom';
  }
  if (external.yMm < subject.topY) {
    return 'top';
  }
  return external.xMm < rack.xMm + rack.widthMm / 2 ? 'left' : 'right';
}

/**
 * Compute deterministic renderer-owned connection routes.
 *
 * `lanes` is the original small proof: same-rack connections use successive
 * right-side lanes, while cross-rack and external routes use bottom lanes.
 *
 * `perimeter` treats attachment geometry as approximate presentation rather
 * than physical port location. Shared semantic endpoints fan slightly, route
 * candidates stay outside rack bodies where practical, and stable scoring
 * prefers shorter paths with fewer bends and less-used perimeter corridors.
 */
export function routeConnections(
  connections: readonly RoutingConnection[],
  racks: readonly RoutingRack[],
  mode: SvgConnectionRouting,
  obstacles: readonly RoutingObstacle[] = [],
  bottomExternals: readonly RoutingBottomExternal[] = [],
): Map<string, PointMm[]> {
  const routes = new Map<string, PointMm[]>();
  const rackByKey = new Map(racks.map((rack) => [rack.key, rack]));
  const rightLaneUse = new Map<string, number>();
  const corridors = new Map<RoutingCorridorId, RoutingCorridor>();
  const incidentTotals = new Map<string, number>();
  const attachmentSlots = new Map<string, number>();
  const incidentAssigned = new Map<string, number>();
  const subject = routingSubjectBounds(racks);
  let bottomLaneIndex = 0;
  const classHRoutes = new Map<string, PointMm[]>();
  // Only accepted H and vertical routes occupy this independent local space.
  const localVerticalOccupancy = new Map<string, PointMm[][]>();
  // Presentation occupancy is per projected slot and side, independent of ports.
  const localSlots: Array<{
    rackKey: string;
    bounds: SlotBounds;
    top: Set<number>;
    bottom: Set<number>;
  }> = [];
  const localRows: Array<{
    rackKey: string;
    topY: number;
    bottomY: number;
    top: Array<Array<[number, number]>>;
    bottom: Array<Array<[number, number]>>;
  }> = [];
  const near = (a: number, b: number) =>
    Math.abs(a - b) <= SLOT_EQUALITY_EPSILON_MM;
  function localSlot(rackKey: string, bounds: SlotBounds) {
    let state = localSlots.find(
      (slot) =>
        slot.rackKey === rackKey &&
        near(slot.bounds.leftX, bounds.leftX) &&
        near(slot.bounds.rightX, bounds.rightX) &&
        near(slot.bounds.topY, bounds.topY) &&
        near(slot.bounds.bottomY, bounds.bottomY),
    );
    if (!state) {
      state = {
        rackKey,
        bounds,
        top: new Set<number>(),
        bottom: new Set<number>(),
      };
    }
    return state;
  }

  // #203 R4: perimeter allocation runs in geometry order so corridor lanes are
  // handed out top-down regardless of source order. This orders allocator state
  // only — emission order stays the renderer's business.
  const allocationConnections =
    mode === 'perimeter'
      ? geometryOrderedConnections(connections)
      : connections;

  for (const connection of connections) {
    for (const endpoint of [connection.from, connection.to]) {
      const key = visualEndpointKey(endpoint);
      if (key !== undefined) {
        incidentTotals.set(key, (incidentTotals.get(key) ?? 0) + 1);
      }
    }
  }

  for (const connection of allocationConnections) {
    for (const [name, endpoint] of [
      ['from', connection.from] as const,
      ['to', connection.to] as const,
    ]) {
      const key = visualEndpointKey(endpoint);
      if (key === undefined) {
        continue;
      }
      const slot = incidentAssigned.get(key) ?? 0;
      incidentAssigned.set(key, slot + 1);
      attachmentSlots.set(endpointOccurrenceKey(connection.id, name), slot);
    }
  }

  function attachment(
    connectionId: string,
    endpointName: 'from' | 'to',
    endpoint: RoutingEndpoint,
    side: HorizontalSide,
  ): Attachment {
    const rack =
      endpoint.rackKey === undefined
        ? undefined
        : rackByKey.get(endpoint.rackKey);
    const key = visualEndpointKey(endpoint);
    if (!rack || key === undefined) {
      return {
        point: { ...endpoint.anchor },
        stub: { ...endpoint.anchor },
      };
    }

    const index =
      attachmentSlots.get(endpointOccurrenceKey(connectionId, endpointName)) ??
      0;
    const total = incidentTotals.get(key) ?? 1;
    // Occurrence indexes are centred on the shared semantic endpoint. The
    // `(total - 1) / 2` term shifts the run so the first index sits as far
    // above the anchor as the last sits below it, which makes N incident
    // connections fan symmetrically about the anchor instead of all drifting
    // off it in one direction. A single connection lands exactly on it.
    const offset = (index - (total - 1) / 2) * ATTACHMENT_SPACING_MM;
    let attachmentY = endpoint.anchor.yMm + offset;
    const slot = endpoint.slotBounds;
    if (
      total > 1 &&
      slot !== undefined &&
      Number.isFinite(slot.topY) &&
      Number.isFinite(slot.bottomY) &&
      slot.bottomY > slot.topY
    ) {
      const half = ((total - 1) * ATTACHMENT_SPACING_MM) / 2;
      if (
        endpoint.anchor.yMm - half < slot.topY ||
        endpoint.anchor.yMm + half > slot.bottomY
      ) {
        // Compress only overflowing fans; ordinary attachments keep their
        // existing calculation. Use the full slot without an inset.
        const spacing = Math.min(
          ATTACHMENT_SPACING_MM,
          (slot.bottomY - slot.topY) / (total - 1),
        );
        attachmentY =
          (slot.topY + slot.bottomY) / 2 + (index - (total - 1) / 2) * spacing;
      }
    }
    const point = {
      xMm: side === 'right' ? rack.xMm + rack.widthMm : rack.xMm,
      yMm: attachmentY,
    };
    return {
      point,
      stub: {
        xMm: point.xMm + (side === 'right' ? EXIT_STUB_MM : -EXIT_STUB_MM),
        yMm: point.yMm,
      },
    };
  }

  /** Both ends of one connection attached to the rack faces they leave by. */
  function attachmentPair(
    connection: RoutingConnection,
    fromSide: HorizontalSide,
    toSide: HorizontalSide,
  ): { from: Attachment; to: Attachment } {
    return {
      from: attachment(connection.id, 'from', connection.from, fromSide),
      to: attachment(connection.id, 'to', connection.to, toSide),
    };
  }

  function rackCorridor(
    rack: RoutingRack,
    side: HorizontalSide,
  ): RoutingCorridor {
    const id = rackCorridorId(rack.key, side);
    let corridor = corridors.get(id);
    if (!corridor) {
      corridor = {
        id,
        axis: 'x',
        capacity: CORRIDOR_LANE_CAPACITY,
        allocations: 0,
        coordinate(laneIndex: number) {
          return side === 'right'
            ? rack.xMm +
                rack.widthMm +
                PERIMETER_GUTTER_MM +
                laneIndex * LANE_SPACING_MM
            : rack.xMm - PERIMETER_GUTTER_MM - laneIndex * LANE_SPACING_MM;
        },
      };
      corridors.set(id, corridor);
    }
    return corridor;
  }

  function globalCorridor(channel: PerimeterChannel): RoutingCorridor {
    const id = globalCorridorId(channel);
    let corridor = corridors.get(id);
    if (!corridor) {
      corridor = {
        id,
        axis: 'y',
        capacity: CORRIDOR_LANE_CAPACITY,
        allocations: 0,
        coordinate(laneIndex: number) {
          return channel === 'top'
            ? subject.topY - PERIMETER_GUTTER_MM - laneIndex * LANE_SPACING_MM
            : subject.bottomY +
                PERIMETER_GUTTER_MM +
                laneIndex * LANE_SPACING_MM;
        },
      };
      corridors.set(id, corridor);
    }
    return corridor;
  }

  function gapCorridor(pairKey: string): RoutingCorridor {
    const id = gapCorridorId(pairKey);
    let corridor = corridors.get(id);
    if (!corridor) {
      corridor = {
        id,
        axis: 'y',
        capacity: undefined,
        allocations: 0,
        coordinate(laneIndex: number, requestBaseMm = 0) {
          return requestBaseMm + alternatingOffset(laneIndex);
        },
      };
      corridors.set(id, corridor);
    }
    return corridor;
  }

  function horizontalPathIsClear(
    startX: number,
    endX: number,
    yMm: number,
    excludedRackKeys: ReadonlySet<string>,
  ): boolean {
    const minimumX = Math.min(startX, endX);
    const maximumX = Math.max(startX, endX);

    return racks.every((rack) => {
      if (excludedRackKeys.has(rack.key)) {
        return true;
      }
      const overlapsY = yMm >= rack.yMm && yMm <= rack.yMm + rack.heightMm;
      const overlapsX =
        maximumX >= rack.xMm && minimumX <= rack.xMm + rack.widthMm;
      return !(overlapsX && overlapsY);
    });
  }

  function channelCandidates(
    fromAttachment: Attachment,
    toAttachment: Attachment,
  ): Array<
    RouteCandidate & { preview: CorridorLanePreview; channel: PerimeterChannel }
  > {
    return (['top', 'bottom'] as const).map((channel) => {
      const corridor = globalCorridor(channel);
      const preview = peekLane(corridor);
      const laneY = preview.coordinateMm;
      const route = compactRoute([
        fromAttachment.point,
        fromAttachment.stub,
        { xMm: fromAttachment.stub.xMm, yMm: laneY },
        { xMm: toAttachment.stub.xMm, yMm: laneY },
        toAttachment.stub,
        toAttachment.point,
      ]);
      return {
        preview,
        channel,
        route,
        score: routeScore(route, preview.pressure),
      };
    });
  }

  /** C3 local presentation: top first, then bottom, then existing perimeter. */
  function classHRoute(connection: RoutingConnection): PointMm[] | undefined {
    if (!isClassHEligible(connection.from, connection.to)) return undefined;
    const rackKey = connection.from.rackKey as string;
    const rack = rackByKey.get(rackKey);
    if (!rack) return undefined;
    const from = connection.from.slotBounds as SlotBounds;
    const to = connection.to.slotBounds as SlotBounds;
    const reversed = from.leftX > to.leftX;
    const [left, right] = reversed ? [to, from] : [from, to];
    const leftState = localSlot(rackKey, left);
    const rightState = localSlot(rackKey, right);
    let row = localRows.find(
      (candidate) =>
        candidate.rackKey === rackKey &&
        near(candidate.topY, left.topY) &&
        near(candidate.bottomY, left.bottomY),
    );
    if (!row) {
      row = {
        rackKey,
        topY: left.topY,
        bottomY: left.bottomY,
        top: [[], [], []],
        bottom: [[], [], []],
      };
    }
    const offsets = [0, -2.5, 2.5];
    for (const side of ['top', 'bottom'] as const) {
      for (const [li, lo] of offsets.entries()) {
        const lx = (left.leftX + left.rightX) / 2 + lo;
        if (leftState[side].has(li) || lx < left.leftX || lx > left.rightX)
          continue;
        for (const [ri, ro] of offsets.entries()) {
          const rx = (right.leftX + right.rightX) / 2 + ro;
          if (rightState[side].has(ri) || rx < right.leftX || rx > right.rightX)
            continue;
          for (const [track, distance] of [6, 10, 14].entries()) {
            const intervals = row[side][track] as Array<[number, number]>;
            if (
              intervals.some(
                ([start, end]) => !(rx + 2.5 <= start || lx >= end + 2.5),
              )
            )
              continue;
            const seam =
              side === 'top'
                ? Math.min(left.topY, right.topY) - distance
                : Math.max(left.bottomY, right.bottomY) + distance;
            const route = compactRoute([
              { xMm: lx, yMm: side === 'top' ? left.topY : left.bottomY },
              { xMm: lx, yMm: seam },
              { xMm: rx, yMm: seam },
              { xMm: rx, yMm: side === 'top' ? right.topY : right.bottomY },
            ]);
            if (
              !routeIsWithinRack(route, rack) ||
              !localRouteIsClear(rackKey, route, obstacles)
            )
              continue;
            // Even approximate identity representatives are committed only on
            // acceptance: a rejected row must not seed later equality groups.
            if (!localSlots.includes(leftState)) localSlots.push(leftState);
            if (!localSlots.includes(rightState)) localSlots.push(rightState);
            if (!localRows.includes(row)) localRows.push(row);
            leftState[side].add(li);
            rightState[side].add(ri);
            intervals.push([lx, rx]);
            return reversed ? route.reverse() : route;
          }
        }
      }
    }
    return undefined;
  }

  /** Facing-edge presentation for the existing non-consuming Class V range. */
  function localVerticalRoute(
    connection: RoutingConnection,
  ): PointMm[] | undefined {
    const rackKey = connection.from.rackKey;
    if (rackKey === undefined || connection.to.rackKey !== rackKey)
      return undefined;
    const rack = rackByKey.get(rackKey);
    const from = connection.from.slotBounds;
    const to = connection.to.slotBounds;
    if (!rack || !from || !to) return undefined;
    if (
      [from, to].some(
        (slot) =>
          !Object.values(slot).every(Number.isFinite) ||
          slot.leftX >= slot.rightX ||
          slot.topY >= slot.bottomY,
      )
    )
      return undefined;

    // Do not intercept lane-consuming long routes: later perimeter allocations
    // and the precomputed attachment fans must remain exactly as before.
    const deltaY = Math.abs(
      connection.from.anchor.yMm - connection.to.anchor.yMm,
    );
    if (!(deltaY > 1e-3 && deltaY <= SHORT_HOP_THRESHOLD_MM)) return undefined;
    const upper = from.bottomY <= to.topY ? from : to;
    const lower = upper === from ? to : from;
    if (lower.topY - upper.bottomY <= LOCAL_GEOMETRY_EPSILON_MM)
      return undefined;
    const left = Math.max(from.leftX, to.leftX);
    const right = Math.min(from.rightX, to.rightX);
    if (right - left <= LOCAL_GEOMETRY_EPSILON_MM) return undefined;

    const preferredX = (left + right) / 2;
    const positions = [0, -ATTACHMENT_SPACING_MM, ATTACHMENT_SPACING_MM]
      .map((offset) => preferredX + offset)
      .filter((x) => x >= left && x <= right);
    const candidates = positions.map((xMm) => [
      { xMm, yMm: upper.bottomY },
      { xMm, yMm: lower.topY },
    ]);
    const seamY = (upper.bottomY + lower.topY) / 2;
    const doglegs: PointMm[][] = [];
    for (const upperX of positions) {
      for (const lowerX of positions) {
        if (upperX === lowerX) continue;
        doglegs.push([
          { xMm: upperX, yMm: upper.bottomY },
          { xMm: upperX, yMm: seamY },
          { xMm: lowerX, yMm: seamY },
          { xMm: lowerX, yMm: lower.topY },
        ]);
      }
    }
    // All Z candidates have two bends. Stable length sorting retains upper,
    // then lower fan order on ties. At most three straights and six Z routes.
    doglegs.sort((a, b) => routeLength(a) - routeLength(b));
    candidates.push(...doglegs);
    const relevantObstacles = [
      ...obstacles.filter((obstacle) => obstacle.rackKey === rackKey),
      // Endpoint bodies are required even if an internal caller omitted them.
      slotRectangle(from, rackKey),
      slotRectangle(to, rackKey),
    ];
    const occupied = localVerticalOccupancy.get(rackKey) ?? [];
    for (const route of candidates) {
      if (
        !routeIsWithinRack(route, rack) ||
        !localRouteIsClear(rackKey, route, relevantObstacles) ||
        !localVerticalElbowsAreClear(route, relevantObstacles) ||
        occupied.some((other) => !localRoutesAreSeparated(route, other))
      )
        continue;
      // Commit only after every check; rejected candidates consume no state.
      occupied.push(route);
      localVerticalOccupancy.set(rackKey, occupied);
      return upper === from ? route : [...route].reverse();
    }
    return undefined;
  }

  /**
   * Same-rack perimeter routing: a #203 R5 Class V short hop, otherwise a lane
   * in one of the rack's own side corridors.
   */
  function sameRackPerimeterRoute(
    connection: RoutingConnection,
  ): PointMm[] | undefined {
    const rackKey = connection.from.rackKey;
    if (rackKey === undefined || connection.to.rackKey !== rackKey) {
      return undefined;
    }
    const rack = rackByKey.get(rackKey);
    if (!rack) {
      return undefined;
    }

    const deltaY = Math.abs(
      connection.to.anchor.yMm - connection.from.anchor.yMm,
    );

    // Class V: a short vertical hop runs stub-to-stub up the rack face. It
    // scores against current corridor pressure so a congested side is still
    // avoided, but it never reaches the lane itself and so deliberately does
    // not call consumeLane() — previewing pressure is not occupying a lane.
    if (deltaY > 1e-3 && deltaY <= SHORT_HOP_THRESHOLD_MM) {
      const candidates = (['right', 'left'] as const).map((side) => {
        const preview = peekLane(rackCorridor(rack, side));
        const { from, to } = attachmentPair(connection, side, side);
        const route = compactRoute([from.point, from.stub, to.stub, to.point]);
        return {
          preview,
          side,
          route,
          score: routeScore(route, preview.pressure),
        };
      });
      return bestCandidate(candidates).route;
    }

    const candidates = (['right', 'left'] as const).map((side) => {
      const preview = peekLane(rackCorridor(rack, side));
      const { from, to } = attachmentPair(connection, side, side);
      const route = compactRoute([
        from.point,
        from.stub,
        { xMm: preview.coordinateMm, yMm: from.stub.yMm },
        { xMm: preview.coordinateMm, yMm: to.stub.yMm },
        to.stub,
        to.point,
      ]);
      return {
        preview,
        side,
        route,
        score: routeScore(route, preview.pressure),
      };
    });
    // Only the winner's preview is consumed; the rejected side keeps its lane.
    const best = bestCandidate(candidates);
    consumeLane(best.preview);
    return best.route;
  }

  /**
   * Cross-rack perimeter routing: the gap between the two racks first, then the
   * global top/bottom channels when that gap is blocked.
   */
  function crossRackPerimeterRoute(
    connection: RoutingConnection,
  ): PointMm[] | undefined {
    const fromRackKey = connection.from.rackKey;
    const toRackKey = connection.to.rackKey;
    if (fromRackKey === undefined || toRackKey === undefined) {
      return undefined;
    }
    const fromRack = rackByKey.get(fromRackKey);
    const toRack = rackByKey.get(toRackKey);
    if (!fromRack || !toRack) {
      return undefined;
    }

    const fromIsLeft = fromRack.xMm <= toRack.xMm;
    const { from, to } = attachmentPair(
      connection,
      fromIsLeft ? 'right' : 'left',
      fromIsLeft ? 'left' : 'right',
    );

    const corridor = gapCorridor(connectionPairKey(fromRackKey, toRackKey));
    const baseY = (from.stub.yMm + to.stub.yMm) / 2;
    const preview = peekLane(corridor, baseY);
    // #203 R2: the pair-gap ordinal advances on *attempt*, not on success, so
    // this preview is consumed before the route is known to be usable. It is
    // the router's one deliberate exception to winner-only advancement: the
    // ordinal counts attempts on this rack pair rather than occupied physical
    // lanes, which is what stops two blocked routes from both retrying the same
    // base Y. Moving this below the clearance test would silently change
    // allocation for every later connection sharing the pair.
    consumeLane(preview);
    const channelY = preview.coordinateMm;
    const gapRoute = compactRoute([
      from.point,
      from.stub,
      { xMm: from.stub.xMm, yMm: channelY },
      { xMm: to.stub.xMm, yMm: channelY },
      to.stub,
      to.point,
    ]);
    if (
      horizontalPathIsClear(from.stub.xMm, to.stub.xMm, channelY, new Set())
    ) {
      return gapRoute;
    }

    const best = bestCandidate(channelCandidates(from, to));
    consumeLane(best.preview);
    return best.route;
  }

  /**
   * External-reference perimeter routing.
   *
   * Only meaningful when exactly one endpoint is a device. Deriving the
   * endpoints from that condition keeps `externalEndpoint` structurally
   * external: a connection whose endpoints are both devices cannot enter this
   * branch even if a rack key fails to resolve, and falls through to the safe
   * fallback route instead.
   */
  function externalPerimeterRoute(
    connection: RoutingConnection,
  ): PointMm[] | undefined {
    const fromIsDevice = connection.from.rackKey !== undefined;
    const toIsDevice = connection.to.rackKey !== undefined;
    if (fromIsDevice === toIsDevice) {
      return undefined;
    }

    const deviceIsFrom = fromIsDevice;
    const deviceEndpoint = deviceIsFrom ? connection.from : connection.to;
    const externalEndpoint = deviceIsFrom ? connection.to : connection.from;
    const deviceRackKey = deviceEndpoint.rackKey;
    const rack =
      deviceRackKey === undefined ? undefined : rackByKey.get(deviceRackKey);
    if (!rack || deviceRackKey === undefined) {
      return undefined;
    }

    const external = externalEndpoint.anchor;
    const endpointName = deviceIsFrom ? 'from' : 'to';
    // Every candidate below is built device-first, so the whole strategy can
    // ignore direction and re-orient once at the end.
    const oriented = (route: PointMm[]): PointMm[] =>
      deviceIsFrom ? route : [...route].reverse();

    const bottomExternal = bottomExternals.find(
      (candidate) => candidate.id === externalEndpoint.externalId,
    );
    if (bottomExternal) {
      const preview = peekLane(globalCorridor('bottom'));
      const laneY = preview.coordinateMm;
      const allRectangles = [
        ...racks,
        ...bottomExternals.map((candidate) => candidate.box),
      ];
      const leftTrunk =
        Math.min(...allRectangles.map((rect) => rect.xMm)) - EXIT_STUB_MM;
      const rightTrunk =
        Math.max(...allRectangles.map((rect) => rect.xMm + rect.widthMm)) +
        EXIT_STUB_MM;
      const candidates: Array<RouteCandidate & { usesLane: boolean }> = [];
      for (const side of ['right', 'left'] as const) {
        const source = attachment(
          connection.id,
          endpointName,
          deviceEndpoint,
          side,
        );
        const trunk = side === 'right' ? rightTrunk : leftTrunk;
        const approach = bottomExternal.approachY;
        const target = bottomExternal.target;
        const paths = [
          [
            source.point,
            source.stub,
            { xMm: source.stub.xMm, yMm: laneY },
            { xMm: target.xMm, yMm: laneY },
            target,
          ],
          [
            source.point,
            source.stub,
            { xMm: source.stub.xMm, yMm: laneY },
            { xMm: trunk, yMm: laneY },
            { xMm: trunk, yMm: approach },
            { xMm: target.xMm, yMm: approach },
            target,
          ],
          [
            source.point,
            source.stub,
            { xMm: trunk, yMm: source.point.yMm },
            { xMm: trunk, yMm: approach },
            { xMm: target.xMm, yMm: approach },
            target,
          ],
        ];
        for (const [index, path] of paths.entries()) {
          const route = compactRoute(path);
          if (
            !bottomExternalRouteIsClear(
              route,
              bottomExternal.id,
              racks,
              obstacles,
              bottomExternals,
            )
          )
            continue;
          const usesLane = index < 2;
          candidates.push({
            route,
            usesLane,
            score: routeScore(route, usesLane ? preview.pressure : 0),
          });
        }
      }
      if (candidates.length === 0) {
        throw new Error(
          `No accepted bottom external route for ${connection.id} (${bottomExternal.id})`,
        );
      }
      const best = bestCandidate(candidates);
      if (best.usesLane) consumeLane(preview);
      return oriented(best.route);
    }

    const region = classifyExternalRegion(external, rack, subject);

    if (region === 'right' || region === 'left') {
      const deviceAttachment = attachment(
        connection.id,
        endpointName,
        deviceEndpoint,
        region,
      );
      const excluded = new Set([deviceRackKey]);
      if (
        horizontalPathIsClear(
          deviceAttachment.stub.xMm,
          external.xMm,
          deviceAttachment.stub.yMm,
          excluded,
        )
      ) {
        // A clear straight run reaches the target without a corridor, so none
        // is previewed and none is allocated.
        return oriented(
          compactRoute([
            deviceAttachment.point,
            deviceAttachment.stub,
            { xMm: external.xMm, yMm: deviceAttachment.stub.yMm },
            external,
          ]),
        );
      }

      const externalAttachment: Attachment = {
        point: { ...external },
        stub: { ...external },
      };
      const best = bestCandidate(
        channelCandidates(deviceAttachment, externalAttachment),
      );
      consumeLane(best.preview);
      return oriented(best.route);
    }

    // One global channel lane is previewed up front and shared by both side
    // candidates, so the only open choice is which rack face to leave from and
    // exactly one lane is consumed however that choice lands.
    const preview = peekLane(globalCorridor(region));
    const laneY = preview.coordinateMm;
    const candidates = (['right', 'left'] as const).map((side) => {
      const deviceAttachment = attachment(
        connection.id,
        endpointName,
        deviceEndpoint,
        side,
      );
      const route = compactRoute([
        deviceAttachment.point,
        deviceAttachment.stub,
        { xMm: deviceAttachment.stub.xMm, yMm: laneY },
        { xMm: external.xMm, yMm: laneY },
        external,
      ]);
      return {
        route,
        score: routeScore(route, preview.pressure),
      };
    });
    const best = bestCandidate(candidates);
    consumeLane(preview);
    return oriented(best.route);
  }

  /**
   * Perimeter strategies in priority order.
   *
   * The order is the policy: reserved H and local vertical routes beat a rack-side corridor,
   * which beats a rack-pair gap, which beats an external run, and an orthogonal
   * route catches anything none of them can place. Each strategy returns
   * `undefined` without touching allocator state when it does not apply, so
   * `??` both selects the strategy and guarantees only the winning one
   * allocates.
   */
  function routePerimeterConnection(connection: RoutingConnection): PointMm[] {
    return (
      classHRoutes.get(connection.id) ??
      localVerticalRoute(connection) ??
      sameRackPerimeterRoute(connection) ??
      crossRackPerimeterRoute(connection) ??
      externalPerimeterRoute(connection) ??
      orthogonalRoute(connection.from.anchor, connection.to.anchor)
    );
  }

  /**
   * `lanes`: the original small proof. Same-rack connections take successive
   * right-side lanes; everything else takes the next shared bottom lane.
   */
  function routeLegacyLanesConnection(
    connection: RoutingConnection,
  ): PointMm[] {
    const from = connection.from.anchor;
    const to = connection.to.anchor;
    const rackKey = connection.from.rackKey;

    if (rackKey !== undefined && connection.to.rackKey === rackKey) {
      const rack = rackByKey.get(rackKey);
      if (rack) {
        const laneIndex = rightLaneUse.get(rackKey) ?? 0;
        rightLaneUse.set(rackKey, laneIndex + 1);
        const laneX =
          rack.xMm +
          rack.widthMm +
          RIGHT_LANE_GUTTER_MM +
          laneIndex * LANE_SPACING_MM;
        return compactRoute([
          from,
          { xMm: laneX, yMm: from.yMm },
          { xMm: laneX, yMm: to.yMm },
          to,
        ]);
      }
    }

    const laneY =
      subject.bottomY +
      BOTTOM_LANE_GUTTER_MM +
      bottomLaneIndex * LANE_SPACING_MM;
    bottomLaneIndex += 1;
    return compactRoute([
      from,
      { xMm: from.xMm, yMm: laneY },
      { xMm: to.xMm, yMm: laneY },
      to,
    ]);
  }

  // Resolve H once in its original order, before vertical routes compete for
  // nearby space. H's own slots/tracks never see vertical occupancy.
  if (mode === 'perimeter') {
    for (const connection of allocationConnections) {
      const route = classHRoute(connection);
      const rackKey = connection.from.rackKey;
      if (!route || rackKey === undefined) continue;
      classHRoutes.set(connection.id, route);
      const occupied = localVerticalOccupancy.get(rackKey) ?? [];
      occupied.push(route);
      localVerticalOccupancy.set(rackKey, occupied);
    }
  }

  for (const connection of allocationConnections) {
    const route =
      mode === 'direct'
        ? directRoute(connection.from.anchor, connection.to.anchor)
        : mode === 'orthogonal'
          ? orthogonalRoute(connection.from.anchor, connection.to.anchor)
          : mode === 'perimeter'
            ? routePerimeterConnection(connection)
            : routeLegacyLanesConnection(connection);
    routes.set(connection.id, route);
  }

  return routes;
}
