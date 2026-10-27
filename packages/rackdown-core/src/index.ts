export type {
  CableScheduleDeviceEndpoint,
  CableScheduleEndpoint,
  CableScheduleExternalEndpoint,
  CableScheduleRow,
} from './cable-schedule.js';
export { buildCableSchedule } from './cable-schedule.js';
export type { ConnectionCategory } from './connection-category.js';
export type { ConnectionSelection } from './connection-selection.js';
export { selectConnections } from './connection-selection.js';
export type {
  DeviceDefinition,
  DeviceIndex,
  DevicePortDefinition,
} from './devices.js';
export type { Diagnostic, DiagnosticSeverity } from './diagnostics.js';
export type {
  ConnectionEndpointReference,
  ConnectionStatement,
  DeviceEndpointReference,
  DevicePlacement,
  DocumentNote,
  ExternalEndpointReference,
  ExternalLinkIntent,
  ExternalLinkStyle,
  ParsedNoteTarget,
  RackDeclaration,
  RackDocument,
  RackFace,
  RackU1Position,
  ResolvedNoteTarget,
} from './document.js';
export type {
  LayoutBounds,
  LayoutConnection,
  LayoutConnectionEndpoint,
  LayoutDevice,
  LayoutDeviceEndpoint,
  LayoutDeviceMetadata,
  LayoutExternal,
  LayoutExternalEndpoint,
  LayoutNote,
  LayoutPort,
  LayoutRack,
  PointMm,
  RackLayout,
  RectMm,
} from './layout.js';
export { parse } from './parser.js';
export type {
  ConnectionColourMode,
  ConnectionPattern,
  ConnectionVisualStyle,
  SvgConnectionRouting,
  SvgExternalPlacement,
  SvgRenderOptions,
  SvgSizing,
  SvgTheme,
} from './renderer.js';
export { toSvg } from './renderer.js';
export { resolve } from './resolver.js';
export type { SourcePosition, SourceSpan } from './source.js';
export {
  inchesToMm,
  MILLIMETRES_PER_INCH,
  RACK_UNIT_MM,
  rackUnitsToMm,
} from './units.js';
