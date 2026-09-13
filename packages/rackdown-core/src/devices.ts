/** Optional metadata about a known attachment point from a device library. */
export interface DevicePortDefinition {
  name: string;
  label?: string;
  aliases?: readonly string[];
  kind?: string;
  type?: string;
  managementOnly?: boolean;
  poeMode?: string;
  poeType?: string;
}

/**
 * RackDown's deliberately small device-enrichment contract.
 *
 * Upstream schemas such as NetBox are compiled into this shape. Unknown
 * devices and ports remain valid RackDown input even when absent here.
 */
export interface DeviceDefinition {
  slug: string;
  manufacturer?: string;
  model?: string;
  partNumber?: string;
  /** Rack unit height. 0 indicates non-rack-mounted or 0U equipment. */
  uHeight?: number;
  fullDepth?: boolean;
  airflow?: string;
  ports?: readonly DevicePortDefinition[];
}

export type DeviceIndex = Readonly<Record<string, DeviceDefinition>>;
