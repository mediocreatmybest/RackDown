import { packBottomExternals } from './bottom-externals.js';
import type { RackFace } from './document.js';
import { externalDisplayLabel } from './external-labels.js';
import type {
  LayoutConnection,
  LayoutConnectionEndpoint,
  LayoutDevice,
  LayoutDeviceEndpoint,
  LayoutExternal,
  LayoutExternalEndpoint,
  LayoutRack,
  PointMm,
  RackLayout,
  RectMm,
} from './layout.js';
import {
  CONNECTION_CORNER_RADIUS_MM,
  NORMAL_ROUTING_ENVELOPE_MM,
  type RoutingConnection,
  type RoutingObstacle,
  type RoutingRack,
  routeConnections,
  type SvgConnectionRouting,
} from './routing.js';
import { RACK_UNIT_MM } from './units.js';

export type { SvgConnectionRouting } from './routing.js';

const VIEW_PADDING_MM = 6.35;
const LEFT_LABEL_GUTTER_MM = 19.05;
const TITLE_GUTTER_MM = 19.05;
const RACK_VIEW_GAP_MM = 25.4;
const MAX_PROJECTIONS_PER_ROW = 2;
const RACK_ROW_GAP_MM = 38.1;
const EXTERNAL_GAP_MM = 12.7;
const EXTERNAL_WIDTH_MM = 76.2;
const EXTERNAL_HEIGHT_MM = 16;
const EXTERNAL_HORIZONTAL_GAP_MM = 4;
const EXTERNAL_VERTICAL_GAP_MM = 4;
const EMPTY_WIDTH_MM = 120;
const EMPTY_HEIGHT_MM = 40;
const TITLE_OFFSET_MM = 7.5;
const U_LABEL_OFFSET_MM = 3.5;
/** Millimetre tolerance for treating a route segment as zero-length or axis-aligned. */
const ROUTE_GEOMETRY_EPSILON_MM = 1e-9;
const DEFAULT_CONNECTION_WIDTH = 2;
const DEFAULT_CONNECTION_OPACITY = 1;
const DEFAULT_CONNECTION_PALETTE = [
  '#0072b2',
  '#d55e00',
  '#009e73',
  '#cc79a7',
  '#e69f00',
  '#56b4e9',
] as const;

export type SvgExternalPlacement = 'bottom' | 'right';
export type ConnectionColourMode = 'auto' | 'monochrome';
export type ConnectionPattern = 'solid' | 'dashed' | 'dotted';
/** Embedded SVG stylesheet theme mode. */
export type SvgTheme = 'auto' | 'light' | 'dark' | 'none';
/** Root SVG intrinsic sizing mode. Defaults to pixels. */
export type SvgSizing = 'pixels' | 'physical' | 'responsive';

/** Portable visual intent for a connection, independent of SVG mechanics. */
export interface ConnectionVisualStyle {
  /** Named or hexadecimal colour. Explicit colour wins renderer auto-colour. */
  color?: string;
  /** Portable line-pattern intent. */
  pattern?: ConnectionPattern;
  /** Nominal visual stroke width. */
  width?: number;
  /** Visual opacity from 0 through 1. */
  opacity?: number;
}

export interface SvgRenderOptions {
  /** Stable host-provided namespace used to avoid SVG id collisions. */
  namespace?: string;
  /** Renderer-only placement for external-reference annotations. */
  externalPlacement?: SvgExternalPlacement;
  /** Renderer-only presentation mode for connection paths. */
  connectionRouting?: SvgConnectionRouting;
  /** Automatic colour differentiation or monochrome host/theme colour. */
  connectionColourMode?: ConnectionColourMode;
  /** Optional deterministic auto-colour palette. Empty palettes use the built-in palette. */
  connectionPalette?: readonly string[];
  /** Portable defaults applied to every connection. */
  connectionStyle?: ConnectionVisualStyle;
  /** Portable per-connection overrides keyed by semantic LayoutConnection id. */
  connectionStyles?: Readonly<Record<string, ConnectionVisualStyle>>;
  /** Embedded SVG stylesheet theme mode. Defaults to auto. */
  theme?: SvgTheme;
  /** Root SVG intrinsic sizing mode. Defaults to pixels. */
  sizing?: SvgSizing;
}

interface Viewport {
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
}

interface Extents {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface ProjectedRack extends LayoutRack {
  face: RackFace;
}

interface ProjectedExternal extends LayoutExternal, RectMm {
  anchor: PointMm;
  displayLabel: string;
  placement: SvgExternalPlacement;
  packedBottom?: boolean;
}

type ProjectedConnectionEndpoint =
  | LayoutDeviceEndpoint
  | (LayoutExternalEndpoint & { anchor: PointMm });

interface ProjectedConnection extends Omit<LayoutConnection, 'from' | 'to'> {
  from: ProjectedConnectionEndpoint;
  to: ProjectedConnectionEndpoint;
}

interface RoutedProjectedConnection extends ProjectedConnection {
  route: PointMm[];
  routing: SvgConnectionRouting;
}

interface ResolvedConnectionVisualStyle {
  color?: string;
  colorSource: 'auto' | 'explicit' | 'monochrome';
  pattern: ConnectionPattern;
  width: number;
  /** True when the width fell back to the renderer default rather than portable intent. */
  defaultWidth: boolean;
  opacity: number;
}

interface RenderScene {
  racks: ProjectedRack[];
  devices: LayoutDevice[];
  connections: ProjectedConnection[];
  externals: ProjectedExternal[];
}

interface RoutedRenderScene extends Omit<RenderScene, 'connections'> {
  connections: RoutedProjectedConnection[];
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

/**
 * Distributes bottom external annotations outward from the subject centre in alternating slots:
 * index 0 ->  0 (centre)
 * index 1 -> -1 (left)
 * index 2 -> +1 (right)
 * index 3 -> -2 (farther left)
 * index 4 -> +2 (farther right)
 *
 * Sequence: 0, -1, +1, -2, +2, ...
 * Note: Analogous to routing.ts alternatingOffset() (which uses 0, +1, -1, +2, -2, ...),
 * both fan outward from the centre but start in opposite initial directions.
 */
function bottomExternalSlot(index: number): number {
  if (index === 0) {
    return 0;
  }
  const distance = Math.ceil(index / 2);
  return index % 2 === 1 ? -distance : distance;
}

function sanitizeNamespace(value: string): string {
  const safe = value
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return safe || 'diagram';
}

function fnv1aNumber(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function fnv1a(value: string): string {
  return fnv1aNumber(value).toString(36);
}

function endpointFingerprint(endpoint: LayoutConnectionEndpoint): unknown[] {
  if (endpoint.kind === 'external') {
    return [
      endpoint.kind,
      endpoint.externalId,
      endpoint.label,
      endpoint.link?.style ?? null,
      endpoint.link?.target ?? null,
    ];
  }
  return [
    endpoint.kind,
    endpoint.deviceId,
    endpoint.portName ?? null,
    endpoint.anchor.xMm,
    endpoint.anchor.yMm,
    endpoint.adHocPort,
  ];
}

function layoutFingerprint(layout: RackLayout): unknown {
  return {
    racks: layout.racks.map((rack) => [
      rack.id,
      rack.name,
      rack.units,
      rack.widthInches,
      rack.u1,
      rack.views,
      rack.xMm,
      rack.yMm,
      rack.widthMm,
      rack.heightMm,
    ]),
    devices: layout.devices.map((device) => [
      device.id,
      device.rackId,
      device.label,
      device.deviceType,
      device.alias ?? null,
      device.positionU,
      device.uHeight,
      device.mountFace,
      device.unknown,
      device.xMm,
      device.yMm,
      device.widthMm,
      device.heightMm,
    ]),
    connections: layout.connections.map((connection) => [
      connection.id,
      endpointFingerprint(connection.from),
      endpointFingerprint(connection.to),
      connection.media ?? null,
    ]),
    externals: layout.externals.map((external) => [
      external.id,
      external.label,
      external.link?.style ?? null,
      external.link?.target ?? null,
    ]),
  };
}

function externalPlacement(options: SvgRenderOptions): SvgExternalPlacement {
  return options.externalPlacement ?? 'bottom';
}

function connectionRouting(options: SvgRenderOptions): SvgConnectionRouting {
  return options.connectionRouting ?? 'direct';
}

function connectionColourMode(options: SvgRenderOptions): ConnectionColourMode {
  return options.connectionColourMode ?? 'auto';
}

function svgTheme(options: SvgRenderOptions): SvgTheme {
  return options.theme ?? 'auto';
}

function svgSizing(options: SvgRenderOptions): SvgSizing {
  return options.sizing ?? 'pixels';
}

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function connectionStyleFingerprint(
  options: SvgRenderOptions,
): Record<string, unknown> {
  const styles =
    options.connectionStyles === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(options.connectionStyles).sort(([left], [right]) =>
            compareCodeUnits(left, right),
          ),
        );
  return {
    ...(connectionColourMode(options) === 'auto'
      ? {}
      : { connectionColourMode: connectionColourMode(options) }),
    ...(options.connectionPalette === undefined
      ? {}
      : { connectionPalette: options.connectionPalette }),
    ...(options.connectionStyle === undefined
      ? {}
      : { connectionStyle: options.connectionStyle }),
    ...(styles === undefined ? {} : { connectionStyles: styles }),
  };
}

function rendererNamespace(
  layout: RackLayout,
  options: SvgRenderOptions,
): string {
  const routing = connectionRouting(options);
  const theme = svgTheme(options);
  const sizing = svgSizing(options);
  const suffix =
    options.namespace === undefined
      ? fnv1a(
          JSON.stringify({
            layout: layoutFingerprint(layout),
            externalPlacement: externalPlacement(options),
            ...(routing === 'direct' ? {} : { connectionRouting: routing }),
            ...connectionStyleFingerprint(options),
            ...(theme === 'auto' ? {} : { theme }),
            ...(sizing === 'pixels' ? {} : { sizing }),
          }),
        )
      : sanitizeNamespace(options.namespace);
  return `rackdown-${suffix}`;
}

function hasExplicitConnectionWidth(
  value: number | undefined,
): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}

function normalizeConnectionWidth(value: number | undefined): number {
  return hasExplicitConnectionWidth(value) ? value : DEFAULT_CONNECTION_WIDTH;
}

function normalizeConnectionOpacity(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_CONNECTION_OPACITY;
  }
  return Math.min(1, Math.max(0, value));
}

function safeConnectionColor(value: string | undefined): string | undefined {
  const color = value?.trim();
  if (!color) {
    return undefined;
  }
  if (/^#[0-9a-f]{3,8}$/i.test(color) || /^[a-z]+$/i.test(color)) {
    return color;
  }
  return undefined;
}

function connectionPalette(options: SvgRenderOptions): readonly string[] {
  const palette = options.connectionPalette
    ?.map((color) => safeConnectionColor(color))
    .filter((color): color is string => color !== undefined);
  return palette && palette.length > 0 ? palette : DEFAULT_CONNECTION_PALETTE;
}

function resolveConnectionVisualStyle(
  connection: RoutedProjectedConnection,
  adHoc: boolean,
  options: SvgRenderOptions,
): ResolvedConnectionVisualStyle {
  const portable = {
    ...options.connectionStyle,
    ...(options.connectionStyles?.[connection.id] ?? {}),
  };
  const mode = connectionColourMode(options);
  const explicitColor = safeConnectionColor(portable.color);
  let color: string | undefined;
  let colorSource: ResolvedConnectionVisualStyle['colorSource'];

  if (mode === 'monochrome') {
    colorSource = 'monochrome';
  } else if (explicitColor !== undefined) {
    color = explicitColor;
    colorSource = 'explicit';
  } else {
    const palette = connectionPalette(options);
    color = palette[fnv1aNumber(connection.id) % palette.length];
    colorSource = 'auto';
  }

  return {
    ...(color === undefined ? {} : { color }),
    colorSource,
    pattern: portable.pattern ?? (adHoc ? 'dashed' : 'solid'),
    width: normalizeConnectionWidth(portable.width),
    defaultWidth: !hasExplicitConnectionWidth(portable.width),
    opacity: normalizeConnectionOpacity(portable.opacity),
  };
}

function renderConnectionStyleAttributes(
  style: ResolvedConnectionVisualStyle,
): string {
  const dashArray =
    style.pattern === 'dashed'
      ? '6 4'
      : style.pattern === 'dotted'
        ? '1 4'
        : 'none';
  const color =
    style.color === undefined ? '' : ` stroke="${escapeXml(style.color)}"`;
  return ` data-pattern="${style.pattern}" data-colour-source="${style.colorSource}" stroke-width="${formatNumber(style.width)}" stroke-opacity="${formatNumber(style.opacity)}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${dashArray}"${color}`;
}

function rackProjectionKey(rackId: string, face: RackFace): string {
  return `${rackId}:${face}`;
}

function emptyExtents(): Extents {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
}

function includePoint(point: PointMm, extents: Extents): void {
  extents.minX = Math.min(extents.minX, point.xMm);
  extents.minY = Math.min(extents.minY, point.yMm);
  extents.maxX = Math.max(extents.maxX, point.xMm);
  extents.maxY = Math.max(extents.maxY, point.yMm);
}

function includeRect(rect: RectMm, extents: Extents): void {
  includePoint(rect, extents);
  includePoint(
    { xMm: rect.xMm + rect.widthMm, yMm: rect.yMm + rect.heightMm },
    extents,
  );
}

function rectExtents(rects: readonly RectMm[]): Extents | undefined {
  if (rects.length === 0) {
    return undefined;
  }
  const extents = emptyExtents();
  for (const rect of rects) {
    includeRect(rect, extents);
  }
  return extents;
}

function buildRenderScene(
  layout: RackLayout,
  placement: SvgExternalPlacement,
  routing: SvgConnectionRouting,
): RenderScene {
  const projectedRacks: ProjectedRack[] = [];
  const projectionByKey = new Map<string, PointMm>();
  const rackById = new Map(layout.racks.map((rack) => [rack.id, rack]));
  const deviceById = new Map(
    layout.devices.map((device) => [device.id, device]),
  );

  let currentX = 0;
  let currentY = 0;
  let currentRowHeight = 0;
  let currentRowProjections = 0;

  for (const rack of layout.racks) {
    const rackViews = rack.views;
    if (
      currentRowProjections > 0 &&
      currentRowProjections + rackViews.length > MAX_PROJECTIONS_PER_ROW
    ) {
      currentY += currentRowHeight + RACK_ROW_GAP_MM;
      currentX = 0;
      currentRowHeight = 0;
      currentRowProjections = 0;
    }

    for (const face of rackViews) {
      // Reachable: `toSvg` accepts caller-constructed RackLayouts, whose
      // `views` array may hold more faces than parser output ever produces.
      if (currentRowProjections >= MAX_PROJECTIONS_PER_ROW) {
        currentY += currentRowHeight + RACK_ROW_GAP_MM;
        currentX = 0;
        currentRowHeight = 0;
        currentRowProjections = 0;
      }

      projectionByKey.set(rackProjectionKey(rack.id, face), {
        xMm: currentX,
        yMm: currentY,
      });
      projectedRacks.push({
        ...rack,
        face,
        xMm: currentX,
        yMm: currentY,
      });

      currentRowHeight = Math.max(currentRowHeight, rack.heightMm);
      currentX += rack.widthMm + RACK_VIEW_GAP_MM;
      currentRowProjections += 1;
    }
  }

  const projectedDevices: LayoutDevice[] = [];
  for (const device of layout.devices) {
    const rack = rackById.get(device.rackId);
    const projectedPos = projectionByKey.get(
      rackProjectionKey(device.rackId, device.mountFace),
    );
    if (!rack || !projectedPos) {
      continue;
    }

    projectedDevices.push({
      ...device,
      xMm: device.xMm + projectedPos.xMm - rack.xMm,
      yMm: device.yMm + projectedPos.yMm - rack.yMm,
    });
  }

  function projectDeviceEndpoint(
    endpoint: LayoutDeviceEndpoint,
  ): LayoutDeviceEndpoint | undefined {
    const device = deviceById.get(endpoint.deviceId);
    if (!device) {
      return undefined;
    }
    const rack = rackById.get(device.rackId);
    const projectedPos = projectionByKey.get(
      rackProjectionKey(device.rackId, device.mountFace),
    );
    if (!rack || !projectedPos) {
      return undefined;
    }

    return {
      ...endpoint,
      anchor: {
        xMm: endpoint.anchor.xMm + projectedPos.xMm - rack.xMm,
        yMm: endpoint.anchor.yMm + projectedPos.yMm - rack.yMm,
      },
    };
  }

  function projectVisibleEndpoint(
    endpoint: LayoutConnectionEndpoint,
  ): LayoutConnectionEndpoint | undefined {
    if (endpoint.kind === 'external') {
      return endpoint;
    }
    return projectDeviceEndpoint(endpoint);
  }

  const visibleConnections: LayoutConnection[] = [];
  for (const connection of layout.connections) {
    const from = projectVisibleEndpoint(connection.from);
    const to = projectVisibleEndpoint(connection.to);
    if (from === undefined || to === undefined) {
      continue;
    }
    visibleConnections.push({
      ...connection,
      from,
      to,
    });
  }
  const visibleExternalIds = new Set<string>();
  for (const connection of visibleConnections) {
    if (connection.from.kind === 'external') {
      visibleExternalIds.add(connection.from.externalId);
    }
    if (connection.to.kind === 'external') {
      visibleExternalIds.add(connection.to.externalId);
    }
  }

  const subjectExtents = rectExtents([...projectedRacks, ...projectedDevices]);
  const subjectCenterX = subjectExtents
    ? (subjectExtents.minX + subjectExtents.maxX) / 2
    : 0;
  const subjectRightX = subjectExtents?.maxX ?? 0;
  const subjectBottomY = subjectExtents?.maxY ?? 0;

  const canPackBottom =
    routing === 'perimeter' &&
    placement === 'bottom' &&
    projectedRacks.length > 0 &&
    visibleConnections.every(
      (connection) =>
        connection.from.kind === 'device' || connection.to.kind === 'device',
    ) &&
    projectedRacks.every(
      (rack) =>
        [rack.xMm, rack.yMm, rack.widthMm, rack.heightMm].every(
          Number.isFinite,
        ) &&
        rack.widthMm > 0 &&
        rack.heightMm > 0,
    ) &&
    projectedDevices.every((device) => {
      const rack = projectedRacks.find(
        (r) => r.id === device.rackId && r.face === device.mountFace,
      );
      return (
        rack !== undefined &&
        [device.xMm, device.yMm, device.widthMm, device.heightMm].every(
          Number.isFinite,
        ) &&
        device.widthMm > 0 &&
        device.heightMm > 0 &&
        device.xMm >= rack.xMm - 0.01 &&
        device.yMm >= rack.yMm - 0.01 &&
        device.xMm + device.widthMm <= rack.xMm + rack.widthMm + 0.01 &&
        device.yMm + device.heightMm <= rack.yMm + rack.heightMm + 0.01
      );
    });
  const sourceCentres = new Map<string, number[]>();
  const projectedDeviceById = new Map(
    projectedDevices.map((device) => [device.id, device]),
  );
  for (const connection of visibleConnections) {
    const deviceEndpoint =
      connection.from.kind === 'device'
        ? connection.from
        : connection.to.kind === 'device'
          ? connection.to
          : undefined;
    const externalEndpoint =
      connection.from.kind === 'external'
        ? connection.from
        : connection.to.kind === 'external'
          ? connection.to
          : undefined;
    if (!deviceEndpoint || !externalEndpoint) continue;
    const device = projectedDeviceById.get(deviceEndpoint.deviceId);
    if (!device) continue;
    const centres = sourceCentres.get(externalEndpoint.externalId) ?? [];
    centres.push(device.xMm + device.widthMm / 2);
    sourceCentres.set(externalEndpoint.externalId, centres);
  }
  const packed = canPackBottom
    ? packBottomExternals(
        layout.externals
          .filter((external) => visibleExternalIds.has(external.id))
          .map((external) => ({
            external,
            centres: sourceCentres.get(external.id) ?? [],
          })),
        subjectCenterX,
        Math.max(0, subjectBottomY) + NORMAL_ROUTING_ENVELOPE_MM.bottomMm + 10,
      )
    : undefined;

  const projectedExternals: ProjectedExternal[] = [];
  const projectedExternalById = new Map<string, ProjectedExternal>();
  for (const external of layout.externals) {
    if (!visibleExternalIds.has(external.id)) {
      continue;
    }

    const index = projectedExternals.length;
    const displayLabel = externalDisplayLabel(external.label);
    let xMm: number;
    let yMm: number;
    let anchor: PointMm;

    const packedBox = packed?.get(external.id);
    if (packedBox) {
      xMm = packedBox.xMm;
      yMm = packedBox.yMm;
      anchor = { xMm: xMm + 38.1, yMm };
    } else if (placement === 'right') {
      xMm = subjectRightX + EXTERNAL_GAP_MM;
      yMm = index * (EXTERNAL_HEIGHT_MM + EXTERNAL_VERTICAL_GAP_MM);
      anchor = {
        xMm,
        yMm: yMm + EXTERNAL_HEIGHT_MM / 2,
      };
    } else {
      const slot = bottomExternalSlot(index);
      xMm =
        subjectCenterX +
        slot * (EXTERNAL_WIDTH_MM + EXTERNAL_HORIZONTAL_GAP_MM) -
        EXTERNAL_WIDTH_MM / 2;
      yMm = subjectBottomY + EXTERNAL_GAP_MM;
      anchor = {
        xMm: xMm + EXTERNAL_WIDTH_MM / 2,
        yMm,
      };
    }

    const projected: ProjectedExternal = {
      ...external,
      xMm,
      yMm,
      widthMm: EXTERNAL_WIDTH_MM,
      heightMm: EXTERNAL_HEIGHT_MM,
      anchor,
      displayLabel,
      placement,
      packedBottom: packedBox !== undefined,
    };
    projectedExternals.push(projected);
    projectedExternalById.set(external.id, projected);
  }

  function projectEndpoint(
    endpoint: LayoutConnectionEndpoint,
  ): ProjectedConnectionEndpoint | undefined {
    if (endpoint.kind === 'external') {
      const external = projectedExternalById.get(endpoint.externalId);
      if (!external) {
        return undefined;
      }
      return {
        ...endpoint,
        anchor: { ...external.anchor },
      };
    }
    return endpoint;
  }

  const projectedConnections: ProjectedConnection[] = [];
  for (const connection of visibleConnections) {
    const from = projectEndpoint(connection.from);
    const to = projectEndpoint(connection.to);
    if (!from || !to) {
      continue;
    }
    projectedConnections.push({
      ...connection,
      from,
      to,
    });
  }

  // Shelves are sorted before non-shelf devices so later device rendering can
  // paint hosted devices over shelves. Returning 0 deliberately preserves original
  // source order within the shelf group and within the non-shelf group. This relies
  // on the stable Array.prototype.sort guarantee standardised in ES2019 and available
  // in all supported runtimes; output determinism depends on that stable ordering.
  const orderedProjectedDevices = [...projectedDevices].sort((a, b) => {
    const aShelf = a.deviceType === 'shelf';
    const bShelf = b.deviceType === 'shelf';
    if (aShelf === bShelf) return 0;
    return aShelf ? -1 : 1;
  });

  return {
    racks: projectedRacks,
    devices: orderedProjectedDevices,
    connections: projectedConnections,
    externals: projectedExternals,
  };
}

function routeRenderScene(
  scene: RenderScene,
  routing: SvgConnectionRouting,
): RoutedRenderScene {
  const deviceById = new Map(
    scene.devices.map((device) => [device.id, device]),
  );
  const routingRacks: RoutingRack[] = scene.racks.map((rack) => ({
    key: rackProjectionKey(rack.id, rack.face),
    xMm: rack.xMm,
    yMm: rack.yMm,
    widthMm: rack.widthMm,
    heightMm: rack.heightMm,
  }));

  function routingEndpoint(
    endpoint: ProjectedConnectionEndpoint,
  ): RoutingConnection['from'] {
    if (endpoint.kind === 'external') {
      return {
        anchor: endpoint.anchor,
        externalId: endpoint.externalId,
      };
    }
    const device = deviceById.get(endpoint.deviceId);
    if (!device) {
      return {
        anchor: endpoint.anchor,
      };
    }
    return {
      anchor: endpoint.anchor,
      rackKey: rackProjectionKey(device.rackId, device.mountFace),
      slotBounds: {
        topY: device.yMm,
        bottomY: device.yMm + device.heightMm,
        leftX: device.xMm,
        rightX: device.xMm + device.widthMm,
      },
    };
  }

  const routingObstacles: RoutingObstacle[] = scene.devices.map((device) => ({
    rackKey: rackProjectionKey(device.rackId, device.mountFace),
    xMm: device.xMm,
    yMm: device.yMm,
    widthMm: device.widthMm,
    heightMm: device.heightMm,
  }));

  const routingConnections: RoutingConnection[] = scene.connections.map(
    (connection) => ({
      id: connection.id,
      from: routingEndpoint(connection.from),
      to: routingEndpoint(connection.to),
    }),
  );
  const routes = routeConnections(
    routingConnections,
    routingRacks,
    routing,
    routingObstacles,
    scene.externals
      .filter((external) => external.packedBottom)
      .map((external) => ({
        id: external.id,
        placement: 'bottom',
        box: external,
        target: external.anchor,
        approachY: external.yMm - 10,
        protectedApproach: {
          xMm: external.anchor.xMm - 1.25,
          yMm: external.yMm - 6,
          widthMm: 2.5,
          heightMm: 6,
        },
      })),
  );

  return {
    ...scene,
    connections: scene.connections.map((connection) => ({
      ...connection,
      route: routes.get(connection.id) ?? [
        { ...connection.from.anchor },
        { ...connection.to.anchor },
      ],
      routing,
    })),
  };
}

/** One disposable measurement pass; rerouting always gets fresh allocators. */
function routeWithMeasuredExternalFloor(
  scene: RenderScene,
  routing: SvgConnectionRouting,
): RoutedRenderScene {
  const initial = routeRenderScene(scene, routing);
  const packed = scene.externals.filter((external) => external.packedBottom);
  if (packed.length === 0) return initial;
  const floor = Math.min(...packed.map((external) => external.yMm));
  let nonExternalMaxY = Number.NEGATIVE_INFINITY;
  for (const connection of initial.connections) {
    if (connection.from.kind !== 'device' || connection.to.kind !== 'device')
      continue;
    for (const point of connection.route)
      nonExternalMaxY = Math.max(nonExternalMaxY, point.yMm);
  }
  const raise = Math.max(0, nonExternalMaxY + 10 - floor);
  if (raise === 0) return initial;
  const externals = scene.externals.map((external) =>
    external.packedBottom
      ? {
          ...external,
          yMm: external.yMm + raise,
          anchor: { ...external.anchor, yMm: external.anchor.yMm + raise },
        }
      : external,
  );
  const byId = new Map(externals.map((external) => [external.id, external]));
  const endpoint = (
    value: ProjectedConnectionEndpoint,
  ): ProjectedConnectionEndpoint => {
    if (value.kind !== 'external') return value;
    const external = byId.get(value.externalId);
    return external ? { ...value, anchor: { ...external.anchor } } : value;
  };
  return routeRenderScene(
    {
      ...scene,
      externals,
      connections: scene.connections.map((connection) => ({
        ...connection,
        from: endpoint(connection.from),
        to: endpoint(connection.to),
      })),
    },
    routing,
  );
}

/**
 * Reserve the router's normal working space around the projected rack subject
 * so ordinary routing-mode changes cannot alter the apparent rack scale.
 *
 * The envelope is a viewport floor, never a clip: actual route points are still
 * unioned in afterwards, so exceptional uncapped routes expand the viewport.
 *
 * Activation is deliberately based on the projected scene, so cable-free
 * diagrams (and connections dropped before projection) acquire no whitespace.
 * The subject is rack geometry only — externals and routes stay ordinary
 * content, and the envelope is never re-expanded around them.
 */
function includeRoutingEnvelope(
  scene: RoutedRenderScene,
  extents: Extents,
): void {
  if (scene.racks.length === 0 || scene.connections.length === 0) {
    return;
  }
  const subject = rectExtents(scene.racks);
  if (!subject) {
    return;
  }

  // Seeded from zero to mirror the routing module's own reductions, so the
  // reserved basis stays aligned even for a future non-origin rack layout.
  const subjectMinX = Math.min(0, subject.minX);
  const subjectMinY = Math.min(0, subject.minY);
  const subjectMaxX = Math.max(0, subject.maxX);
  const subjectMaxY = Math.max(0, subject.maxY);

  includePoint(
    {
      xMm: subjectMinX - NORMAL_ROUTING_ENVELOPE_MM.leftMm,
      yMm: subjectMinY - NORMAL_ROUTING_ENVELOPE_MM.topMm,
    },
    extents,
  );
  includePoint(
    {
      xMm: subjectMaxX + NORMAL_ROUTING_ENVELOPE_MM.rightMm,
      yMm: subjectMaxY + NORMAL_ROUTING_ENVELOPE_MM.bottomMm,
    },
    extents,
  );
}

function computeViewport(scene: RoutedRenderScene): Viewport {
  const hasGeometry =
    scene.racks.length > 0 ||
    scene.devices.length > 0 ||
    scene.externals.length > 0 ||
    scene.connections.length > 0;
  if (!hasGeometry) {
    return {
      xMm: 0,
      yMm: 0,
      widthMm: EMPTY_WIDTH_MM,
      heightMm: EMPTY_HEIGHT_MM,
    };
  }

  const extents = emptyExtents();
  for (const rect of [...scene.racks, ...scene.devices, ...scene.externals]) {
    includeRect(rect, extents);
  }
  includeRoutingEnvelope(scene, extents);
  for (const connection of scene.connections) {
    for (const point of connection.route) {
      includePoint(point, extents);
    }
  }

  const minX = extents.minX - LEFT_LABEL_GUTTER_MM - VIEW_PADDING_MM;
  const minY = extents.minY - TITLE_GUTTER_MM - VIEW_PADDING_MM;
  const maxX = extents.maxX + VIEW_PADDING_MM;
  const maxY = extents.maxY + VIEW_PADDING_MM;

  return {
    xMm: minX,
    yMm: minY,
    widthMm: Math.max(1, maxX - minX),
    heightMm: Math.max(1, maxY - minY),
  };
}

function renderRack(rack: ProjectedRack, id: string): string[] {
  const faceName = rack.face === 'front' ? 'Front' : 'Rear';
  const title =
    rack.views.length === 1 && rack.face === 'front'
      ? rack.name
      : `${rack.name} · ${faceName}`;
  const lines = [
    `<g id="${id}" class="rackdown-rack-group rackdown-rack-${rack.face}" data-rack-id="${escapeXml(rack.id)}" data-face="${rack.face}" data-width-inches="${formatNumber(rack.widthInches)}">`,
    `  <rect class="rackdown-rack" x="${formatNumber(rack.xMm)}" y="${formatNumber(rack.yMm)}" width="${formatNumber(rack.widthMm)}" height="${formatNumber(rack.heightMm)}" />`,
    `  <text class="rackdown-rack-title" x="${formatNumber(rack.xMm + rack.widthMm / 2)}" y="${formatNumber(rack.yMm - TITLE_OFFSET_MM)}" text-anchor="middle">${escapeXml(title)}</text>`,
  ];

  const wholeUnits = Math.max(0, Math.floor(rack.units));
  for (let visualIndex = 0; visualIndex < wholeUnits; visualIndex += 1) {
    if (visualIndex > 0) {
      const lineY = rack.yMm + visualIndex * RACK_UNIT_MM;
      lines.push(
        `  <line class="rackdown-u-line" x1="${formatNumber(rack.xMm)}" y1="${formatNumber(lineY)}" x2="${formatNumber(rack.xMm + rack.widthMm)}" y2="${formatNumber(lineY)}" />`,
      );
    }

    const unit = rack.u1 === 'top' ? visualIndex + 1 : wholeUnits - visualIndex;
    const labelY = rack.yMm + (visualIndex + 0.5) * RACK_UNIT_MM;
    lines.push(
      `  <text class="rackdown-u-label" data-u="${unit}" x="${formatNumber(rack.xMm - U_LABEL_OFFSET_MM)}" y="${formatNumber(labelY)}" text-anchor="end" dominant-baseline="middle">${unit}</text>`,
    );
  }

  lines.push('</g>');
  return lines;
}

function formatPointMm(point: PointMm): string {
  return `${formatNumber(point.xMm)},${formatNumber(point.yMm)}`;
}

function isSamePointMm(a: PointMm, b: PointMm): boolean {
  return (
    Math.abs(a.xMm - b.xMm) <= ROUTE_GEOMETRY_EPSILON_MM &&
    Math.abs(a.yMm - b.yMm) <= ROUTE_GEOMETRY_EPSILON_MM
  );
}

/**
 * Local copy of a route with consecutive duplicate points dropped. Duplicates
 * would otherwise produce zero-length segments that no corner can be built
 * from. The source route array is never mutated: this is presentation cleanup,
 * not a routing decision.
 */
function withoutRepeatedPoints(points: readonly PointMm[]): PointMm[] {
  const compacted: PointMm[] = [];
  for (const point of points) {
    const previous = compacted.at(-1);
    if (previous === undefined || !isSamePointMm(previous, point)) {
      compacted.push(point);
    }
  }
  return compacted;
}

/**
 * Radius usable at one interior corner, or `undefined` when the corner is not a
 * genuine axis-aligned 90-degree bend and must stay a straight join.
 *
 * Half of each adjacent segment is the clamp, so two corners sharing a segment
 * meet at its midpoint in the worst case and never overlap.
 */
function cornerRadiusMm(
  previous: PointMm,
  corner: PointMm,
  next: PointMm,
): number | undefined {
  const incomingX = corner.xMm - previous.xMm;
  const incomingY = corner.yMm - previous.yMm;
  const outgoingX = next.xMm - corner.xMm;
  const outgoingY = next.yMm - corner.yMm;

  const epsilon = ROUTE_GEOMETRY_EPSILON_MM;
  const incomingHorizontal =
    Math.abs(incomingY) <= epsilon && Math.abs(incomingX) > epsilon;
  const incomingVertical =
    Math.abs(incomingX) <= epsilon && Math.abs(incomingY) > epsilon;
  const outgoingHorizontal =
    Math.abs(outgoingY) <= epsilon && Math.abs(outgoingX) > epsilon;
  const outgoingVertical =
    Math.abs(outgoingX) <= epsilon && Math.abs(outgoingY) > epsilon;

  // Collinear, zero-length and unexpected diagonal joins all fall through to a
  // straight `L`. R7 renders the route it was given; it does not invent
  // geometry for shapes the router is not supposed to produce.
  const turnsSquarely =
    (incomingHorizontal && outgoingVertical) ||
    (incomingVertical && outgoingHorizontal);
  if (!turnsSquarely) {
    return undefined;
  }

  const radius = Math.min(
    CONNECTION_CORNER_RADIUS_MM,
    Math.hypot(incomingX, incomingY) / 2,
    Math.hypot(outgoingX, outgoingY) / 2,
  );
  return radius > 0 ? radius : undefined;
}

/** The point `distanceMm` from `from` along the straight line towards `towards`. */
function pointTowards(
  from: PointMm,
  towards: PointMm,
  distanceMm: number,
): PointMm {
  const dx = towards.xMm - from.xMm;
  const dy = towards.yMm - from.yMm;
  const ratio = distanceMm / Math.hypot(dx, dy);
  return { xMm: from.xMm + dx * ratio, yMm: from.yMm + dy * ratio };
}

/**
 * `d` for a routed connection: the route points the router already decided,
 * drawn with rounded elbows.
 *
 * Presentation only. Each logical corner stays the quadratic control point, so
 * the route remains recoverable from the markup, and the first and last
 * coordinates are emitted exactly.
 *
 * @internal Exported for renderer tests only; not re-exported from the package
 * index, so this is not part of the public API.
 */
export function roundedRoutePath(route: readonly PointMm[]): string {
  const points = withoutRepeatedPoints(route);
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined) {
    return '';
  }

  const commands = [`M ${formatPointMm(first)}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1] as PointMm;
    const corner = points[index] as PointMm;
    const next = points[index + 1] as PointMm;
    const radius = cornerRadiusMm(previous, corner, next);
    if (radius === undefined) {
      commands.push(`L ${formatPointMm(corner)}`);
      continue;
    }
    const approach = pointTowards(corner, previous, radius);
    const departure = pointTowards(corner, next, radius);
    commands.push(`L ${formatPointMm(approach)}`);
    commands.push(`Q ${formatPointMm(corner)} ${formatPointMm(departure)}`);
  }
  commands.push(`L ${formatPointMm(last)}`);

  return commands.join(' ');
}

/**
 * Renderer-only display text for a connection endpoint. Prefers alias, then
 * label; a parser-generated device id is a defensive last resort for a device
 * the projected scene unexpectedly lacks.
 */
function connectionEndpointLabel(
  endpoint: ProjectedConnectionEndpoint,
  deviceById: ReadonlyMap<string, LayoutDevice>,
): string {
  if (endpoint.kind === 'external') {
    return endpoint.label;
  }
  const device = deviceById.get(endpoint.deviceId);
  const label = device?.alias ?? device?.label ?? endpoint.deviceId;
  return endpoint.portName === undefined
    ? label
    : `${label}:${endpoint.portName}`;
}

function connectionTitle(
  connection: RoutedProjectedConnection,
  deviceById: ReadonlyMap<string, LayoutDevice>,
): string {
  const from = connectionEndpointLabel(connection.from, deviceById);
  const to = connectionEndpointLabel(connection.to, deviceById);
  const media = connection.media === undefined ? '' : ` (${connection.media})`;
  return `${from} → ${to}${media}`;
}

function renderConnection(
  connection: RoutedProjectedConnection,
  id: string,
  options: SvgRenderOptions,
  deviceById: ReadonlyMap<string, LayoutDevice>,
): string[] {
  const media =
    connection.media === undefined
      ? ''
      : ` data-media="${escapeXml(connection.media)}"`;
  const adHoc =
    (connection.from.kind === 'device' && connection.from.adHocPort) ||
    (connection.to.kind === 'device' && connection.to.adHocPort);
  const style = resolveConnectionVisualStyle(connection, adHoc, options);
  const styleAttributes = renderConnectionStyleAttributes(style);
  const common = `id="${id}" class="rackdown-connection${adHoc ? ' rackdown-connection-ad-hoc' : ''}${style.defaultWidth ? ' rackdown-connection-default-width' : ''}" data-connection-id="${escapeXml(connection.id)}" data-routing="${connection.routing}"${media}${styleAttributes}`;

  const title = `<title>${escapeXml(connectionTitle(connection, deviceById))}</title>`;

  if (connection.routing === 'direct') {
    return [
      `<line ${common} x1="${formatNumber(connection.from.anchor.xMm)}" y1="${formatNumber(connection.from.anchor.yMm)}" x2="${formatNumber(connection.to.anchor.xMm)}" y2="${formatNumber(connection.to.anchor.yMm)}">`,
      `  ${title}`,
      '</line>',
    ];
  }

  return [
    `<path ${common} d="${roundedRoutePath(connection.route)}">`,
    `  ${title}`,
    '</path>',
  ];
}

/**
 * Determines whether a device label should be rendered.
 *
 * Policy:
 * - Ordinary devices: Render any non-empty label.
 * - Blank / shelf: Avoid visually noisy placeholder labels while preserving author-supplied labels.
 *   - When explicitLabel metadata is present, it is authoritative:
 *     - explicit label requested and non-empty -> render
 *     - explicit label not requested -> suppress
 *   - When explicitLabel is absent (compatibility mode):
 *     - suppress generic implicit labels matching the device type ("blank" or "shelf")
 *     - render any other non-empty/custom label
 */
function shouldRenderDeviceLabel(device: LayoutDevice): boolean {
  if (device.deviceType === 'blank' || device.deviceType === 'shelf') {
    if (device.explicitLabel !== undefined) {
      return device.explicitLabel && device.label !== '';
    }
    return device.label !== '' && device.label !== device.deviceType;
  }
  return device.label !== '';
}

/**
 * Estimated character advance widths in SVG user-coordinate space for device label truncation.
 *
 * The compact estimate corresponds to the renderer's 9px compact label style (.rackdown-device-label-compact),
 * while the normal estimate corresponds to the 12px normal label style (.rackdown-device-label).
 * These are deterministic layout heuristics rather than font measurements; the renderer intentionally
 * does not depend on DOM or font measurement runtimes.
 */
const COMPACT_DEVICE_LABEL_CHAR_WIDTH_ESTIMATE = 5.5;
const NORMAL_DEVICE_LABEL_CHAR_WIDTH_ESTIMATE = 7.2;
const DEVICE_LABEL_HORIZONTAL_PADDING_MM = 12;
const DEVICE_LABEL_MIN_CHARS = 6;

function truncateDeviceLabel(
  label: string,
  widthMm: number,
  uHeight: number,
): string {
  const charWidth =
    uHeight < 1
      ? COMPACT_DEVICE_LABEL_CHAR_WIDTH_ESTIMATE
      : NORMAL_DEVICE_LABEL_CHAR_WIDTH_ESTIMATE;
  const maxChars = Math.max(
    DEVICE_LABEL_MIN_CHARS,
    Math.floor((widthMm - DEVICE_LABEL_HORIZONTAL_PADDING_MM) / charWidth),
  );
  if (label.length <= maxChars) {
    return label;
  }
  return `${label.slice(0, maxChars - 1).trimEnd()}…`;
}

const DEVICE_ROLE_CLASSES = {
  blank: {
    role: 'blank',
    groupClass: ' rackdown-blank-group',
    rectClass: ' rackdown-blank',
    labelClass: ' rackdown-blank-label',
  },
  shelf: {
    role: 'shelf',
    groupClass: ' rackdown-shelf-group',
    rectClass: ' rackdown-shelf',
    labelClass: ' rackdown-shelf-label',
  },
} as const;

function renderDevice(device: LayoutDevice, id: string): string[] {
  const alias =
    device.alias === undefined
      ? ''
      : ` data-alias="${escapeXml(device.alias)}"`;
  const rolePresentation =
    device.deviceType === 'blank' || device.deviceType === 'shelf'
      ? DEVICE_ROLE_CLASSES[device.deviceType]
      : undefined;
  const roleAttr =
    rolePresentation === undefined
      ? ''
      : ` data-item-role="${rolePresentation.role}"`;

  const groupClass = `rackdown-device-group${rolePresentation?.groupClass ?? ''} rackdown-device-${device.mountFace}${device.unknown ? ' rackdown-device-unknown' : ''}`;
  const rectClass = `rackdown-device${rolePresentation?.rectClass ?? ''}`;
  const labelClass = `rackdown-device-label${rolePresentation?.labelClass ?? ''}${device.uHeight < 1 ? ' rackdown-device-label-compact' : ''}`;

  const clipId = `${id}-clip`;
  const lines = [
    `<g id="${id}" class="${groupClass}" data-device-id="${escapeXml(device.id)}" data-device-type="${escapeXml(device.deviceType)}" data-position-u="${formatNumber(device.positionU)}" data-u-height="${formatNumber(device.uHeight)}" data-mount-face="${device.mountFace}"${alias}${roleAttr}>`,
    `  <clipPath id="${clipId}">`,
    `    <rect x="${formatNumber(device.xMm)}" y="${formatNumber(device.yMm)}" width="${formatNumber(device.widthMm)}" height="${formatNumber(device.heightMm)}" />`,
    `  </clipPath>`,
    `  <title>${escapeXml(device.label)}</title>`,
    `  <rect class="${rectClass}" x="${formatNumber(device.xMm)}" y="${formatNumber(device.yMm)}" width="${formatNumber(device.widthMm)}" height="${formatNumber(device.heightMm)}" />`,
  ];

  if (shouldRenderDeviceLabel(device)) {
    const displayLabel = truncateDeviceLabel(
      device.label,
      device.widthMm,
      device.uHeight,
    );
    lines.push(
      `  <text class="${labelClass}" clip-path="url(#${clipId})" x="${formatNumber(device.xMm + device.widthMm / 2)}" y="${formatNumber(device.yMm + device.heightMm / 2)}" text-anchor="middle" dominant-baseline="middle">${escapeXml(displayLabel)}</text>`,
    );
  }

  lines.push('</g>');
  return lines;
}

function renderExternal(external: ProjectedExternal, id: string): string[] {
  const linkStyle = external.link?.style ?? 'none';
  const targetAttr =
    external.link === undefined
      ? ''
      : ` data-target="${escapeXml(external.link.target)}"`;
  return [
    `<g id="${id}" class="rackdown-external-group" data-external-id="${escapeXml(external.id)}" data-label="${escapeXml(external.label)}" data-link-style="${linkStyle}" data-placement="${external.placement}"${targetAttr}>`,
    `  <title>${escapeXml(external.label)}</title>`,
    `  <rect class="rackdown-external-box" x="${formatNumber(external.xMm)}" y="${formatNumber(external.yMm)}" width="${formatNumber(external.widthMm)}" height="${formatNumber(external.heightMm)}" rx="3" ry="3" />`,
    `  <defs><clipPath id="${id}-label-clip" clipPathUnits="userSpaceOnUse"><rect x="${formatNumber(external.xMm + 4)}" y="${formatNumber(external.yMm + 1)}" width="68.2" height="14" /></clipPath></defs>`,
    `  <text class="rackdown-external-label" x="${formatNumber(external.xMm + 38.1)}" y="${formatNumber(external.yMm + 12)}" text-anchor="middle" clip-path="url(#${id}-label-clip)" style='font-family: Arial, "Liberation Sans", sans-serif; font-size: 10px; font-weight: 400; font-style: normal; font-stretch: normal; text-rendering: geometricPrecision; font-kerning: none; font-variant-ligatures: none; letter-spacing: 0; word-spacing: 0; direction: ltr; unicode-bidi: isolate; dominant-baseline: alphabetic;'>${escapeXml(external.displayLabel)}</text>`,
    '</g>',
  ];
}

/**
 * Shared structural, typography and host custom-property rules together with
 * RackDown's light colour fallbacks.
 */
const SVG_BASE_RULES = `.rackdown-rack { fill: var(--rackdown-rack-fill, #f8fafc); stroke: var(--rackdown-rack-stroke, #475569); stroke-width: var(--rackdown-stroke-width, 1); vector-effect: non-scaling-stroke; }
.rackdown-u-line { stroke: var(--rackdown-u-line, #cbd5e1); stroke-width: var(--rackdown-stroke-width, 0.5); vector-effect: non-scaling-stroke; }
.rackdown-rack-title, .rackdown-u-label, .rackdown-device-label, .rackdown-external-label, .rackdown-empty { fill: var(--rackdown-text, #0f172a); font-family: var(--rackdown-font, ui-sans-serif, system-ui, sans-serif); }
.rackdown-rack-title { font-size: var(--rackdown-title-size, 14px); font-weight: 600; }
.rackdown-u-label { font-size: var(--rackdown-u-label-size, 8.5px); }
.rackdown-device { fill: var(--rackdown-device-fill, #e2e8f0); stroke: var(--rackdown-device-stroke, #334155); stroke-width: var(--rackdown-stroke-width, 1); vector-effect: non-scaling-stroke; }
.rackdown-blank { fill: var(--rackdown-blank-fill, #cbd5e1); stroke: var(--rackdown-blank-stroke, #94a3b8); }
.rackdown-shelf { fill: var(--rackdown-shelf-fill, #f1f5f9); stroke: var(--rackdown-shelf-stroke, #64748b); }
.rackdown-device-unknown .rackdown-device { stroke-dasharray: 3 2; }
.rackdown-device-label { font-size: var(--rackdown-label-size, 12px); font-weight: 600; }
.rackdown-blank-label, .rackdown-shelf-label { fill: var(--rackdown-muted-text, #64748b); font-weight: 500; }
.rackdown-device-label-compact { font-size: var(--rackdown-label-size, 9px); }
.rackdown-connection { fill: none; vector-effect: non-scaling-stroke; }
:where(.rackdown-connection.rackdown-connection-default-width) { stroke-width: var(--rackdown-connection-width, 2); }
:where(.rackdown-connection[data-colour-source="monochrome"]) { stroke: var(--rackdown-connection-stroke, #64748b); }
.rackdown-external-box { fill: var(--rackdown-external-fill, #ffffff); stroke: var(--rackdown-external-stroke, #64748b); stroke-width: var(--rackdown-stroke-width, 1); stroke-dasharray: 3 2; vector-effect: non-scaling-stroke; }
.rackdown-empty { font-size: var(--rackdown-label-size, 10px); }`;

/**
 * Dark colour fallback overrides. Every rule is zero- or single-class
 * specificity and colour-only, so appending it after `SVG_BASE_RULES` selects
 * the dark fallback scheme without disturbing shared structural rules or host
 * custom-property overrides.
 */
const SVG_DARK_RULES = `.rackdown-rack { fill: var(--rackdown-rack-fill, #1e293b); stroke: var(--rackdown-rack-stroke, #94a3b8); }
.rackdown-u-line { stroke: var(--rackdown-u-line, #64748b); }
.rackdown-rack-title, .rackdown-u-label, .rackdown-device-label, .rackdown-external-label, .rackdown-empty { fill: var(--rackdown-text, #e2e8f0); }
.rackdown-device { fill: var(--rackdown-device-fill, #334155); stroke: var(--rackdown-device-stroke, #cbd5e1); }
.rackdown-blank { fill: var(--rackdown-blank-fill, #475569); stroke: var(--rackdown-blank-stroke, #94a3b8); }
.rackdown-shelf { fill: var(--rackdown-shelf-fill, #293548); stroke: var(--rackdown-shelf-stroke, #94a3b8); }
.rackdown-blank-label, .rackdown-shelf-label { fill: var(--rackdown-muted-text, #cbd5e1); }
:where(.rackdown-connection[data-colour-source="monochrome"]) { stroke: var(--rackdown-connection-stroke, #94a3b8); }
.rackdown-external-box { fill: var(--rackdown-external-fill, #0f172a); stroke: var(--rackdown-external-stroke, #94a3b8); }`;

/** Compose the embedded stylesheet for a theme, or omit it entirely. */
function svgStyle(theme: SvgTheme): string | undefined {
  switch (theme) {
    case 'none':
      return undefined;
    case 'light':
      return `<style>\n${SVG_BASE_RULES}\n</style>`;
    case 'dark':
      return `<style>\n${SVG_BASE_RULES}\n${SVG_DARK_RULES}\n</style>`;
    default:
      return `<style>\n${SVG_BASE_RULES}\n@media (prefers-color-scheme: dark) {\n${SVG_DARK_RULES}\n}\n</style>`;
  }
}

function rootDimensionAttributes(
  viewport: Viewport,
  sizing: SvgSizing,
): string {
  switch (sizing) {
    case 'physical':
      return ` width="${formatNumber(viewport.widthMm)}mm" height="${formatNumber(viewport.heightMm)}mm"`;
    case 'responsive':
      return '';
    default:
      return ` width="${formatNumber(viewport.widthMm)}" height="${formatNumber(viewport.heightMm)}"`;
  }
}

function pluralize(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function diagramDescription(
  layout: RackLayout,
  scene: RoutedRenderScene,
): string {
  return `${pluralize(layout.racks.length, 'rack', 'racks')}, ${pluralize(scene.devices.length, 'device', 'devices')}, ${pluralize(scene.connections.length, 'connection', 'connections')}.`;
}

function appendRenderedItems<T>(
  lines: string[],
  items: readonly T[],
  idPrefix: string,
  render: (item: T, id: string) => readonly string[],
): void {
  for (const [index, item] of items.entries()) {
    const id = `${idPrefix}-${index + 1}`;
    for (const line of render(item, id)) {
      lines.push(`  ${line}`);
    }
  }
}

/** Render a resolved RackLayout as a deterministic standalone SVG string. */
export function toSvg(
  layout: RackLayout,
  options: SvgRenderOptions = {},
): string {
  const placement = externalPlacement(options);
  const routing = connectionRouting(options);
  const colourMode = connectionColourMode(options);
  const sizing = svgSizing(options);
  const style = svgStyle(svgTheme(options));
  const namespace = rendererNamespace(layout, options);
  const scene = routeWithMeasuredExternalFloor(
    buildRenderScene(layout, placement, routing),
    routing,
  );
  const viewport = computeViewport(scene);
  const title =
    layout.racks.length === 1 && layout.racks[0]
      ? `${layout.racks[0].name} rack diagram`
      : 'RackDown diagram';
  const description = diagramDescription(layout, scene);
  const dimensions = rootDimensionAttributes(viewport, sizing);
  const lines = [
    `<svg id="${namespace}-root" xmlns="http://www.w3.org/2000/svg"${dimensions} viewBox="${formatNumber(viewport.xMm)} ${formatNumber(viewport.yMm)} ${formatNumber(viewport.widthMm)} ${formatNumber(viewport.heightMm)}" data-external-placement="${placement}" data-connection-routing="${routing}" data-connection-colour-mode="${colourMode}" role="img" aria-labelledby="${namespace}-title" aria-describedby="${namespace}-desc">`,
    `  <title id="${namespace}-title">${escapeXml(title)}</title>`,
    `  <desc id="${namespace}-desc">${escapeXml(description)}</desc>`,
  ];

  if (style !== undefined) {
    lines.push(`  ${style.replaceAll('\n', '\n  ')}`);
  }

  if (scene.racks.length === 0 && scene.devices.length === 0) {
    lines.push(
      `  <text class="rackdown-empty" x="${formatNumber(EMPTY_WIDTH_MM / 2)}" y="${formatNumber(EMPTY_HEIGHT_MM / 2)}" text-anchor="middle" dominant-baseline="middle">No racks</text>`,
    );
  }

  // Emission order is intentional rendering policy:
  // - Racks establish the background geometry.
  // - Connections are emitted before devices so device rectangles paint over
  //   connection lines crossing device interiors.
  // - Devices paint over connections.
  // - Externals are emitted last so external annotations remain visible.
  appendRenderedItems(
    lines,
    scene.racks,
    `${namespace}-rack-view`,
    (rack, id) => renderRack(rack, id),
  );
  const connectionDeviceById = new Map(
    scene.devices.map((device) => [device.id, device]),
  );
  appendRenderedItems(
    lines,
    scene.connections,
    `${namespace}-connection`,
    (connection, id) =>
      renderConnection(connection, id, options, connectionDeviceById),
  );
  appendRenderedItems(
    lines,
    scene.devices,
    `${namespace}-device`,
    (device, id) => renderDevice(device, id),
  );
  appendRenderedItems(
    lines,
    scene.externals,
    `${namespace}-external`,
    (external, id) => renderExternal(external, id),
  );

  lines.push('</svg>');
  return lines.join('\n');
}
