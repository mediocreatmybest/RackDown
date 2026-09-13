import assert from 'node:assert/strict';
import test from 'node:test';
import { generateDeviceFiles, generateDeviceIndex } from './generate.mjs';

test('generates the three curated proof devices from pinned YAML', async () => {
  const index = await generateDeviceIndex();

  assert.deepEqual(Object.keys(index), [
    'dell-poweredge-r740',
    'ubiquiti-unifi-dream-machine-pro',
    'ubiquiti-unifi-switch-pro-hd-24-poe',
  ]);

  const dell = index['dell-poweredge-r740'];
  assert.equal(dell?.manufacturer, 'Dell');
  assert.equal(dell?.model, 'PowerEdge R740');
  assert.equal(dell?.uHeight, 2);
  assert.equal(dell?.fullDepth, true);
  assert.equal(dell?.airflow, 'front-to-rear');
  assert.deepEqual(
    dell?.ports?.map((port) => port.name),
    ['Rear Serial', 'iDRAC9'],
  );
  assert.deepEqual(
    dell?.ports?.find((port) => port.name === 'iDRAC9'),
    {
      name: 'iDRAC9',
      kind: 'interface',
      type: '1000base-t',
      managementOnly: true,
    },
  );

  const gateway = index['ubiquiti-unifi-dream-machine-pro'];
  assert.equal(gateway?.partNumber, 'UDM-PRO');
  assert.equal(gateway?.uHeight, 1);
  assert.equal(gateway?.fullDepth, false);
  assert.equal(gateway?.airflow, 'front-to-rear');
  assert.deepEqual(
    gateway?.ports?.find((port) => port.name === 'port.9'),
    {
      name: 'port.9',
      label: 'Port 9 - WAN 1',
      kind: 'interface',
      type: '1000base-t',
      aliases: ['9'],
    },
  );
  assert.deepEqual(
    gateway?.ports?.find((port) => port.name === 'port.10'),
    {
      name: 'port.10',
      label: 'Port 10 - SFP+ WAN 2',
      kind: 'interface',
      type: '10gbase-x-sfpp',
      aliases: ['10'],
    },
  );

  const core = index['ubiquiti-unifi-switch-pro-hd-24-poe'];
  assert.equal(core?.partNumber, 'USW-Pro-HD-24-PoE');
  assert.equal(core?.uHeight, 1);
  assert.equal(core?.fullDepth, false);
  assert.equal(core?.airflow, 'front-to-rear');
  assert.deepEqual(
    core?.ports?.find((port) => port.name === 'Port 24'),
    {
      name: 'Port 24',
      kind: 'interface',
      type: '10gbase-t',
      poeMode: 'pse',
      poeType: 'type3-ieee802.3bt',
      aliases: ['24'],
    },
  );
  assert.deepEqual(
    core?.ports?.find((port) => port.name === 'SFP+ 25'),
    {
      name: 'SFP+ 25',
      kind: 'interface',
      type: '10gbase-x-sfpp',
      aliases: ['25'],
    },
  );
});

test('serializes generated output deterministically', async () => {
  const first = await generateDeviceFiles();
  const second = await generateDeviceFiles();

  assert.equal(first.json, second.json);
  assert.equal(first.module, second.module);
  assert.deepEqual(JSON.parse(first.json), first.index);
  assert.match(first.module, /^export const deviceIndex = \{/);
  assert.match(first.module, /export default deviceIndex;\n$/);
});
