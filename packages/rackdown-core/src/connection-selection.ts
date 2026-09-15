import type { ConnectionCategory } from './connection-category.js';
import type { LayoutConnection } from './layout.js';

export interface ConnectionSelection {
  /** Exact categories; `all` is represented by omitting restrictions. */
  categories?: readonly ConnectionCategory[];
  /** Either device endpoint, one hop only; use resolved LayoutDevice.id values. */
  deviceIds?: readonly string[];
  connectionIds?: readonly string[];
}

/**
 * OR within each restriction; AND between restrictions. Empty lists match nothing.
 * Returns original connections in source order without mutating the input.
 */
export function selectConnections(
  layout: { readonly connections: readonly LayoutConnection[] },
  selection: ConnectionSelection = {},
): readonly LayoutConnection[] {
  const categories =
    selection.categories === undefined
      ? undefined
      : new Set(selection.categories);
  const devices =
    selection.deviceIds === undefined
      ? undefined
      : new Set(selection.deviceIds);
  const ids =
    selection.connectionIds === undefined
      ? undefined
      : new Set(selection.connectionIds);
  return layout.connections.filter(
    (connection) =>
      (categories === undefined ||
        categories.has(connection.category ?? 'unclassified')) &&
      (ids === undefined || ids.has(connection.id)) &&
      (devices === undefined ||
        (connection.from.kind === 'device' &&
          devices.has(connection.from.deviceId)) ||
        (connection.to.kind === 'device' &&
          devices.has(connection.to.deviceId))),
  );
}
