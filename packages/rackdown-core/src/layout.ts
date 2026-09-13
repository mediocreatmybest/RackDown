import type { Diagnostic } from './diagnostics.js';
import type {
  ExternalLinkIntent,
  RackFace,
  RackU1Position,
} from './document.js';

export interface PointMm {
  xMm: number;
  yMm: number;
}

export interface RectMm extends PointMm {
  widthMm: number;
  heightMm: number;
}

export interface LayoutBounds {
  widthMm: number;
  heightMm: number;
}

export interface LayoutRack extends RectMm {
  id: string;
  name: string;
  units: number;
  widthInches: number;
  u1: RackU1Position;
  views: RackFace[];
}

export interface LayoutPort {
  name: string;
  kind?: string;
  type?: string;
  managementOnly?: boolean;
  poeMode?: string;
  poeType?: string;
  anchor: PointMm;
  adHoc: boolean;
}

export interface LayoutDeviceMetadata {
  manufacturer?: string;
  model?: string;
  partNumber?: string;
  airflow?: string;
  fullDepth?: boolean;
}

export interface LayoutDevice extends RectMm {
  id: string;
  rackId: string;
  label: string;
  deviceType: string;
  alias?: string;
  positionU: number;
  uHeight: number;
  mountFace: RackFace;
  unknown: boolean;
  metadata?: LayoutDeviceMetadata;
  ports: LayoutPort[];
  explicitLabel?: boolean;
}

export interface LayoutDeviceEndpoint {
  kind: 'device';
  deviceId: string;
  portName?: string;
  anchor: PointMm;
  adHocPort: boolean;
}

export interface LayoutExternalEndpoint {
  kind: 'external';
  externalId: string;
  label: string;
  link?: ExternalLinkIntent;
}

export type LayoutConnectionEndpoint =
  | LayoutDeviceEndpoint
  | LayoutExternalEndpoint;

export interface LayoutConnection {
  id: string;
  from: LayoutConnectionEndpoint;
  to: LayoutConnectionEndpoint;
  media?: string;
}

export interface LayoutExternal {
  id: string;
  label: string;
  link?: ExternalLinkIntent;
}

/**
 * Resolved rack model consumed by renderers. Physical geometry is expressed in
 * millimetres; semantic external targets deliberately carry no renderer
 * annotation geometry.
 */
export interface RackLayout {
  schemaVersion: 1;
  racks: LayoutRack[];
  devices: LayoutDevice[];
  connections: LayoutConnection[];
  externals: LayoutExternal[];
  diagnostics: Diagnostic[];
  bounds: LayoutBounds;
}
