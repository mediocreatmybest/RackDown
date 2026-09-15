import {
  type DeviceIndex,
  type Diagnostic,
  parse,
  type RackLayout,
  resolve,
  type SvgRenderOptions,
  toSvg,
} from '@rackdown/core';
import {
  type RackDownPluginSettings,
  resolveObsidianRenderOptions,
} from './settings.js';

export interface RackDownRenderedDevice {
  id: string;
  label: string;
}

export interface RackDownRenderResult {
  svg: string;
  diagnostics: readonly Diagnostic[];
  devices: readonly RackDownRenderedDevice[];
}

export interface PreparedRackDown {
  layout: RackLayout;
  diagnostics: readonly Diagnostic[];
  devices: readonly RackDownRenderedDevice[];
}

/** Parse and resolve document semantics once for a rendered Markdown block. */
export function prepareRackDown(
  source: string,
  devices: DeviceIndex = {},
): PreparedRackDown {
  const layout = resolve(parse(source), devices);

  return {
    layout,
    diagnostics: layout.diagnostics,
    devices: layout.devices.map(({ id, label }) => ({ id, label })),
  };
}

/** Render another SVG view without reparsing or resolving the document. */
export function renderPreparedRackDown(
  prepared: PreparedRackDown,
  options?: SvgRenderOptions,
  settings?: RackDownPluginSettings,
): RackDownRenderResult {
  return {
    svg: toSvg(
      prepared.layout,
      resolveObsidianRenderOptions(options, settings),
    ),
    diagnostics: prepared.diagnostics,
    devices: prepared.devices,
  };
}

export function renderRackDown(
  source: string,
  options?: SvgRenderOptions,
  devices: DeviceIndex = {},
  settings?: RackDownPluginSettings,
): RackDownRenderResult {
  return renderPreparedRackDown(
    prepareRackDown(source, devices),
    options,
    settings,
  );
}
