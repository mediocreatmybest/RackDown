import type { ConnectionStatement } from './document.js';
import type { LayoutConnectionEndpoint, LayoutDevice } from './layout.js';

export type ConnectionCategory =
  | 'power'
  | 'network'
  | 'console'
  | 'unclassified';
export function isConnectionCategory(
  value: unknown,
): value is ConnectionCategory {
  return (
    value === 'power' ||
    value === 'network' ||
    value === 'console' ||
    value === 'unclassified'
  );
}

function endpointCategory(
  endpoint: LayoutConnectionEndpoint,
  devices: ReadonlyMap<string, LayoutDevice>,
): ConnectionCategory | undefined {
  if (
    endpoint.kind !== 'device' ||
    endpoint.adHocPort ||
    endpoint.portName === undefined
  )
    return undefined;
  const ports =
    devices
      .get(endpoint.deviceId)
      ?.ports.filter(
        (port) => !port.adHoc && port.name === endpoint.portName,
      ) ?? [];
  if (ports.length !== 1) return undefined;
  switch (ports[0]?.kind) {
    case 'power-port':
    case 'power-outlet':
      return 'power';
    case 'interface':
      return 'network';
    case 'console-port':
    case 'console-server-port':
      return 'console';
    default:
      return undefined;
  }
}

/** Classify only resolved facts; never rematch aliases or traverse other cables. */
export function classifyConnection(
  statement: ConnectionStatement,
  from: LayoutConnectionEndpoint,
  to: LayoutConnectionEndpoint,
  devices: ReadonlyMap<string, LayoutDevice>,
): ConnectionCategory {
  if (statement.category !== undefined) {
    return isConnectionCategory(statement.category)
      ? statement.category
      : 'unclassified';
  }
  const left = endpointCategory(from, devices);
  const right = endpointCategory(to, devices);
  if (left !== undefined && right !== undefined && left !== right) {
    return 'unclassified';
  }
  return left ?? right ?? 'unclassified';
}
