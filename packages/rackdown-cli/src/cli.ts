#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import type { DeviceIndex } from '@rackdown/core';
import { CatalogueProvider } from '@rackdown/devices/full-catalogue';
import { type CliEnvironment, runCli } from './main.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function loadDeviceIndex(): Promise<DeviceIndex> {
  const assetUrl = new URL(
    import.meta.resolve('@rackdown/devices/full-catalogue.b64'),
  );
  const encoded = await readFile(assetUrl, 'utf8');
  const provider = new CatalogueProvider(encoded);
  return await provider.deviceIndex();
}

const environment: CliEnvironment = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, content) => writeFile(path, content, 'utf8'),
  readStdin,
  writeStdout: (content) => process.stdout.write(content),
  writeStderr: (content) => process.stderr.write(content),
  loadDeviceIndex,
};

try {
  const exitCode = await runCli(process.argv.slice(2), environment);
  process.exitCode = exitCode;
} catch (error) {
  process.stderr.write(
    `Error: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 2;
}
