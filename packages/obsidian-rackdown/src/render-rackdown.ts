import {
  type DeviceIndex,
  type Diagnostic,
  parse,
  resolve,
  type SvgRenderOptions,
  toSvg,
} from '@rackdown/core';

export interface RackDownRenderedDevice {
  id: string;
  label: string;
}

export interface RackDownRenderResult {
  svg: string;
  diagnostics: readonly Diagnostic[];
  devices: readonly RackDownRenderedDevice[];
}

export function renderRackDown(
  source: string,
  options?: SvgRenderOptions,
  devices: DeviceIndex = {},
): RackDownRenderResult {
  const layout = resolve(parse(source), devices);

  return {
    svg: toSvg(layout, { connectionRouting: 'perimeter', ...options }),
    diagnostics: layout.diagnostics,
    devices: layout.devices.map(({ id, label }) => ({ id, label })),
  };
}
