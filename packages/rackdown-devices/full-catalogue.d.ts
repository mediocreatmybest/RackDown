import type { CatalogueDeviceIndex } from './index.js';

export const fullCatalogueSource: Readonly<{
  repository: string;
  ref: string;
  license: string;
}>;

export interface RackDownCataloguePayload {
  schemaVersion: 1;
  source: { repository: string; ref: string };
  scope: 'full';
  devices: CatalogueDeviceIndex;
  racks: Record<string, unknown>;
}

export function parseCataloguePayload(value: unknown): RackDownCataloguePayload;
export function decodeCataloguePayload(
  encoded: string,
): Promise<RackDownCataloguePayload>;
export class CatalogueProvider {
  constructor(encoded: string);
  load(): Promise<RackDownCataloguePayload>;
  deviceIndex(): Promise<CatalogueDeviceIndex>;
}
