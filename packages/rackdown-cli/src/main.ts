import { parseArgs } from 'node:util';
import {
  type ConnectionColourMode,
  type DeviceIndex,
  type Diagnostic,
  parse,
  resolve,
  type SvgConnectionRouting,
  type SvgExternalPlacement,
  type SvgRenderOptions,
  type SvgSizing,
  type SvgTheme,
  toSvg,
} from '@rackdown/core';

export interface CliEnvironment {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readStdin(): Promise<string>;
  writeStdout(content: string): void;
  writeStderr(content: string): void;
  loadDeviceIndex(): Promise<DeviceIndex>;
}

export const USAGE_TEXT = `Usage:
  rackdown render <file.rackdown|-> [-o <out.svg|->] [options]
  rackdown check <file.rackdown|->
Render options:
  --routing direct|orthogonal|lanes|perimeter
  --externals bottom|right
  --colour auto|monochrome
  --theme auto|light|dark|none
  --sizing pixels|physical|responsive
  -h, --help`;

const VALID_ROUTING = new Set<SvgConnectionRouting>([
  'direct',
  'orthogonal',
  'lanes',
  'perimeter',
]);
const VALID_EXTERNALS = new Set<SvgExternalPlacement>(['bottom', 'right']);
const VALID_COLOUR = new Set<ConnectionColourMode>(['auto', 'monochrome']);
const VALID_THEME = new Set<SvgTheme>(['auto', 'light', 'dark', 'none']);
const VALID_SIZING = new Set<SvgSizing>(['pixels', 'physical', 'responsive']);

export function formatDiagnostic(
  diagnostic: Diagnostic,
  sourceLabel: string,
): string {
  const location =
    diagnostic.column !== undefined
      ? `${sourceLabel}:${diagnostic.line}:${diagnostic.column}`
      : `${sourceLabel}:${diagnostic.line}`;
  const hintSuffix =
    diagnostic.hint !== undefined ? ` [hint: ${diagnostic.hint}]` : '';
  return `${location}: ${diagnostic.severity}: ${diagnostic.message}${hintSuffix}`;
}

const RENDER_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  output: { type: 'string', short: 'o' },
  routing: { type: 'string' },
  externals: { type: 'string' },
  colour: { type: 'string' },
  theme: { type: 'string' },
  sizing: { type: 'string' },
} as const;

const CHECK_OPTIONS = {
  help: { type: 'boolean', short: 'h' },
} as const;

export async function runCli(
  argv: readonly string[],
  environment: CliEnvironment,
): Promise<number> {
  if (argv.length === 0) {
    environment.writeStderr('Error: No command specified.\n\n');
    environment.writeStderr(`${USAGE_TEXT}\n`);
    return 2;
  }

  const command = argv[0];

  if (command === '--help' || command === '-h') {
    environment.writeStdout(`${USAGE_TEXT}\n`);
    return 0;
  }

  if (command !== 'render' && command !== 'check') {
    environment.writeStderr(`Error: Unknown command "${command}".\n\n`);
    environment.writeStderr(`${USAGE_TEXT}\n`);
    return 2;
  }

  if (command === 'render') {
    let parsed: ReturnType<
      typeof parseArgs<{
        options: typeof RENDER_OPTIONS;
        allowPositionals: true;
      }>
    >;
    try {
      parsed = parseArgs({
        args: argv.slice(1),
        options: RENDER_OPTIONS,
        allowPositionals: true,
      });
    } catch (error) {
      environment.writeStderr(`Error: ${(error as Error).message}\n`);
      return 2;
    }

    if (parsed.values.help) {
      environment.writeStdout(`${USAGE_TEXT}\n`);
      return 0;
    }

    if (parsed.positionals.length === 0) {
      environment.writeStderr(
        'Error: Missing source file argument for render.\n',
      );
      return 2;
    }

    if (parsed.positionals.length > 1) {
      environment.writeStderr(
        `Error: Unexpected extra argument "${parsed.positionals[1]}".\n`,
      );
      return 2;
    }

    const renderOptions: SvgRenderOptions = {};

    if (parsed.values.routing !== undefined) {
      if (!VALID_ROUTING.has(parsed.values.routing as SvgConnectionRouting)) {
        environment.writeStderr(
          `Error: Invalid value for --routing: "${parsed.values.routing}". Expected direct|orthogonal|lanes|perimeter.\n`,
        );
        return 2;
      }
      renderOptions.connectionRouting = parsed.values
        .routing as SvgConnectionRouting;
    }

    if (parsed.values.externals !== undefined) {
      if (
        !VALID_EXTERNALS.has(parsed.values.externals as SvgExternalPlacement)
      ) {
        environment.writeStderr(
          `Error: Invalid value for --externals: "${parsed.values.externals}". Expected bottom|right.\n`,
        );
        return 2;
      }
      renderOptions.externalPlacement = parsed.values
        .externals as SvgExternalPlacement;
    }

    if (parsed.values.colour !== undefined) {
      if (!VALID_COLOUR.has(parsed.values.colour as ConnectionColourMode)) {
        environment.writeStderr(
          `Error: Invalid value for --colour: "${parsed.values.colour}". Expected auto|monochrome.\n`,
        );
        return 2;
      }
      renderOptions.connectionColourMode = parsed.values
        .colour as ConnectionColourMode;
    }

    if (parsed.values.theme !== undefined) {
      if (!VALID_THEME.has(parsed.values.theme as SvgTheme)) {
        environment.writeStderr(
          `Error: Invalid value for --theme: "${parsed.values.theme}". Expected auto|light|dark|none.\n`,
        );
        return 2;
      }
      renderOptions.theme = parsed.values.theme as SvgTheme;
    }

    if (parsed.values.sizing !== undefined) {
      if (!VALID_SIZING.has(parsed.values.sizing as SvgSizing)) {
        environment.writeStderr(
          `Error: Invalid value for --sizing: "${parsed.values.sizing}". Expected pixels|physical|responsive.\n`,
        );
        return 2;
      }
      renderOptions.sizing = parsed.values.sizing as SvgSizing;
    }

    const sourceArg = parsed.positionals[0];
    if (!sourceArg) {
      environment.writeStderr(
        'Error: Missing source file argument for render.\n',
      );
      return 2;
    }

    let source: string;
    let sourceLabel: string;

    if (sourceArg === '-') {
      sourceLabel = '<stdin>';
      try {
        source = await environment.readStdin();
      } catch (error) {
        environment.writeStderr(
          `Error: Failed to read from stdin: ${(error as Error).message}\n`,
        );
        return 2;
      }
    } else {
      sourceLabel = sourceArg;
      try {
        source = await environment.readFile(sourceArg);
      } catch (error) {
        environment.writeStderr(
          `Error: Failed to read file "${sourceArg}": ${(error as Error).message}\n`,
        );
        return 2;
      }
    }

    let deviceIndex: DeviceIndex;
    try {
      deviceIndex = await environment.loadDeviceIndex();
    } catch (error) {
      environment.writeStderr(
        `Error: Failed to load device catalogue: ${(error as Error).message}\n`,
      );
      return 2;
    }

    const document = parse(source);
    const layout = resolve(document, deviceIndex);

    for (const diagnostic of layout.diagnostics) {
      environment.writeStderr(`${formatDiagnostic(diagnostic, sourceLabel)}\n`);
    }

    const hasErrors = layout.diagnostics.some((d) => d.severity === 'error');
    if (hasErrors) {
      return 1;
    }

    let svg: string;
    try {
      svg = toSvg(layout, renderOptions);
    } catch (error) {
      environment.writeStderr(
        `Error: Failed to render SVG: ${(error as Error).message}\n`,
      );
      return 2;
    }

    const outputPath = parsed.values.output;
    if (outputPath === undefined || outputPath === '-') {
      environment.writeStdout(svg);
    } else {
      try {
        await environment.writeFile(outputPath, svg);
      } catch (error) {
        environment.writeStderr(
          `Error: Failed to write output file "${outputPath}": ${(error as Error).message}\n`,
        );
        return 2;
      }
    }

    return 0;
  }

  // command === 'check'
  let parsed: ReturnType<
    typeof parseArgs<{
      options: typeof CHECK_OPTIONS;
      allowPositionals: true;
    }>
  >;
  try {
    parsed = parseArgs({
      args: argv.slice(1),
      options: CHECK_OPTIONS,
      allowPositionals: true,
    });
  } catch (error) {
    environment.writeStderr(`Error: ${(error as Error).message}\n`);
    return 2;
  }

  if (parsed.values.help) {
    environment.writeStdout(`${USAGE_TEXT}\n`);
    return 0;
  }

  if (parsed.positionals.length === 0) {
    environment.writeStderr('Error: Missing source file argument for check.\n');
    return 2;
  }

  if (parsed.positionals.length > 1) {
    environment.writeStderr(
      `Error: Unexpected extra argument "${parsed.positionals[1]}".\n`,
    );
    return 2;
  }

  const sourceArg = parsed.positionals[0];
  if (!sourceArg) {
    environment.writeStderr('Error: Missing source file argument for check.\n');
    return 2;
  }

  let source: string;
  let sourceLabel: string;

  if (sourceArg === '-') {
    sourceLabel = '<stdin>';
    try {
      source = await environment.readStdin();
    } catch (error) {
      environment.writeStderr(
        `Error: Failed to read from stdin: ${(error as Error).message}\n`,
      );
      return 2;
    }
  } else {
    sourceLabel = sourceArg;
    try {
      source = await environment.readFile(sourceArg);
    } catch (error) {
      environment.writeStderr(
        `Error: Failed to read file "${sourceArg}": ${(error as Error).message}\n`,
      );
      return 2;
    }
  }

  let deviceIndex: DeviceIndex;
  try {
    deviceIndex = await environment.loadDeviceIndex();
  } catch (error) {
    environment.writeStderr(
      `Error: Failed to load device catalogue: ${(error as Error).message}\n`,
    );
    return 2;
  }

  const document = parse(source);
  const layout = resolve(document, deviceIndex);

  for (const diagnostic of layout.diagnostics) {
    environment.writeStderr(`${formatDiagnostic(diagnostic, sourceLabel)}\n`);
  }

  const hasErrors = layout.diagnostics.some((d) => d.severity === 'error');
  return hasErrors ? 1 : 0;
}
