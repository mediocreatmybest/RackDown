import { deviceIndex } from './generated/index.mjs';

const PREFIX_RANK_OFFSET = 10;
const UNMATCHED_RANK = 100;

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function queryParts(query) {
  const normalized = normalizeText(query);
  return {
    normalized,
    tokens: normalized.length === 0 ? [] : normalized.split(/\s+/u),
  };
}

function compareText(left, right) {
  const normalizedLeft = normalizeText(left);
  const normalizedRight = normalizeText(right);
  if (normalizedLeft < normalizedRight) {
    return -1;
  }
  if (normalizedLeft > normalizedRight) {
    return 1;
  }

  const rawLeft = String(left);
  const rawRight = String(right);
  if (rawLeft < rawRight) {
    return -1;
  }
  return rawLeft > rawRight ? 1 : 0;
}

function optionalFields(...values) {
  return values.flatMap((value) => {
    if (Array.isArray(value)) {
      return value.map(normalizeText).filter(Boolean);
    }
    const normalized = normalizeText(value);
    return normalized.length === 0 ? [] : [normalized];
  });
}

function matchesAllTokens(fields, tokens) {
  return tokens.every((token) => fields.some((field) => field.includes(token)));
}

/**
 * Ranks a candidate against an already-normalized query.
 *
 * `tiers` lists the ranking fields in priority order; each tier holds the
 * normalized values occupying that priority slot, so a single slot can carry
 * several values (endpoint aliases share one tier). Every exact-match tier is
 * considered before any prefix tier.
 */
function rank(normalizedQuery, tiers) {
  if (normalizedQuery.length === 0) {
    return UNMATCHED_RANK;
  }

  const exact = tiers.findIndex((values) => values.includes(normalizedQuery));
  if (exact !== -1) {
    return exact;
  }

  const prefix = tiers.findIndex((values) =>
    values.some((value) => value.startsWith(normalizedQuery)),
  );
  return prefix === -1 ? UNMATCHED_RANK : PREFIX_RANK_OFFSET + prefix;
}

function isDeviceDefinition(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.slug === 'string'
  );
}

export function createDeviceCatalogue(index = {}) {
  const devices = Object.values(index)
    .filter(isDeviceDefinition)
    .sort((left, right) => compareText(left.slug, right.slug));

  function getDevice(slug) {
    return typeof slug === 'string' && Object.hasOwn(index, slug)
      ? index[slug]
      : undefined;
  }

  function searchDevices(query = '') {
    const { normalized, tokens } = queryParts(query);
    return devices
      .filter((device) =>
        matchesAllTokens(
          optionalFields(
            device.slug,
            device.manufacturer,
            device.model,
            device.partNumber,
          ),
          tokens,
        ),
      )
      .map((device, sourceOrder) => ({
        device,
        rank: rank(normalized, [
          optionalFields(device.slug),
          optionalFields(device.partNumber),
          optionalFields(device.model),
          optionalFields(device.manufacturer),
        ]),
        sourceOrder,
      }))
      .sort(
        (left, right) =>
          left.rank - right.rank ||
          compareText(left.device.slug, right.device.slug) ||
          left.sourceOrder - right.sourceOrder,
      )
      .map(({ device }) => device);
  }

  function listEndpoints(slug) {
    const device = getDevice(slug);
    return Array.isArray(device?.ports) ? [...device.ports] : [];
  }

  function searchEndpoints(slug, query = '') {
    const endpoints = listEndpoints(slug);
    const { normalized, tokens } = queryParts(query);
    return endpoints
      .map((endpoint, sourceOrder) => ({ endpoint, sourceOrder }))
      .filter(({ endpoint }) =>
        matchesAllTokens(
          optionalFields(
            endpoint.name,
            endpoint.label,
            endpoint.aliases,
            endpoint.kind,
            endpoint.type,
          ),
          tokens,
        ),
      )
      .map(({ endpoint, sourceOrder }) => ({
        endpoint,
        sourceOrder,
        rank: rank(normalized, [
          optionalFields(endpoint.name),
          optionalFields(endpoint.aliases),
          optionalFields(endpoint.label),
        ]),
      }))
      .sort(
        (left, right) =>
          left.rank - right.rank || left.sourceOrder - right.sourceOrder,
      )
      .map(({ endpoint }) => endpoint);
  }

  return Object.freeze({
    getDevice,
    searchDevices,
    listEndpoints,
    searchEndpoints,
  });
}

export const proofDeviceCatalogue = createDeviceCatalogue(deviceIndex);
export { deviceIndex };
export default deviceIndex;
