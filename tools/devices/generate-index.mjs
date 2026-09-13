import { writeGeneratedDeviceFiles } from './generate.mjs';

const index = await writeGeneratedDeviceFiles();
console.log(
  `Generated ${Object.keys(index).length} RackDown device definitions from the pinned NetBox snapshot.`,
);
