import { classifyConnection } from './connection-category.js';
import type {
  DeviceDefinition,
  DeviceIndex,
  DevicePortDefinition,
} from './devices.js';
import type { Diagnostic } from './diagnostics.js';
import type {
  ConnectionEndpointReference,
  ConnectionStatement,
  DevicePlacement,
  ExternalLinkIntent,
  RackDocument,
  RackFace,
} from './document.js';
import type {
  LayoutConnection,
  LayoutConnectionEndpoint,
  LayoutDevice,
  LayoutDeviceMetadata,
  LayoutExternal,
  LayoutPort,
  LayoutRack,
  PointMm,
  RackLayout,
} from './layout.js';
import type { SourceSpan } from './source.js';
import {
  DEFAULT_RACK_WIDTH_INCHES,
  DIAGRAM_RACK_WIDTH_MM,
  rackUnitsToMm,
} from './units.js';

const RACK_GAP_MM = 25.4;
const MAX_KNOWN_ENDPOINT_HINTS = 12;

const GENERIC_DEVICE_TYPES = new Set([
  'server',
  'switch',
  'router',
  'firewall',
  'patch',
  'ups',
  'pdu',
  'shelf',
  'blank',
  'device',
]);

interface Occupancy {
  rackId: string;
  mountFace: RackFace;
  startU: number;
  endU: number;
  placement: DevicePlacement;
}

interface ResolvedDeviceReference {
  kind: 'device';
  device: LayoutDevice;
  definition?: DeviceDefinition;
  port?: string;
  adHoc?: boolean;
}

interface ResolvedExternalReference {
  kind: 'external';
  label: string;
  link?: ExternalLinkIntent;
}

type ResolvedEndpointReference =
  | ResolvedDeviceReference
  | ResolvedExternalReference;

// Placement coexistence policy:
// - blanks never coexist with other placements;
// - a shelf may coexist with non-shelf devices hosted on it;
// - shelves cannot stack with other shelves;
// - ordinary devices may coexist only when sharing an identical vertical span
//   (see ADR 0012 for shared-row semantics).
function isCoexistingPlacement(
  a: DevicePlacement,
  b: DevicePlacement,
  aStartU: number,
  aEndU: number,
  bStartU: number,
  bEndU: number,
): boolean {
  const aIsShelf = a.deviceType === 'shelf';
  const bIsShelf = b.deviceType === 'shelf';
  const aIsBlank = a.deviceType === 'blank';
  const bIsBlank = b.deviceType === 'blank';

  if (aIsBlank || bIsBlank) {
    return false;
  }

  if ((aIsShelf && !bIsShelf) || (bIsShelf && !aIsShelf)) {
    return true;
  }

  if (aIsShelf && bIsShelf) {
    return false;
  }

  return aStartU === bStartU && aEndU === bEndU;
}

function deviceEndpointAnchor(device: LayoutDevice): PointMm {
  return {
    xMm: device.xMm + device.widthMm,
    yMm: device.yMm + device.heightMm / 2,
  };
}

// See ADR 0012 for equal-width shared-row geometry.
function applySharedRowGeometry(
  devices: LayoutDevice[],
  rackById: ReadonlyMap<string, LayoutRack>,
): void {
  const rows = new Map<string, LayoutDevice[]>();

  for (const device of devices) {
    if (device.deviceType === 'shelf' || device.deviceType === 'blank') {
      continue;
    }
    const key = JSON.stringify([
      device.rackId,
      device.mountFace,
      device.positionU,
      device.uHeight,
    ]);
    const row = rows.get(key);
    if (row) {
      row.push(device);
    } else {
      rows.set(key, [device]);
    }
  }

  for (const row of rows.values()) {
    if (row.length < 2) {
      continue;
    }

    const rack = rackById.get(row[0]?.rackId ?? '');
    if (!rack) {
      continue;
    }

    const slotWidthMm = rack.widthMm / row.length;
    for (const [index, device] of row.entries()) {
      device.xMm = rack.xMm + index * slotWidthMm;
      device.widthMm =
        index === row.length - 1
          ? rack.xMm + rack.widthMm - device.xMm
          : slotWidthMm;

      const anchor = deviceEndpointAnchor(device);
      for (const port of device.ports) {
        port.anchor = { ...anchor };
      }
    }
  }
}

function layoutDeviceMetadata(
  definition: DeviceDefinition | undefined,
): LayoutDeviceMetadata | undefined {
  if (!definition) {
    return undefined;
  }

  const metadata: LayoutDeviceMetadata = {
    ...(definition.manufacturer === undefined
      ? {}
      : { manufacturer: definition.manufacturer }),
    ...(definition.model === undefined ? {} : { model: definition.model }),
    ...(definition.partNumber === undefined
      ? {}
      : { partNumber: definition.partNumber }),
    ...(definition.airflow === undefined
      ? {}
      : { airflow: definition.airflow }),
    ...(definition.fullDepth === undefined
      ? {}
      : { fullDepth: definition.fullDepth }),
  };

  return Object.keys(metadata).length === 0 ? undefined : metadata;
}

function layoutPortFromDefinition(
  port: DevicePortDefinition,
  anchor: PointMm,
): LayoutPort {
  return {
    name: port.name,
    ...(port.kind === undefined ? {} : { kind: port.kind }),
    ...(port.type === undefined ? {} : { type: port.type }),
    ...(port.managementOnly === undefined
      ? {}
      : { managementOnly: port.managementOnly }),
    ...(port.poeMode === undefined ? {} : { poeMode: port.poeMode }),
    ...(port.poeType === undefined ? {} : { poeType: port.poeType }),
    anchor: { ...anchor },
    adHoc: false,
  };
}

function addCandidate(
  index: Map<string, LayoutDevice[]>,
  key: string | undefined,
  device: LayoutDevice,
): void {
  if (!key) {
    return;
  }
  const existing = index.get(key);
  if (existing) {
    existing.push(device);
  } else {
    index.set(key, [device]);
  }
}

function findKnownPort(
  definition: DeviceDefinition | undefined,
  reference: string,
): DevicePortDefinition | 'ambiguous' | undefined {
  const ports = definition?.ports ?? [];
  const folded = reference.toLowerCase();
  // See ADR 0003 for layered endpoint resolution:
  // exact name -> exact label/alias -> case-insensitive match.
  // Ambiguity is rejected at the first matching layer.
  const layers = [
    ports.filter((port) => port.name === reference),
    ports.filter(
      (port) => port.label === reference || port.aliases?.includes(reference),
    ),
    ports.filter(
      (port) =>
        port.name.toLowerCase() === folded ||
        port.label?.toLowerCase() === folded ||
        port.aliases?.some((alias) => alias.toLowerCase() === folded),
    ),
  ];
  for (const candidates of layers) {
    if (candidates.length > 1) return 'ambiguous';
    if (candidates.length === 1) return candidates[0];
  }
  return undefined;
}

function knownEndpointHint(
  device: LayoutDevice,
  ports: readonly DevicePortDefinition[],
): string {
  const visiblePorts = ports
    .slice(0, MAX_KNOWN_ENDPOINT_HINTS)
    .map((port) =>
      port.label && port.label !== port.name
        ? `${port.name} (${port.label})`
        : port.name,
    );
  const hiddenCount = ports.length - visiblePorts.length;
  const suffix = hiddenCount > 0 ? `, ... and ${hiddenCount} more` : '';
  return `Known endpoints for "${device.deviceType}": ${visiblePorts.join(', ')}${suffix}.`;
}

function ensureLayoutPort(
  device: LayoutDevice,
  name: string,
  anchor: PointMm,
  adHoc: boolean,
  definition?: DevicePortDefinition,
): LayoutPort {
  const existing = device.ports.find(
    (port) => port.name === name && port.adHoc === adHoc,
  );
  if (existing) {
    return existing;
  }

  const port: LayoutPort =
    definition === undefined
      ? {
          name,
          anchor: { ...anchor },
          adHoc,
        }
      : {
          ...layoutPortFromDefinition(definition, anchor),
          adHoc,
        };
  device.ports.push(port);
  return port;
}

function warnAt(
  diagnostics: Diagnostic[],
  source: SourceSpan,
  message: string,
  hint?: string,
): void {
  diagnostics.push({
    severity: 'warn',
    line: source.start.line,
    column: source.start.column,
    message,
    ...(hint === undefined ? {} : { hint }),
  });
}

/** Resolve parsed author intent into deterministic physical rack geometry. */
export function resolve(
  document: RackDocument,
  devices: DeviceIndex = {},
): RackLayout {
  const diagnostics: Diagnostic[] = [...document.diagnostics];
  const racks: LayoutRack[] = [];
  const rackById = new Map<string, LayoutRack>();

  let nextRackXmm = 0;
  let maxRackHeightMm = 0;

  for (const declaration of document.racks) {
    // widthInches is semantic source metadata; diagram geometry intentionally
    // uses one common rack width.
    const widthInches = declaration.widthInches ?? DEFAULT_RACK_WIDTH_INCHES;
    const widthMm = DIAGRAM_RACK_WIDTH_MM;
    const heightMm = rackUnitsToMm(declaration.units);
    const rack: LayoutRack = {
      id: declaration.id,
      name: declaration.name,
      units: declaration.units,
      widthInches,
      u1: declaration.u1,
      views: [...declaration.views],
      xMm: nextRackXmm,
      yMm: 0,
      widthMm,
      heightMm,
    };

    racks.push(rack);
    rackById.set(rack.id, rack);
    nextRackXmm += widthMm + RACK_GAP_MM;
    maxRackHeightMm = Math.max(maxRackHeightMm, heightMm);
  }

  const layoutDevices: LayoutDevice[] = [];
  const occupancies: Occupancy[] = [];
  const aliases = new Map<string, DevicePlacement>();
  const placementByDeviceId = new Map<string, DevicePlacement>();
  const definitionByDeviceId = new Map<string, DeviceDefinition | undefined>();

  for (const placement of document.devices) {
    const rack = rackById.get(placement.rackId);
    if (!rack) {
      warnAt(
        diagnostics,
        placement.source,
        `Device "${placement.label}" refers to an unknown rack; ignoring it.`,
      );
      continue;
    }

    if (placement.alias) {
      const previous = aliases.get(placement.alias);
      if (previous) {
        warnAt(
          diagnostics,
          placement.source,
          `Duplicate device alias: ${placement.alias}`,
          `Alias was already used by "${previous.label}" on line ${previous.source.start.line}.`,
        );
      } else {
        aliases.set(placement.alias, placement);
      }
    }

    const definition = Object.hasOwn(devices, placement.deviceType)
      ? devices[placement.deviceType]
      : undefined;
    const unknown =
      definition === undefined &&
      !GENERIC_DEVICE_TYPES.has(placement.deviceType);
    if (unknown) {
      warnAt(
        diagnostics,
        placement.source,
        `Unknown device definition: ${placement.deviceType}`,
        'Using generic 1U geometry unless an explicit height was provided.',
      );
    }

    let uHeight = placement.explicitUHeight ?? definition?.uHeight ?? 1;
    if (placement.explicitUHeight === undefined && definition?.uHeight === 0) {
      warnAt(
        diagnostics,
        placement.source,
        `Device "${placement.label}" has 0U catalogue height; using 1U placeholder geometry.`,
        'Specify an explicit height such as 0.5U or 1U.',
      );
      uHeight = 1;
    } else if (!Number.isFinite(uHeight) || uHeight <= 0) {
      warnAt(
        diagnostics,
        placement.source,
        `Invalid device height ${uHeight}U; using 1U.`,
      );
      uHeight = 1;
    }

    if (
      placement.explicitUHeight !== undefined &&
      definition?.uHeight !== undefined &&
      definition.uHeight > 0 &&
      placement.explicitUHeight !== definition.uHeight
    ) {
      warnAt(
        diagnostics,
        placement.source,
        `Explicit height ${placement.explicitUHeight}U differs from known ${definition.uHeight}U height.`,
        'The explicit source height wins.',
      );
    }

    const positionU = Number.isFinite(placement.positionU)
      ? placement.positionU
      : 1;
    if (!Number.isFinite(placement.positionU)) {
      warnAt(
        diagnostics,
        placement.source,
        'Invalid rack position; using U1 for layout.',
      );
    }

    const startU = positionU - 1;
    const endU = startU + uHeight;
    const startsBelowRack = positionU < 1;
    if (startsBelowRack) {
      warnAt(
        diagnostics,
        placement.source,
        `Invalid rack position U${positionU}; rack positions begin at U1.`,
      );
    }

    // Only the upper bound is checked here. `startU < 0` is exactly
    // `startsBelowRack`, which the actionable position warning above already
    // reports, so testing it again would only restate the same mistake. A
    // placement that also extends past the top of the rack still warns.
    if (endU > rack.units) {
      warnAt(
        diagnostics,
        placement.source,
        `Device "${placement.label}" extends beyond rack "${rack.name}" bounds.`,
      );
    }

    for (const previous of occupancies) {
      const overlaps =
        previous.rackId === rack.id &&
        previous.mountFace === placement.mountFace &&
        startU < previous.endU &&
        previous.startU < endU;
      if (
        overlaps &&
        !isCoexistingPlacement(
          placement,
          previous.placement,
          startU,
          endU,
          previous.startU,
          previous.endU,
        )
      ) {
        warnAt(
          diagnostics,
          placement.source,
          `Device "${placement.label}" overlaps "${previous.placement.label}".`,
          `Both placements occupy the same ${placement.mountFace} vertical space in rack "${rack.name}".`,
        );
      }
    }

    const topOffsetU = rack.u1 === 'top' ? startU : rack.units - endU;
    const label =
      definition?.model && placement.label === placement.deviceType
        ? definition.model
        : placement.label;
    const yMm = rack.yMm + rackUnitsToMm(topOffsetU);
    const heightMm = rackUnitsToMm(uHeight);
    const portAnchor = {
      xMm: rack.xMm + rack.widthMm,
      yMm: yMm + heightMm / 2,
    };
    const metadata = layoutDeviceMetadata(definition);
    const device: LayoutDevice = {
      id: placement.id,
      rackId: rack.id,
      label,
      deviceType: placement.deviceType,
      ...(placement.alias === undefined ? {} : { alias: placement.alias }),
      positionU,
      uHeight,
      mountFace: placement.mountFace,
      unknown,
      ...(metadata === undefined ? {} : { metadata }),
      ports: (definition?.ports ?? []).map((port) =>
        layoutPortFromDefinition(port, portAnchor),
      ),
      xMm: rack.xMm,
      yMm,
      widthMm: rack.widthMm,
      heightMm,
      ...(placement.explicitLabel === undefined
        ? {}
        : { explicitLabel: placement.explicitLabel }),
    };

    layoutDevices.push(device);
    placementByDeviceId.set(device.id, placement);
    definitionByDeviceId.set(device.id, definition);
    occupancies.push({
      rackId: rack.id,
      mountFace: placement.mountFace,
      startU,
      endU,
      placement,
    });
  }

  applySharedRowGeometry(layoutDevices, rackById);

  const aliasIndex = new Map<string, LayoutDevice[]>();
  const labelIndex = new Map<string, LayoutDevice[]>();
  const foldedLabelIndex = new Map<string, LayoutDevice[]>();
  const typeIndex = new Map<string, LayoutDevice[]>();
  const foldedTypeIndex = new Map<string, LayoutDevice[]>();

  for (const device of layoutDevices) {
    const placement = placementByDeviceId.get(device.id);
    if (!placement) {
      continue;
    }
    addCandidate(aliasIndex, placement.alias, device);
    addCandidate(labelIndex, placement.label, device);
    addCandidate(foldedLabelIndex, placement.label.toLowerCase(), device);
    addCandidate(typeIndex, placement.deviceType, device);
    addCandidate(foldedTypeIndex, placement.deviceType.toLowerCase(), device);
  }

  function resolveDeviceReference(
    reference: string,
    statement: ConnectionStatement,
  ): LayoutDevice | undefined {
    const folded = reference.toLowerCase();
    // See ADR 0003 for layered endpoint resolution:
    // alias -> exact label -> case-folded label -> exact type -> case-folded type.
    // Ambiguity is rejected at the first matching layer.
    const layers = [
      aliasIndex.get(reference),
      labelIndex.get(reference),
      foldedLabelIndex.get(folded),
      typeIndex.get(reference),
      foldedTypeIndex.get(folded),
    ];

    for (const candidates of layers) {
      if (!candidates) {
        continue;
      }
      if (candidates.length === 1) {
        return candidates[0];
      }
      warnAt(
        diagnostics,
        statement.source,
        `Ambiguous device reference: ${reference}`,
        `Matches: ${candidates.map((candidate) => candidate.label).join(', ')}.`,
      );
      return undefined;
    }

    warnAt(
      diagnostics,
      statement.source,
      `Unresolved device reference: ${reference}`,
      'Use a unique alias, label or device slug/type.',
    );
    return undefined;
  }

  function resolveEndpointReference(
    endpoint: ConnectionEndpointReference,
    statement: ConnectionStatement,
  ): ResolvedEndpointReference | undefined {
    if (endpoint.kind === 'external') {
      return {
        kind: 'external',
        label: endpoint.label,
        ...(endpoint.link === undefined ? {} : { link: endpoint.link }),
      };
    }

    const device = resolveDeviceReference(endpoint.device, statement);
    if (!device) {
      return undefined;
    }
    const definition = definitionByDeviceId.get(device.id);
    return {
      kind: 'device',
      device,
      ...(definition === undefined ? {} : { definition }),
      ...(endpoint.port === undefined ? {} : { port: endpoint.port }),
      ...(endpoint.adHoc === undefined ? {} : { adHoc: endpoint.adHoc }),
    };
  }

  function externalSemanticKey(
    label: string,
    link?: ExternalLinkIntent,
  ): string {
    return JSON.stringify([label, link?.style ?? null, link?.target ?? null]);
  }

  const rackWidthMm = racks.length === 0 ? 0 : nextRackXmm - RACK_GAP_MM;
  const externals: LayoutExternal[] = [];
  const externalByKey = new Map<string, LayoutExternal>();

  function getExternal(
    label: string,
    link?: ExternalLinkIntent,
  ): LayoutExternal {
    const key = externalSemanticKey(label, link);
    const existing = externalByKey.get(key);
    if (existing) {
      return existing;
    }

    const external: LayoutExternal = {
      id: `external-${externals.length + 1}`,
      label,
      ...(link === undefined ? {} : { link }),
    };
    externals.push(external);
    externalByKey.set(key, external);
    return external;
  }

  function materialiseEndpoint(
    reference: ResolvedEndpointReference,
    statement: ConnectionStatement,
  ): LayoutConnectionEndpoint {
    if (reference.kind === 'external') {
      const external = getExternal(reference.label, reference.link);
      return {
        kind: 'external',
        externalId: external.id,
        label: external.label,
        ...(external.link === undefined ? {} : { link: external.link }),
      };
    }

    const anchor = deviceEndpointAnchor(reference.device);
    if (reference.port === undefined) {
      return {
        kind: 'device',
        deviceId: reference.device.id,
        anchor,
        adHocPort: false,
      };
    }

    const knownPort = findKnownPort(reference.definition, reference.port);
    if (knownPort && knownPort !== 'ambiguous') {
      const layoutPort = ensureLayoutPort(
        reference.device,
        knownPort.name,
        anchor,
        false,
        knownPort,
      );
      return {
        kind: 'device',
        deviceId: reference.device.id,
        portName: layoutPort.name,
        anchor: { ...layoutPort.anchor },
        adHocPort: false,
      };
    }

    const knownPorts = reference.definition?.ports ?? [];
    if (knownPort === 'ambiguous') {
      warnAt(
        diagnostics,
        statement.source,
        `Ambiguous port "${reference.port}" on "${reference.device.label}"; preserving it as an ad-hoc endpoint.`,
        knownEndpointHint(reference.device, knownPorts),
      );
    } else if (knownPorts.length > 0 && !reference.adHoc) {
      warnAt(
        diagnostics,
        statement.source,
        `Unknown port "${reference.port}" on "${reference.device.label}"; preserving it as an ad-hoc endpoint.`,
        knownEndpointHint(reference.device, knownPorts),
      );
    }

    const layoutPort = ensureLayoutPort(
      reference.device,
      reference.port,
      anchor,
      true,
    );
    return {
      kind: 'device',
      deviceId: reference.device.id,
      portName: layoutPort.name,
      anchor: { ...layoutPort.anchor },
      adHocPort: true,
    };
  }

  const devicesById = new Map(
    layoutDevices.map((device) => [device.id, device]),
  );
  const connections: LayoutConnection[] = [];
  for (const statement of document.connections) {
    const fromReference = resolveEndpointReference(statement.from, statement);
    const toReference = resolveEndpointReference(statement.to, statement);
    if (!fromReference || !toReference) {
      continue;
    }

    const from = materialiseEndpoint(fromReference, statement);
    const to = materialiseEndpoint(toReference, statement);
    connections.push({
      id: statement.id,
      category: classifyConnection(statement, from, to, devicesById),
      from,
      to,
      ...(statement.media === undefined ? {} : { media: statement.media }),
    });
  }

  return {
    schemaVersion: 2,
    racks,
    devices: layoutDevices,
    connections,
    externals,
    diagnostics,
    bounds: {
      widthMm: rackWidthMm,
      heightMm: maxRackHeightMm,
    },
  };
}
