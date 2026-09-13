import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  deriveNumericAlias,
  normalizeDevice,
  normalizeDeviceIndex,
  serializeDeviceIndex,
} from './normalize.mjs';

describe('device normalization', () => {
  it('derives only conservative trailing numeric aliases', () => {
    assert.equal(deriveNumericAlias('port.9'), '9');
    assert.equal(deriveNumericAlias('Port 24'), '24');
    assert.equal(deriveNumericAlias('SFP+ 25'), '25');
    assert.equal(deriveNumericAlias('iDRAC9'), undefined);
    assert.equal(deriveNumericAlias('Ethernet 1 Port 24'), undefined);
    assert.equal(deriveNumericAlias('xe-0/0/24'), undefined);
  });

  it('normalizes the UDM Pro without inventing semantic WAN aliases', () => {
    const device = normalizeDevice({
      manufacturer: 'Ubiquiti',
      model: 'UniFi Dream Machine Pro',
      slug: 'ubiquiti-unifi-dream-machine-pro',
      part_number: 'UDM-PRO',
      u_height: 1,
      is_full_depth: false,
      airflow: 'front-to-rear',
      interfaces: [
        { name: 'port.9', type: '1000base-t', label: 'Port 9 - WAN 1' },
        {
          name: 'port.10',
          type: '10gbase-x-sfpp',
          label: 'Port 10 - SFP+ WAN 2',
        },
      ],
    });

    assert.deepEqual(device, {
      slug: 'ubiquiti-unifi-dream-machine-pro',
      manufacturer: 'Ubiquiti',
      model: 'UniFi Dream Machine Pro',
      partNumber: 'UDM-PRO',
      uHeight: 1,
      fullDepth: false,
      airflow: 'front-to-rear',
      ports: [
        {
          name: 'port.9',
          label: 'Port 9 - WAN 1',
          kind: 'interface',
          type: '1000base-t',
          aliases: ['9'],
        },
        {
          name: 'port.10',
          label: 'Port 10 - SFP+ WAN 2',
          kind: 'interface',
          type: '10gbase-x-sfpp',
          aliases: ['10'],
        },
      ],
    });
  });

  it('normalizes endpoint facts without turning them into validation', () => {
    const device = normalizeDevice({
      slug: 'vendor-switch',
      interfaces: [
        {
          name: 'Port 24',
          type: '10gbase-t',
          poe_mode: 'pse',
          poe_type: 'type3-ieee802.3bt',
        },
        {
          name: 'Management',
          type: '1000base-t',
          mgmt_only: true,
        },
      ],
    });

    assert.deepEqual(device.ports, [
      {
        name: 'Port 24',
        kind: 'interface',
        type: '10gbase-t',
        poeMode: 'pse',
        poeType: 'type3-ieee802.3bt',
        aliases: ['24'],
      },
      {
        name: 'Management',
        kind: 'interface',
        type: '1000base-t',
        managementOnly: true,
      },
    ]);
  });

  it('normalizes switch aliases and suppresses collisions', () => {
    const device = normalizeDevice({
      slug: 'vendor-switch',
      interfaces: [
        { name: 'Port 24', type: '10gbase-t' },
        { name: 'SFP+ 25', type: '10gbase-x-sfpp' },
        { name: 'Management', label: '24', type: '1000base-t' },
      ],
    });

    assert.deepEqual(device.ports, [
      { name: 'Port 24', kind: 'interface', type: '10gbase-t' },
      {
        name: 'SFP+ 25',
        kind: 'interface',
        type: '10gbase-x-sfpp',
        aliases: ['25'],
      },
      {
        name: 'Management',
        label: '24',
        kind: 'interface',
        type: '1000base-t',
      },
    ]);
  });

  it('suppresses aliases proposed by more than one port', () => {
    const device = normalizeDevice({
      slug: 'vendor-duplicate',
      interfaces: [
        { name: 'Port 1', type: '1000base-t' },
        { name: 'SFP 1', type: '1000base-x-sfp' },
        { name: 'Uplink 2', type: '1000base-t' },
      ],
    });

    assert.deepEqual(device.ports, [
      { name: 'Port 1', kind: 'interface', type: '1000base-t' },
      { name: 'SFP 1', kind: 'interface', type: '1000base-x-sfp' },
      {
        name: 'Uplink 2',
        kind: 'interface',
        type: '1000base-t',
        aliases: ['2'],
      },
    ]);
  });

  it('suppresses aliases colliding with a reserved port name', () => {
    const device = normalizeDevice({
      slug: 'vendor-reserved-name',
      interfaces: [
        { name: 'Port 7', type: '1000base-t' },
        { name: '7', type: '1000base-t' },
      ],
    });

    assert.deepEqual(device.ports, [
      { name: 'Port 7', kind: 'interface', type: '1000base-t' },
      { name: '7', kind: 'interface', type: '1000base-t' },
    ]);
  });

  it('keeps the R740 modular instead of inventing fixed NICs', () => {
    const device = normalizeDevice({
      manufacturer: 'Dell',
      model: 'PowerEdge R740',
      slug: 'dell-poweredge-r740',
      u_height: 2,
      is_full_depth: true,
      airflow: 'front-to-rear',
      'console-ports': [{ name: 'Rear Serial', type: 'de-9' }],
      interfaces: [{ name: 'iDRAC9', type: '1000base-t', mgmt_only: true }],
      'module-bays': [{ name: 'NUMA 0 - NDC slot 1' }],
    });

    assert.deepEqual(device, {
      slug: 'dell-poweredge-r740',
      manufacturer: 'Dell',
      model: 'PowerEdge R740',
      uHeight: 2,
      fullDepth: true,
      airflow: 'front-to-rear',
      ports: [
        { name: 'Rear Serial', kind: 'console-port', type: 'de-9' },
        {
          name: 'iDRAC9',
          kind: 'interface',
          type: '1000base-t',
          managementOnly: true,
        },
      ],
    });
  });

  it('sorts devices by canonical slug and serializes deterministically', () => {
    const index = normalizeDeviceIndex([
      { slug: 'vendor-z', model: 'Z' },
      { slug: 'vendor-a', model: 'A' },
    ]);

    assert.deepEqual(Object.keys(index), ['vendor-a', 'vendor-z']);
    assert.equal(
      serializeDeviceIndex(index),
      '{\n  "vendor-a": {\n    "slug": "vendor-a",\n    "model": "A"\n  },\n  "vendor-z": {\n    "slug": "vendor-z",\n    "model": "Z"\n  }\n}\n',
    );
  });

  it('preserves explicit 0U height while omitting genuinely missing height', () => {
    const zeroHeightDevice = normalizeDevice({
      manufacturer: 'Dell',
      model: 'OptiPlex 3070 Micro',
      slug: 'dell-optiplex-3070-micro',
      u_height: 0,
      is_full_depth: false,
    });
    assert.equal(zeroHeightDevice.uHeight, 0);

    const missingHeightDevice = normalizeDevice({
      manufacturer: 'Vendor',
      model: 'Appliance',
      slug: 'vendor-appliance',
    });
    assert.equal(missingHeightDevice.uHeight, undefined);

    const invalidHeightDevice = normalizeDevice({
      slug: 'invalid-device',
      u_height: -1,
    });
    assert.equal(invalidHeightDevice.uHeight, undefined);
  });
});
