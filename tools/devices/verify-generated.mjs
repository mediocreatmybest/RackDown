import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateDeviceFiles } from './generate.mjs';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const rackdownRoot = resolve(toolDirectory, '../..');
const generatedRoot = resolve(
  rackdownRoot,
  'packages/rackdown-devices/generated',
);

const expected = await generateDeviceFiles();
const files = [
  ['device-index.json', expected.json],
  ['index.mjs', expected.module],
  ['catalogue-source.mjs', expected.sourceModule],
];

for (const [name, expectedContent] of files) {
  const path = resolve(generatedRoot, name);
  let actualContent;

  try {
    actualContent = await readFile(path, 'utf8');
  } catch (error) {
    throw new Error(
      `Generated device catalogue is missing ${name}. Run pnpm devices:generate and commit the result.`,
      { cause: error },
    );
  }

  if (actualContent !== expectedContent) {
    throw new Error(
      `Generated device catalogue is stale: ${name}. Run pnpm devices:generate and commit the result.`,
    );
  }
}

console.log('Generated RackDown device catalogue is current.');
