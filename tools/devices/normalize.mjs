const ENDPOINT_KINDS = new Map([
  ['interfaces', 'interface'],
  ['console-ports', 'console-port'],
  ['console-server-ports', 'console-server-port'],
  ['power-ports', 'power-port'],
  ['power-outlets', 'power-outlet'],
  ['front-ports', 'front-port'],
  ['rear-ports', 'rear-port'],
]);

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function requiredString(value, field) {
  const parsed = optionalString(value);
  if (parsed === undefined) {
    throw new TypeError(
      `NetBox device is missing required string field: ${field}`,
    );
  }
  return parsed;
}

export function deriveNumericAlias(name) {
  if (typeof name !== 'string') {
    return undefined;
  }

  const match = /^(.*)[ ._-](\d+)$/.exec(name);
  if (!match) {
    return undefined;
  }

  const prefix = match[1] ?? '';
  const numeric = match[2];
  // Do not derive an alias from an already-numbered prefix: e.g. `eth0 1`
  // must not collapse to the ambiguous numeric alias `1`.
  if (!numeric || prefix.length === 0 || /\d/.test(prefix)) {
    return undefined;
  }

  return numeric;
}

function collectEndpoints(raw) {
  const ports = [];

  for (const [group, value] of Object.entries(raw)) {
    const kind = ENDPOINT_KINDS.get(group);
    if (!kind || !Array.isArray(value)) {
      continue;
    }

    for (const endpoint of value) {
      if (!isRecord(endpoint)) {
        continue;
      }

      const name = optionalString(endpoint.name);
      if (!name) {
        continue;
      }

      const label = optionalString(endpoint.label);
      const type = optionalString(endpoint.type);
      const managementOnly =
        typeof endpoint.mgmt_only === 'boolean'
          ? endpoint.mgmt_only
          : undefined;
      const poeMode = optionalString(endpoint.poe_mode);
      const poeType = optionalString(endpoint.poe_type);

      ports.push({
        name,
        ...(label === undefined ? {} : { label }),
        kind,
        ...(type === undefined ? {} : { type }),
        ...(managementOnly === undefined ? {} : { managementOnly }),
        ...(poeMode === undefined ? {} : { poeMode }),
        ...(poeType === undefined ? {} : { poeType }),
      });
    }
  }

  return ports;
}

function addReserved(reserved, value) {
  if (!value) {
    return;
  }

  reserved.add(value.toLowerCase());
}

function addAliases(ports) {
  const reserved = new Set();
  const proposals = [];
  const proposalCounts = new Map();

  for (let index = 0; index < ports.length; index += 1) {
    const port = ports[index];
    if (!port) {
      continue;
    }
    addReserved(reserved, port.name);
    addReserved(reserved, port.label);

    const alias = deriveNumericAlias(port.name);
    proposals[index] = alias;
    if (!alias) {
      continue;
    }

    const key = alias.toLowerCase();
    proposalCounts.set(key, (proposalCounts.get(key) ?? 0) + 1);
  }

  return ports.map((port, index) => {
    const alias = proposals[index];
    if (!alias) {
      return port;
    }

    const key = alias.toLowerCase();
    if (proposalCounts.get(key) !== 1) {
      return port;
    }
    if (reserved.has(key)) {
      return port;
    }

    return { ...port, aliases: [alias] };
  });
}

export function normalizeDevice(raw) {
  if (!isRecord(raw)) {
    throw new TypeError('NetBox device must be an object.');
  }

  const slug = requiredString(raw.slug, 'slug');
  const manufacturer = optionalString(raw.manufacturer);
  const model = optionalString(raw.model);
  const partNumber = optionalString(raw.part_number);
  const uHeight =
    typeof raw.u_height === 'number' &&
    Number.isFinite(raw.u_height) &&
    raw.u_height >= 0
      ? raw.u_height
      : undefined;
  const fullDepth =
    typeof raw.is_full_depth === 'boolean' ? raw.is_full_depth : undefined;
  const airflow = optionalString(raw.airflow);
  const ports = addAliases(collectEndpoints(raw));

  return {
    slug,
    ...(manufacturer === undefined ? {} : { manufacturer }),
    ...(model === undefined ? {} : { model }),
    ...(partNumber === undefined ? {} : { partNumber }),
    ...(uHeight === undefined ? {} : { uHeight }),
    ...(fullDepth === undefined ? {} : { fullDepth }),
    ...(airflow === undefined ? {} : { airflow }),
    ...(ports.length === 0 ? {} : { ports }),
  };
}

export function normalizeDeviceIndex(rawDevices) {
  if (!Array.isArray(rawDevices)) {
    throw new TypeError('NetBox device collection must be an array.');
  }

  const devices = rawDevices.map(normalizeDevice).sort((left, right) => {
    if (left.slug < right.slug) {
      return -1;
    }
    return left.slug > right.slug ? 1 : 0;
  });

  const index = {};
  for (const device of devices) {
    if (Object.hasOwn(index, device.slug)) {
      throw new TypeError(`Duplicate NetBox device slug: ${device.slug}`);
    }
    index[device.slug] = device;
  }
  return index;
}

export function serializeDeviceIndex(index) {
  return `${JSON.stringify(index, null, 2)}\n`;
}
