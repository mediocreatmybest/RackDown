export interface CatalogueEndpointDefinition {
  name: string;
  label?: string;
  aliases?: readonly string[];
  kind?: string;
  type?: string;
  managementOnly?: boolean;
  poeMode?: string;
  poeType?: string;
}

export interface CatalogueDeviceDefinition {
  slug: string;
  manufacturer?: string;
  model?: string;
  partNumber?: string;
  uHeight?: number;
  fullDepth?: boolean;
  airflow?: string;
  ports?: readonly CatalogueEndpointDefinition[];
}

export type CatalogueDeviceIndex = Readonly<
  Record<string, CatalogueDeviceDefinition>
>;

export interface DeviceCatalogue {
  getDevice(slug: string): CatalogueDeviceDefinition | undefined;
  searchDevices(query?: string): readonly CatalogueDeviceDefinition[];
  listEndpoints(slug: string): readonly CatalogueEndpointDefinition[];
  searchEndpoints(
    slug: string,
    query?: string,
  ): readonly CatalogueEndpointDefinition[];
}

export function createDeviceCatalogue(
  index?: CatalogueDeviceIndex,
): DeviceCatalogue;

export const proofDeviceCatalogue: DeviceCatalogue;
export const deviceIndex: CatalogueDeviceIndex;
export default deviceIndex;
