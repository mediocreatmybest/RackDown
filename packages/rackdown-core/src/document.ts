import type { ConnectionCategory } from './connection-category.js';
import type { Diagnostic } from './diagnostics.js';
import type { SourceSpan } from './source.js';

export type RackFace = 'front' | 'rear';
export type RackU1Position = 'top' | 'bottom';

export interface RackDeclaration {
  kind: 'rack';
  id: string;
  name: string;
  /** Total rack height in whole rack units (e.g. 42 for 42U). Racks require integer heights. */
  units: number;
  widthInches?: number;
  u1: RackU1Position;
  views: RackFace[];
  source: SourceSpan;
}

export interface DevicePlacement {
  kind: 'device';
  id: string;
  rackId: string;
  positionU: number;
  deviceType: string;
  label: string;
  alias?: string;
  explicitUHeight?: number;
  mountFace: RackFace;
  source: SourceSpan;
  explicitLabel?: boolean;
}

export interface DeviceEndpointReference {
  kind: 'device';
  device: string;
  port?: string;
  /** Author intent that an otherwise unknown endpoint is deliberately ad-hoc. */
  adHoc?: boolean;
}

export type ExternalLinkStyle = 'wiki' | 'markdown';

export interface ExternalLinkIntent {
  style: ExternalLinkStyle;
  target: string;
}

export interface ExternalEndpointReference {
  kind: 'external';
  label: string;
  link?: ExternalLinkIntent;
}

export type ConnectionEndpointReference =
  | DeviceEndpointReference
  | ExternalEndpointReference;

export interface ConnectionStatement {
  kind: 'connection';
  id: string;
  from: ConnectionEndpointReference;
  to: ConnectionEndpointReference;
  /** Free-form descriptive media such as "fibre" or "power". */
  media?: string;
  /** Explicit author intent; invalid annotations suppress inference during recovery. */
  category?: ConnectionCategory | 'invalid';
  source: SourceSpan;
}

/** Parsed author intent. Invalid lines are represented by diagnostics, not exceptions. */
export interface RackDocument {
  schemaVersion: 1;
  racks: RackDeclaration[];
  devices: DevicePlacement[];
  connections: ConnectionStatement[];
  diagnostics: Diagnostic[];
}
