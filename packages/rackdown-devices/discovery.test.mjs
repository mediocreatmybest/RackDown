import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createDeviceCatalogue,
  deviceIndex,
  proofDeviceCatalogue,
} from './index.mjs';

const UDM = 'ubiquiti-unifi-dream-machine-pro';
const SWITCH = 'ubiquiti-unifi-switch-pro-hd-24-poe';
const R740 = 'dell-poweredge-r740';

test('proof catalogue exposes the generated three-device index', () => {
  assert.deepEqual(
    proofDeviceCatalogue.searchDevices('').map((device) => device.slug),
    [R740, UDM, SWITCH],
  );
  assert.equal(proofDeviceCatalogue.getDevice(UDM), deviceIndex[UDM]);
  assert.equal(proofDeviceCatalogue.getDevice('missing-device'), undefined);
});

test('device search is case-insensitive and matches canonical discovery fields', () => {
  assert.deepEqual(
    proofDeviceCatalogue.searchDevices('r740').map((device) => device.slug),
    [R740],
  );
  assert.deepEqual(
    proofDeviceCatalogue
      .searchDevices('DREAM MACHINE')
      .map((device) => device.slug),
    [UDM],
  );
  assert.deepEqual(
    proofDeviceCatalogue.searchDevices('udm-pro').map((device) => device.slug),
    [UDM],
  );
  assert.deepEqual(
    proofDeviceCatalogue.searchDevices('ubiquiti').map((device) => device.slug),
    [UDM, SWITCH],
  );
});

test('device search supports multi-token matching across fields', () => {
  assert.deepEqual(
    proofDeviceCatalogue
      .searchDevices('ubiquiti dream')
      .map((device) => device.slug),
    [UDM],
  );
  assert.deepEqual(
    proofDeviceCatalogue
      .searchDevices('dell poweredge')
      .map((device) => device.slug),
    [R740],
  );
});

test('endpoint discovery preserves canonical names, labels, aliases, and source order', () => {
  const endpoints = proofDeviceCatalogue.listEndpoints(UDM);
  const wan1 = endpoints.find((endpoint) => endpoint.name === 'port.9');

  assert.equal(wan1?.label, 'Port 9 - WAN 1');
  assert.deepEqual(wan1?.aliases, ['9']);
  assert.equal(wan1?.kind, 'interface');
  assert.equal(wan1?.type, '1000base-t');

  assert.deepEqual(
    proofDeviceCatalogue.searchEndpoints(UDM, 'wan').map((port) => port.name),
    ['port.9', 'port.10'],
  );
  assert.equal(
    proofDeviceCatalogue.searchEndpoints(UDM, '9')[0]?.name,
    'port.9',
  );
});

test('endpoint search matches type and kind without changing resolution semantics', () => {
  assert.deepEqual(
    proofDeviceCatalogue
      .searchEndpoints(R740, 'management')
      .map((port) => port.name),
    [],
  );
  assert.deepEqual(
    proofDeviceCatalogue
      .searchEndpoints(R740, '1000base-t')
      .map((port) => port.name),
    ['iDRAC9'],
  );
  assert.deepEqual(
    proofDeviceCatalogue
      .searchEndpoints(R740, 'console-port')
      .map((port) => port.name),
    ['Rear Serial'],
  );
});

test('the same catalogue API works unchanged with a smaller supplied dataset', () => {
  const catalogue = createDeviceCatalogue({ [UDM]: deviceIndex[UDM] });

  assert.deepEqual(
    catalogue.searchDevices('').map((device) => device.slug),
    [UDM],
  );
  assert.equal(catalogue.getDevice(UDM)?.slug, UDM);
  assert.equal(catalogue.getDevice(R740), undefined);
  assert.deepEqual(
    catalogue.searchEndpoints(UDM, 'wan').map((port) => port.name),
    ['port.9', 'port.10'],
  );
});

test('an empty catalogue remains a valid no-enrichment discovery surface', () => {
  const catalogue = createDeviceCatalogue();

  assert.deepEqual(catalogue.searchDevices('anything'), []);
  assert.equal(catalogue.getDevice(UDM), undefined);
  assert.deepEqual(catalogue.listEndpoints(UDM), []);
  assert.deepEqual(catalogue.searchEndpoints(UDM, 'wan'), []);
});

test('getDevice does not resolve inherited Object.prototype names', () => {
  const empty = createDeviceCatalogue();

  assert.equal(empty.getDevice('toString'), undefined);
  assert.equal(empty.getDevice('constructor'), undefined);
  assert.equal(empty.getDevice('hasOwnProperty'), undefined);
  assert.equal(empty.getDevice('valueOf'), undefined);

  const populated = createDeviceCatalogue({ [UDM]: deviceIndex[UDM] });

  assert.equal(populated.getDevice('toString'), undefined);
  assert.equal(populated.getDevice('constructor'), undefined);
  assert.equal(populated.getDevice(UDM)?.slug, UDM);
});

test('catalogue methods remain usable when destructured', () => {
  const { getDevice, listEndpoints, searchDevices, searchEndpoints } =
    proofDeviceCatalogue;

  assert.equal(getDevice(UDM)?.slug, UDM);
  assert.ok(listEndpoints(UDM).length > 0);
  assert.equal(searchDevices('r740')[0]?.slug, R740);
  assert.equal(searchEndpoints(UDM, '9')[0]?.name, 'port.9');
});

// A synthetic catalogue where each candidate matches the query `zx9` through
// exactly one ranking tier, so the resulting order is the ranking ladder
// itself: exact slug/partNumber/model/manufacturer, then the same four as
// prefixes, then filter-only substring matches.
const RANKING_INDEX = {
  zx9: { slug: 'zx9', manufacturer: 'Acme', model: 'M1', partNumber: 'P1' },
  'cand-exact-part': {
    slug: 'cand-exact-part',
    manufacturer: 'Acme',
    model: 'M2',
    partNumber: 'ZX9',
  },
  'cand-exact-model': {
    slug: 'cand-exact-model',
    manufacturer: 'Acme',
    model: 'zx9',
    partNumber: 'P3',
  },
  'cand-exact-manufacturer': {
    slug: 'cand-exact-manufacturer',
    manufacturer: 'zx9',
    model: 'M4',
    partNumber: 'P4',
  },
  'zx9-prefix-slug': {
    slug: 'zx9-prefix-slug',
    manufacturer: 'Acme',
    model: 'M5',
    partNumber: 'P5',
  },
  'cand-prefix-part': {
    slug: 'cand-prefix-part',
    manufacturer: 'Acme',
    model: 'M6',
    partNumber: 'zx9-p',
  },
  'cand-prefix-model': {
    slug: 'cand-prefix-model',
    manufacturer: 'Acme',
    model: 'zx9 model',
    partNumber: 'P7',
  },
  'cand-prefix-manufacturer': {
    slug: 'cand-prefix-manufacturer',
    manufacturer: 'zx9 industries',
    model: 'M8',
    partNumber: 'P8',
  },
  'cand-filter-only': {
    slug: 'cand-filter-only',
    manufacturer: 'Acme',
    model: 'mid-zx9-inside',
    partNumber: 'P9',
  },
};

const DEVICE_RANKING_LADDER = [
  'zx9',
  'cand-exact-part',
  'cand-exact-model',
  'cand-exact-manufacturer',
  'zx9-prefix-slug',
  'cand-prefix-part',
  'cand-prefix-model',
  'cand-prefix-manufacturer',
  'cand-filter-only',
];

// One device whose ports are deliberately stored out of ranking order, so the
// expected result proves ranking reorders them: exact name/alias/label, then
// name/alias/label prefixes, then kind- and type-only matches which filter but
// never rank.
const ENDPOINT_HOST = 'endpoint-host';
const ENDPOINT_INDEX = {
  [ENDPOINT_HOST]: {
    slug: ENDPOINT_HOST,
    manufacturer: 'Acme',
    model: 'Host',
    ports: [
      { name: 'p-kind-only', kind: 'ep7-kind' },
      { name: 'p-label-prefix', label: 'ep7 label' },
      { name: 'ep7' },
      { name: 'p-type-only', type: 'zz-ep7' },
      { name: 'p-alias-prefix', aliases: ['ep7-a'] },
      { name: 'p-label-exact', label: 'ep7' },
      { name: 'ep7-prefix' },
      { name: 'p-alias-exact', aliases: ['EP7'] },
    ],
  },
};

const ENDPOINT_SOURCE_ORDER = [
  'p-kind-only',
  'p-label-prefix',
  'ep7',
  'p-type-only',
  'p-alias-prefix',
  'p-label-exact',
  'ep7-prefix',
  'p-alias-exact',
];

test('device ranking prefers exact slug, partNumber, model, then manufacturer', () => {
  const catalogue = createDeviceCatalogue(RANKING_INDEX);

  assert.deepEqual(
    catalogue.searchDevices('zx9').map((device) => device.slug),
    DEVICE_RANKING_LADDER,
  );
});

test('device ranking normalizes case and surrounding whitespace identically', () => {
  const catalogue = createDeviceCatalogue(RANKING_INDEX);

  for (const query of ['zx9', 'ZX9', '  ZX9  ', '\tZx9\n']) {
    assert.deepEqual(
      catalogue.searchDevices(query).map((device) => device.slug),
      DEVICE_RANKING_LADDER,
      `query ${JSON.stringify(query)} should rank identically`,
    );
  }
});

test('a device matched only by substring ranks below every prefix match', () => {
  const catalogue = createDeviceCatalogue(RANKING_INDEX);
  const ranked = catalogue.searchDevices('zx9').map((device) => device.slug);

  assert.equal(ranked.at(-1), 'cand-filter-only');
  assert.deepEqual(
    catalogue.searchDevices('mid-zx9').map((device) => device.slug),
    ['cand-filter-only'],
  );
});

test('device ties fall back to slug order, then source order', () => {
  const catalogue = createDeviceCatalogue(RANKING_INDEX);

  // Every candidate here is a filter-only match, so all ranks are equal and
  // the ordering is entirely the slug tie-break.
  assert.deepEqual(
    catalogue.searchDevices('acme').map((device) => device.slug),
    [
      'cand-exact-model',
      'cand-exact-part',
      'cand-filter-only',
      'cand-prefix-model',
      'cand-prefix-part',
      'zx9',
      'zx9-prefix-slug',
    ],
  );
});

test('device multi-token matching stays AND across discovery fields', () => {
  const catalogue = createDeviceCatalogue(RANKING_INDEX);

  assert.deepEqual(
    catalogue.searchDevices('acme m1').map((device) => device.slug),
    ['zx9'],
  );
  assert.deepEqual(
    catalogue.searchDevices('zx9 industries').map((device) => device.slug),
    ['cand-prefix-manufacturer'],
  );
  // Both tokens exist in the catalogue, but never together on one device.
  assert.deepEqual(catalogue.searchDevices('acme industries'), []);
});

test('an empty device query returns every device in canonical slug order', () => {
  const catalogue = createDeviceCatalogue(RANKING_INDEX);

  assert.deepEqual(
    catalogue.searchDevices('').map((device) => device.slug),
    [...Object.keys(RANKING_INDEX)].sort(),
  );
  assert.deepEqual(
    catalogue.searchDevices('   ').map((device) => device.slug),
    [...Object.keys(RANKING_INDEX)].sort(),
  );
});

test('endpoint ranking prefers exact name, then alias, then label', () => {
  const catalogue = createDeviceCatalogue(ENDPOINT_INDEX);

  assert.deepEqual(
    catalogue.searchEndpoints(ENDPOINT_HOST, 'ep7').map((port) => port.name),
    [
      'ep7',
      'p-alias-exact',
      'p-label-exact',
      'ep7-prefix',
      'p-alias-prefix',
      'p-label-prefix',
      'p-kind-only',
      'p-type-only',
    ],
  );
});

test('endpoint ranking normalizes case and surrounding whitespace', () => {
  const catalogue = createDeviceCatalogue(ENDPOINT_INDEX);
  const expected = catalogue
    .searchEndpoints(ENDPOINT_HOST, 'ep7')
    .map((port) => port.name);

  for (const query of ['EP7', '  ep7  ', '\tEP7\n']) {
    assert.deepEqual(
      catalogue.searchEndpoints(ENDPOINT_HOST, query).map((port) => port.name),
      expected,
      `query ${JSON.stringify(query)} should rank identically`,
    );
  }
});

test('endpoint kind and type filter but never rank', () => {
  const catalogue = createDeviceCatalogue(ENDPOINT_INDEX);

  // kind/type reach the filter, so these queries match...
  assert.deepEqual(
    catalogue
      .searchEndpoints(ENDPOINT_HOST, 'ep7-kind')
      .map((port) => port.name),
    ['p-kind-only'],
  );
  assert.deepEqual(
    catalogue.searchEndpoints(ENDPOINT_HOST, 'zz-ep7').map((port) => port.name),
    ['p-type-only'],
  );

  // ...but they never lift a candidate above a name/alias/label match, and the
  // two kind/type-only candidates keep their relative source order.
  const ranked = catalogue
    .searchEndpoints(ENDPOINT_HOST, 'ep7')
    .map((port) => port.name);
  assert.deepEqual(ranked.slice(-2), ['p-kind-only', 'p-type-only']);
});

test('equal endpoint ranks keep source order', () => {
  const catalogue = createDeviceCatalogue(ENDPOINT_INDEX);

  // 'p-' matches every port whose name starts with it, all as name prefixes,
  // so the only discriminator left is the original port order.
  assert.deepEqual(
    catalogue.searchEndpoints(ENDPOINT_HOST, 'p-').map((port) => port.name),
    [
      'p-kind-only',
      'p-label-prefix',
      'p-type-only',
      'p-alias-prefix',
      'p-label-exact',
      'p-alias-exact',
    ],
  );
});

test('an empty endpoint query preserves endpoint source order', () => {
  const catalogue = createDeviceCatalogue(ENDPOINT_INDEX);

  assert.deepEqual(
    catalogue.searchEndpoints(ENDPOINT_HOST, '').map((port) => port.name),
    ENDPOINT_SOURCE_ORDER,
  );
  assert.deepEqual(
    catalogue.searchEndpoints(ENDPOINT_HOST, '  ').map((port) => port.name),
    ENDPOINT_SOURCE_ORDER,
  );
  assert.deepEqual(
    catalogue.searchEndpoints(ENDPOINT_HOST).map((port) => port.name),
    ENDPOINT_SOURCE_ORDER,
  );
});

test('discovery tolerates non-string field values without throwing', () => {
  const catalogue = createDeviceCatalogue({
    'weird-values': {
      slug: 'weird-values',
      manufacturer: 42,
      model: null,
      partNumber: undefined,
      ports: [{ name: 'ok', label: 7, aliases: ['ep7', 99] }],
    },
  });

  assert.deepEqual(
    catalogue.searchDevices('').map((device) => device.slug),
    ['weird-values'],
  );
  assert.deepEqual(catalogue.searchDevices('42'), []);
  assert.deepEqual(
    catalogue.searchDevices('weird').map((device) => device.slug),
    ['weird-values'],
  );
  assert.deepEqual(
    catalogue.searchEndpoints('weird-values', 'ep7').map((port) => port.name),
    ['ok'],
  );
  assert.deepEqual(catalogue.searchEndpoints('weird-values', '99'), []);
});
