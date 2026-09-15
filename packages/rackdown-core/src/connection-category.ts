import type { ConnectionStatement } from './document.js';
import type { LayoutConnectionEndpoint, LayoutDevice } from './layout.js';

export type ConnectionCategory =
  | 'power'
  | 'network'
  | 'console'
  | 'unclassified';
export type ConnectionCategoryReason =
  | 'explicit'
  | 'invalid-explicit'
  | 'one-endpoint'
  | 'both-endpoints'
  | 'conflicting-endpoints'
  | 'no-evidence';

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
): { category: ConnectionCategory; categoryReason: ConnectionCategoryReason } {
  if (statement.category !== undefined) {
    return isConnectionCategory(statement.category)
      ? { category: statement.category, categoryReason: 'explicit' }
      : { category: 'unclassified', categoryReason: 'invalid-explicit' };
  }
  const left = endpointCategory(from, devices);
  const right = endpointCategory(to, devices);
  if (left !== undefined && right !== undefined && left !== right) {
    return {
      category: 'unclassified',
      categoryReason: 'conflicting-endpoints',
    };
  }
  return {
    category: left ?? right ?? 'unclassified',
    categoryReason:
      left !== undefined && right !== undefined
        ? 'both-endpoints'
        : left !== undefined || right !== undefined
          ? 'one-endpoint'
          : 'no-evidence',
  };
}
