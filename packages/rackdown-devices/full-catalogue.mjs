import { fullCatalogueSource } from './generated/catalogue-source.mjs';

export { fullCatalogueSource };

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseCataloguePayload(value) {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new TypeError(
      'RackDown catalogue has an unsupported schema version.',
    );
  }
  if (
    !isRecord(value.source) ||
    value.source.repository !== fullCatalogueSource.repository ||
    value.source.ref !== fullCatalogueSource.ref
  ) {
    throw new TypeError('RackDown catalogue does not match the pinned source.');
  }
  if (value.scope !== 'full') {
    throw new TypeError('RackDown catalogue is not a full catalogue payload.');
  }
  if (!isRecord(value.devices) || !isRecord(value.racks)) {
    throw new TypeError(
      'RackDown catalogue is missing device or rack indexes.',
    );
  }
  return value;
}

// Hosts supply the exported asset as text; importing this module performs no I/O.
export async function decodeCataloguePayload(encoded) {
  if (typeof DecompressionStream === 'undefined') {
    throw new TypeError(
      'This runtime does not provide the gzip DecompressionStream API.',
    );
  }
  const binary = atob(encoded.trim());
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const stream = new Blob([bytes])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return parseCataloguePayload(JSON.parse(await new Response(stream).text()));
}

export class CatalogueProvider {
  #catalogue;
  #encoded;

  constructor(encoded) {
    this.#encoded = encoded;
  }

  load() {
    // Cache the promise itself, including rejection. The encoded catalogue is a
    // build-time constant, so retrying the same failed decode cannot recover.
    this.#catalogue ??= decodeCataloguePayload(this.#encoded);
    return this.#catalogue;
  }

  async deviceIndex() {
    return (await this.load()).devices;
  }
}
