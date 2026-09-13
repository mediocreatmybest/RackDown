import { vi } from 'vitest';
import {
  type DeviceIndex,
  parse,
  resolve,
  toSvg,
} from '../../rackdown-core/src/index.js';

vi.mock('@rackdown/core', () => import('../../rackdown-core/src/index.js'));

import { describe, expect, it } from 'vitest';
import {
  type CliEnvironment,
  formatDiagnostic,
  runCli,
  USAGE_TEXT,
} from './main.js';

function createMemoryEnvironment(
  options: {
    files?: Record<string, string>;
    stdin?: string;
    deviceIndex?: DeviceIndex;
    readFileError?: Error;
    writeFileError?: Error;
    stdinError?: Error;
    loadDeviceIndexError?: Error;
  } = {},
) {
  const files: Record<string, string> = { ...options.files };
  let stdout = '';
  let stderr = '';
  let writeFileCalled = false;

  const env: CliEnvironment = {
    async readFile(path: string) {
      if (options.readFileError) throw options.readFileError;
      const content = files[path];
      if (content === undefined) {
        throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      }
      return content;
    },
    async writeFile(path: string, content: string) {
      writeFileCalled = true;
      if (options.writeFileError) throw options.writeFileError;
      files[path] = content;
    },
    async readStdin() {
      if (options.stdinError) throw options.stdinError;
      return options.stdin ?? '';
    },
    writeStdout(content: string) {
      stdout += content;
    },
    writeStderr(content: string) {
      stderr += content;
    },
    async loadDeviceIndex() {
      if (options.loadDeviceIndexError) throw options.loadDeviceIndexError;
      return options.deviceIndex ?? {};
    },
  };

  return {
    env,
    stdout: () => stdout,
    stderr: () => stderr,
    writtenFiles: () => files,
    wasWriteFileCalled: () => writeFileCalled,
  };
}

const VALID_SOURCE = 'rack "Server Rack" 12U\n1 switch "Core"\n';
const WARNING_SOURCE = 'rack "Comms Rack" 12U views front front\n';
const ERROR_SOURCE = 'rack 0U\n';

describe('runCli', () => {
  // 1. top-level help exits 0 and writes usage to stdout
  it('top-level help exits 0 and writes usage to stdout', async () => {
    const memory1 = createMemoryEnvironment();
    const code1 = await runCli(['--help'], memory1.env);
    expect(code1).toBe(0);
    expect(memory1.stdout()).toBe(`${USAGE_TEXT}\n`);
    expect(memory1.stderr()).toBe('');

    const memory2 = createMemoryEnvironment();
    const code2 = await runCli(['-h'], memory2.env);
    expect(code2).toBe(0);
    expect(memory2.stdout()).toBe(`${USAGE_TEXT}\n`);
    expect(memory2.stderr()).toBe('');

    const memory3 = createMemoryEnvironment();
    const code3 = await runCli(['render', '--help'], memory3.env);
    expect(code3).toBe(0);
    expect(memory3.stdout()).toBe(`${USAGE_TEXT}\n`);

    const memory4 = createMemoryEnvironment();
    const code4 = await runCli(['check', '-h'], memory4.env);
    expect(code4).toBe(0);
    expect(memory4.stdout()).toBe(`${USAGE_TEXT}\n`);
  });

  // 2. no command exits 2
  it('no command exits 2', async () => {
    const memory = createMemoryEnvironment();
    const code = await runCli([], memory.env);
    expect(code).toBe(2);
    expect(memory.stderr()).toContain('Error: No command specified.');
    expect(memory.stderr()).toContain(USAGE_TEXT);
    expect(memory.stdout()).toBe('');
  });

  // 3. unknown command exits 2
  it('unknown command exits 2', async () => {
    const memory = createMemoryEnvironment();
    const code = await runCli(['foo'], memory.env);
    expect(code).toBe(2);
    expect(memory.stderr()).toContain('Error: Unknown command "foo".');
    expect(memory.stderr()).toContain(USAGE_TEXT);
    expect(memory.stdout()).toBe('');
  });

  // 4. render requires exactly one source
  it('render requires exactly one source', async () => {
    const memory1 = createMemoryEnvironment();
    const code1 = await runCli(['render'], memory1.env);
    expect(code1).toBe(2);
    expect(memory1.stderr()).toContain(
      'Error: Missing source file argument for render.',
    );

    const memory2 = createMemoryEnvironment({
      files: { 'a.rackdown': VALID_SOURCE, 'b.rackdown': VALID_SOURCE },
    });
    const code2 = await runCli(
      ['render', 'a.rackdown', 'b.rackdown'],
      memory2.env,
    );
    expect(code2).toBe(2);
    expect(memory2.stderr()).toContain(
      'Error: Unexpected extra argument "b.rackdown".',
    );
  });

  // 5. check requires exactly one source
  it('check requires exactly one source', async () => {
    const memory1 = createMemoryEnvironment();
    const code1 = await runCli(['check'], memory1.env);
    expect(code1).toBe(2);
    expect(memory1.stderr()).toContain(
      'Error: Missing source file argument for check.',
    );

    const memory2 = createMemoryEnvironment({
      files: { 'a.rackdown': VALID_SOURCE, 'b.rackdown': VALID_SOURCE },
    });
    const code2 = await runCli(
      ['check', 'a.rackdown', 'b.rackdown'],
      memory2.env,
    );
    expect(code2).toBe(2);
    expect(memory2.stderr()).toContain(
      'Error: Unexpected extra argument "b.rackdown".',
    );
  });

  // 6. unknown option exits 2
  it('unknown option exits 2', async () => {
    const memory1 = createMemoryEnvironment({
      files: { 'test.rackdown': VALID_SOURCE },
    });
    const code1 = await runCli(
      ['render', 'test.rackdown', '--unknown-flag'],
      memory1.env,
    );
    expect(code1).toBe(2);
    expect(memory1.stderr()).toContain("Unknown option '--unknown-flag'");

    const memory2 = createMemoryEnvironment({
      files: { 'test.rackdown': VALID_SOURCE },
    });
    const code2 = await runCli(
      ['check', 'test.rackdown', '--routing', 'direct'],
      memory2.env,
    );
    expect(code2).toBe(2);
    expect(memory2.stderr()).toContain("Unknown option '--routing'");
  });

  // 7. invalid renderer enum exits 2
  it('invalid renderer enum exits 2', async () => {
    const memory = createMemoryEnvironment({
      files: { 'test.rackdown': VALID_SOURCE },
    });

    const code1 = await runCli(
      ['render', 'test.rackdown', '--routing', 'diagonal'],
      memory.env,
    );
    expect(code1).toBe(2);
    expect(memory.stderr()).toContain('Error: Invalid value for --routing');

    const code2 = await runCli(
      ['render', 'test.rackdown', '--externals', 'left'],
      memory.env,
    );
    expect(code2).toBe(2);
    expect(memory.stderr()).toContain('Error: Invalid value for --externals');

    const code3 = await runCli(
      ['render', 'test.rackdown', '--colour', 'color'],
      memory.env,
    );
    expect(code3).toBe(2);
    expect(memory.stderr()).toContain('Error: Invalid value for --colour');

    const code4 = await runCli(
      ['render', 'test.rackdown', '--theme', 'solarized'],
      memory.env,
    );
    expect(code4).toBe(2);
    expect(memory.stderr()).toContain('Error: Invalid value for --theme');

    const code5 = await runCli(
      ['render', 'test.rackdown', '--sizing', 'fluid'],
      memory.env,
    );
    expect(code5).toBe(2);
    expect(memory.stderr()).toContain('Error: Invalid value for --sizing');
  });

  // 8. file source uses readFile
  it('file source uses readFile', async () => {
    const memory = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    const code = await runCli(['render', 'rack.rackdown'], memory.env);
    expect(code).toBe(0);
    expect(memory.stdout()).toContain('<svg');
  });

  // 9. - source uses stdin
  it('- source uses stdin', async () => {
    const memory = createMemoryEnvironment({ stdin: VALID_SOURCE });
    const code = await runCli(['render', '-'], memory.env);
    expect(code).toBe(0);
    expect(memory.stdout()).toContain('<svg');
  });

  // 10. render defaults to stdout
  it('render defaults to stdout', async () => {
    const memory = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    const code = await runCli(['render', 'rack.rackdown'], memory.env);
    expect(code).toBe(0);
    expect(memory.stdout()).toContain('<svg');
    expect(memory.wasWriteFileCalled()).toBe(false);
  });

  // 11. -o - writes stdout
  it('-o - writes stdout', async () => {
    const memory = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    const code = await runCli(
      ['render', 'rack.rackdown', '-o', '-'],
      memory.env,
    );
    expect(code).toBe(0);
    expect(memory.stdout()).toContain('<svg');
    expect(memory.wasWriteFileCalled()).toBe(false);
  });

  // 12. -o file.svg writes the file and leaves stdout empty
  it('-o file.svg writes the file and leaves stdout empty', async () => {
    const memory = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    const code = await runCli(
      ['render', 'rack.rackdown', '-o', 'diagram.svg'],
      memory.env,
    );
    expect(code).toBe(0);
    expect(memory.stdout()).toBe('');
    expect(memory.wasWriteFileCalled()).toBe(true);
    expect(memory.writtenFiles()['diagram.svg']).toContain('<svg');
  });

  // 13. successful render output is exactly toSvg() output
  it('successful render output is exactly toSvg() output', async () => {
    const memory = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    const code = await runCli(['render', 'rack.rackdown'], memory.env);
    expect(code).toBe(0);
    const expectedSvg = toSvg(resolve(parse(VALID_SOURCE), {}));
    expect(memory.stdout()).toBe(expectedSvg);
  });

  // 14. default render preserves core default routing/external/colour/theme/sizing behaviour
  it('default render preserves core default routing/external/colour/theme/sizing behaviour', async () => {
    const memory = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    await runCli(['render', 'rack.rackdown'], memory.env);
    const svg = memory.stdout();

    // Default core values: direct routing, bottom externals, auto colour, pixels sizing, auto theme
    expect(svg).toContain('data-connection-routing="direct"');
    expect(svg).toContain('data-external-placement="bottom"');
    expect(svg).toContain('data-connection-colour-mode="auto"');
    expect(svg).toMatch(/\bwidth="[^"]+"/);
    expect(svg).not.toMatch(/\bwidth="[^"]+mm"/);
    expect(svg).toMatch(/\bheight="[^"]+"/);
    expect(svg).not.toMatch(/\bheight="[^"]+mm"/);
    expect(svg).toContain('<style');
  });

  // 15. each of the five renderer flags maps to the correct core option
  it('each of the five renderer flags maps to the correct core option', async () => {
    const layout = resolve(parse(VALID_SOURCE), {});

    // --routing
    const memory1 = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    await runCli(
      ['render', 'rack.rackdown', '--routing', 'orthogonal'],
      memory1.env,
    );
    expect(memory1.stdout()).toBe(
      toSvg(layout, { connectionRouting: 'orthogonal' }),
    );

    // --externals
    const memory2 = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    await runCli(
      ['render', 'rack.rackdown', '--externals', 'right'],
      memory2.env,
    );
    expect(memory2.stdout()).toBe(
      toSvg(layout, { externalPlacement: 'right' }),
    );

    // --colour
    const memory3 = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    await runCli(
      ['render', 'rack.rackdown', '--colour', 'monochrome'],
      memory3.env,
    );
    expect(memory3.stdout()).toBe(
      toSvg(layout, { connectionColourMode: 'monochrome' }),
    );

    // --theme
    const memory4 = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    await runCli(['render', 'rack.rackdown', '--theme', 'dark'], memory4.env);
    expect(memory4.stdout()).toBe(toSvg(layout, { theme: 'dark' }));

    // --sizing
    const memory5 = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    await runCli(
      ['render', 'rack.rackdown', '--sizing', 'physical'],
      memory5.env,
    );
    expect(memory5.stdout()).toBe(toSvg(layout, { sizing: 'physical' }));
  });

  // 16. responsive sizing removes root intrinsic dimensions
  it('responsive sizing removes root intrinsic dimensions', async () => {
    const memory = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    const code = await runCli(
      ['render', 'rack.rackdown', '--sizing', 'responsive'],
      memory.env,
    );
    expect(code).toBe(0);
    const [root = ''] = memory.stdout().split('\n');
    expect(root).not.toMatch(/\bwidth=/);
    expect(root).not.toMatch(/\bheight=/);
    expect(root).toContain('viewBox="');
  });

  // 17. theme none removes the embedded stylesheet
  it('theme none removes the embedded stylesheet', async () => {
    const memory = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    const code = await runCli(
      ['render', 'rack.rackdown', '--theme', 'none'],
      memory.env,
    );
    expect(code).toBe(0);
    expect(memory.stdout()).not.toContain('<style');
  });

  // 18. warnings go to stderr but render still succeeds
  it('warnings go to stderr but render still succeeds', async () => {
    const memory = createMemoryEnvironment({
      files: { 'warn.rackdown': WARNING_SOURCE },
    });
    const code = await runCli(['render', 'warn.rackdown'], memory.env);
    expect(code).toBe(0);
    expect(memory.stderr()).toContain(
      'warn.rackdown:1:35: warn: Duplicate rack view: front',
    );
    expect(memory.stdout()).toContain('<svg');
  });

  // 19. warning-only check exits 0
  it('warning-only check exits 0', async () => {
    const memory = createMemoryEnvironment({
      files: { 'warn.rackdown': WARNING_SOURCE },
    });
    const code = await runCli(['check', 'warn.rackdown'], memory.env);
    expect(code).toBe(0);
    expect(memory.stderr()).toContain(
      'warn.rackdown:1:35: warn: Duplicate rack view: front',
    );
    expect(memory.stdout()).toBe('');
  });

  // 20. error check exits 1
  it('error check exits 1', async () => {
    const memory = createMemoryEnvironment({
      files: { 'error.rackdown': ERROR_SOURCE },
    });
    const code = await runCli(['check', 'error.rackdown'], memory.env);
    expect(code).toBe(1);
    expect(memory.stderr()).toContain(
      'error.rackdown:1:6: error: Rack height is missing or invalid.',
    );
    expect(memory.stdout()).toBe('');
  });

  // 21. error render exits 1 and emits no SVG
  it('error render exits 1 and emits no SVG', async () => {
    const memory = createMemoryEnvironment({
      files: { 'error.rackdown': ERROR_SOURCE },
    });
    const code = await runCli(['render', 'error.rackdown'], memory.env);
    expect(code).toBe(1);
    expect(memory.stderr()).toContain(
      'error.rackdown:1:6: error: Rack height is missing or invalid.',
    );
    expect(memory.stdout()).toBe('');
  });

  // 22. error render -o file.svg does not call writeFile
  it('error render -o file.svg does not call writeFile', async () => {
    const memory = createMemoryEnvironment({
      files: { 'error.rackdown': ERROR_SOURCE },
    });
    const code = await runCli(
      ['render', 'error.rackdown', '-o', 'out.svg'],
      memory.env,
    );
    expect(code).toBe(1);
    expect(memory.wasWriteFileCalled()).toBe(false);
    expect(memory.writtenFiles()['out.svg']).toBeUndefined();
  });

  // 23. successful check produces no output
  it('successful check produces no output', async () => {
    const memory = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    const code = await runCli(['check', 'rack.rackdown'], memory.env);
    expect(code).toBe(0);
    expect(memory.stdout()).toBe('');
    expect(memory.stderr()).toBe('');
  });

  // 24. hints/line/column formatting is deterministic
  it('hints/line/column formatting is deterministic', () => {
    expect(
      formatDiagnostic(
        { severity: 'warn', line: 4, message: 'Unknown device type: foo' },
        'rack.rackdown',
      ),
    ).toBe('rack.rackdown:4: warn: Unknown device type: foo');

    expect(
      formatDiagnostic(
        {
          severity: 'error',
          line: 1,
          column: 5,
          message: 'Syntax error',
        },
        '<stdin>',
      ),
    ).toBe('<stdin>:1:5: error: Syntax error');

    expect(
      formatDiagnostic(
        {
          severity: 'info',
          line: 10,
          column: 2,
          message: 'Suggested improvement',
          hint: 'Use explicit height',
        },
        'file.rackdown',
      ),
    ).toBe(
      'file.rackdown:10:2: info: Suggested improvement [hint: Use explicit height]',
    );

    expect(
      formatDiagnostic(
        {
          severity: 'warn',
          line: 2,
          message: 'Notice',
          hint: 'Check wiring',
        },
        'file.rackdown',
      ),
    ).toBe('file.rackdown:2: warn: Notice [hint: Check wiring]');
  });

  // 25. unexpected read/write/catalogue failure exits 2
  it('unexpected read/write/catalogue failure exits 2', async () => {
    // Read failure
    const memory1 = createMemoryEnvironment({
      readFileError: new Error('Disk read fault'),
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    const code1 = await runCli(['render', 'rack.rackdown'], memory1.env);
    expect(code1).toBe(2);
    expect(memory1.stderr()).toContain('Disk read fault');

    // Stdin failure
    const memory2 = createMemoryEnvironment({
      stdinError: new Error('Stdin stream broken'),
    });
    const code2 = await runCli(['render', '-'], memory2.env);
    expect(code2).toBe(2);
    expect(memory2.stderr()).toContain('Stdin stream broken');

    // Catalogue failure
    const memory3 = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
      loadDeviceIndexError: new Error('Catalogue corrupt'),
    });
    const code3 = await runCli(['render', 'rack.rackdown'], memory3.env);
    expect(code3).toBe(2);
    expect(memory3.stderr()).toContain('Catalogue corrupt');

    // Write failure
    const memory4 = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
      writeFileError: new Error('Read-only filesystem'),
    });
    const code4 = await runCli(
      ['render', 'rack.rackdown', '-o', 'out.svg'],
      memory4.env,
    );
    expect(code4).toBe(2);
    expect(memory4.stderr()).toContain('Read-only filesystem');
  });

  // 26. device index supplied by the environment is actually passed to resolve
  it('device index supplied by the environment is actually passed to resolve', async () => {
    const customDeviceIndex: DeviceIndex = {
      'custom-switch': {
        slug: 'custom-switch',
        uHeight: 3,
        model: 'Special Switch 3U',
      },
    };
    const customSource = 'rack "R" 10U\n1 custom-switch "Core"\n';
    const memory = createMemoryEnvironment({
      files: { 'custom.rackdown': customSource },
      deviceIndex: customDeviceIndex,
    });
    const code = await runCli(['render', 'custom.rackdown'], memory.env);
    expect(code).toBe(0);

    const layout = resolve(parse(customSource), customDeviceIndex);
    expect(memory.stdout()).toBe(toSvg(layout, {}));
    expect(layout.devices[0]?.uHeight).toBe(3);
  });

  // 27. same source/options/device index produces deterministic CLI output
  it('same source/options/device index produces deterministic CLI output', async () => {
    const memory1 = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });
    const memory2 = createMemoryEnvironment({
      files: { 'rack.rackdown': VALID_SOURCE },
    });

    const code1 = await runCli(
      ['render', 'rack.rackdown', '--theme', 'dark', '--sizing', 'physical'],
      memory1.env,
    );
    const code2 = await runCli(
      ['render', 'rack.rackdown', '--theme', 'dark', '--sizing', 'physical'],
      memory2.env,
    );

    expect(code1).toBe(0);
    expect(code2).toBe(0);
    expect(memory1.stdout()).toBe(memory2.stdout());
    expect(memory1.stderr()).toBe(memory2.stderr());
  });
});
