import type { ConnectionCategory } from './connection-category.js';
import {
  type ConnectionSelection,
  selectConnections,
} from './connection-selection.js';
import type { RackFace } from './document.js';
import type {
  LayoutConnectionEndpoint,
  LayoutDevice,
  LayoutRack,
  RackLayout,
} from './layout.js';

export interface CableScheduleDeviceEndpoint {
  kind: 'device';
  label: string;
  deviceId: string;
  alias?: string;
  portName?: string;
  rackId: string;
  rackName: string;
  positionU: number;
  mountFace: RackFace;
}

export interface CableScheduleExternalEndpoint {
  kind: 'external';
  label: string;
  externalId: string;
}

export type CableScheduleEndpoint =
  | CableScheduleDeviceEndpoint
  | CableScheduleExternalEndpoint;

export interface CableScheduleRow {
  connectionId: string;
  category: ConnectionCategory;
  media?: string;
  a: CableScheduleEndpoint;
  b: CableScheduleEndpoint;
}

function scheduleEndpoint(
  endpoint: LayoutConnectionEndpoint,
  devicesById: ReadonlyMap<string, LayoutDevice>,
  racksById: ReadonlyMap<string, LayoutRack>,
): CableScheduleEndpoint {
  if (endpoint.kind === 'external') {
    return {
      kind: 'external',
      label: endpoint.label,
      externalId: endpoint.externalId,
    };
  }

  const device = devicesById.get(endpoint.deviceId);
  if (!device) {
    throw new Error(
      `Connection endpoint refers to missing device "${endpoint.deviceId}".`,
    );
  }
  const rack = racksById.get(device.rackId);
  if (!rack) {
    throw new Error(
      `Device "${device.id}" refers to missing rack "${device.rackId}".`,
    );
  }

  return {
    kind: 'device',
    label: device.label,
    deviceId: device.id,
    ...(device.alias === undefined ? {} : { alias: device.alias }),
    ...(endpoint.portName === undefined ? {} : { portName: endpoint.portName }),
    rackId: rack.id,
    rackName: rack.name,
    positionU: device.positionU,
    mountFace: device.mountFace,
  };
}

/**
 * Projects selected semantic connections into host-neutral schedule rows.
 * Rows retain connection source order and neutral endpoint ordering.
 */
export function buildCableSchedule(
  layout: RackLayout,
  selection: ConnectionSelection = {},
): readonly CableScheduleRow[] {
  const devicesById = new Map(
    layout.devices.map((device) => [device.id, device]),
  );
  const racksById = new Map(layout.racks.map((rack) => [rack.id, rack]));

  return selectConnections(layout, selection).map((connection) => ({
    connectionId: connection.id,
    category: connection.category,
    ...(connection.media === undefined ? {} : { media: connection.media }),
    a: scheduleEndpoint(connection.from, devicesById, racksById),
    b: scheduleEndpoint(connection.to, devicesById, racksById),
  }));
}
