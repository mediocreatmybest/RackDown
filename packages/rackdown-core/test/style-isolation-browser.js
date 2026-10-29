import { parse, resolve, toSvg } from '/core.mjs';

const results = document.querySelector('#results');
const fixtures = document.querySelector('#fixtures');
const messages = [];
let failures = 0;
function check(condition, message) {
  if (!condition) failures += 1;
  messages.push(`${condition ? 'PASS' : 'FAIL'} ${message}`);
  results.textContent = messages.join('\n');
}
const source = (name, units = 4) => `rack "${name}" ${units}U
${units} switch "Core" as core
${units - 1} blank "Spare"
${units - 2} shelf "Tray"
1 server "Node"
core:1 -- [[Uplink]]
core:2 -- [[Other uplink]]`;
const layout = resolve(parse(source('One')));
const otherLayout = resolve(parse(source('Two', 6)));
const DEVICE =
  '.rackdown-device-group[data-device-type="switch"] .rackdown-device';
const DEVICE_LABEL =
  '.rackdown-device-group[data-device-type="switch"] .rackdown-device-label';
function render(resolved, options, properties = {}) {
  const host = document.createElement('div');
  for (const [name, value] of Object.entries(properties)) {
    host.style.setProperty(name, value);
  }
  host.innerHTML = toSvg(resolved, options);
  fixtures.append(host);
  return host.querySelector('svg');
}
function style(root, selector) {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`Missing fixture element ${selector}`);
  return getComputedStyle(element);
}
const fields = [
  ['.rackdown-rack', 'fill'],
  ['.rackdown-frame-rail', 'fill'],
  ['.rackdown-frame-cap', 'fill'],
  ['.rackdown-frame-inner', 'stroke'],
  ['.rackdown-frame-outline', 'stroke'],
  ['.rackdown-frame-bolt', 'fill'],
  ['.rackdown-frame-bolt-inner', 'fill'],
  ['.rackdown-u-line', 'stroke'],
  ['.rackdown-rack-title', 'fill'],
  ['.rackdown-u-label', 'fill'],
  [DEVICE_LABEL, 'fill'],
  ['.rackdown-external-label', 'fill'],
  [DEVICE, 'fill'],
  [DEVICE, 'stroke'],
  ['.rackdown-blank', 'fill'],
  ['.rackdown-blank', 'stroke'],
  ['.rackdown-shelf', 'fill'],
  ['.rackdown-shelf', 'stroke'],
  ['.rackdown-blank-label', 'fill'],
  ['.rackdown-shelf-label', 'fill'],
  ['.rackdown-external-box', 'fill'],
  ['.rackdown-external-box', 'stroke'],
  ['.rackdown-connection', 'stroke'],
];
const rgb = (hex) =>
  `rgb(${[0, 2, 4].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16)).join(', ')})`;
const expected = {
  light:
    'f8fafc cbd5e1 dbe2e9 64748b 475569 f8fafc 64748b cbd5e1 0f172a 0f172a 0f172a 0f172a e2e8f0 334155 cbd5e1 94a3b8 f1f5f9 64748b 64748b 64748b ffffff 64748b 64748b'
      .split(' ')
      .map(rgb),
  dark: '1e293b 475569 334155 cbd5e1 94a3b8 1e293b cbd5e1 64748b e2e8f0 e2e8f0 e2e8f0 e2e8f0 334155 cbd5e1 475569 94a3b8 293548 94a3b8 cbd5e1 cbd5e1 0f172a 94a3b8 94a3b8'
    .split(' ')
    .map(rgb),
};
const snapshot = (root) =>
  fields.map(([selector, property]) => style(root, selector)[property]);
function checkPalette(root, theme, context) {
  const actual = snapshot(root);
  const differences = fields.flatMap(([selector, property], index) =>
    actual[index] === expected[theme][index]
      ? []
      : [
          `${selector} ${property}: ${actual[index]} != ${expected[theme][index]}`,
        ],
  );
  check(
    differences.length === 0,
    `${context}: ${theme} palette ${differences.join('; ')}`,
  );
}
function checkSelectors(root) {
  const selectors = [];
  function visit(rules) {
    for (const rule of rules) {
      if (rule.selectorText) selectors.push(...rule.selectorText.split(', '));
      else if (rule.cssRules) visit(rule.cssRules);
    }
  }
  visit(root.querySelector('style').sheet.cssRules);
  check(
    selectors.length > 20 &&
      selectors.every((selector) =>
        selector.startsWith(`:where(#${root.id}) `),
      ),
    `${root.id}: every browser-parsed selector, including grouped and media rules, uses its root`,
  );
}

try {
  for (const identical of [false, true]) {
    for (const order of [
      ['light', 'dark'],
      ['dark', 'light'],
    ]) {
      fixtures.replaceChildren();
      const context = `${identical ? 'identical' : 'different'} layouts, ${order.join(' then ')}`;
      const unstyled = render(layout, { namespace: 'unstyled', theme: 'none' });
      const before = snapshot(unstyled);
      const roots = order.map((theme, index) =>
        render(identical || index === 0 ? layout : otherLayout, {
          ...(identical ? { namespace: `${theme}-${index}` } : {}),
          theme,
          connectionColourMode: 'monochrome',
        }),
      );
      roots.forEach((root, index) => {
        checkPalette(root, order[index], context);
        checkSelectors(root);
      });
      check(
        JSON.stringify(snapshot(unstyled)) === JSON.stringify(before) &&
          !unstyled.querySelector('style'),
        `${context}: theme none stays unstyled beside other SVGs`,
      );
    }
  }

  fixtures.replaceChildren();
  const mediaTheme = matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
  const automatic = render(layout, {
    namespace: 'automatic',
    theme: 'auto',
    connectionColourMode: 'monochrome',
  });
  render(otherLayout, {
    namespace: 'fixed-neighbour',
    theme: mediaTheme === 'dark' ? 'light' : 'dark',
  });
  checkPalette(automatic, mediaTheme, `auto under ${mediaTheme} browser media`);
  checkSelectors(automatic);

  fixtures.replaceChildren();
  for (const [theme, fill] of [
    ['light', '#123456'],
    ['dark', '#654321'],
  ]) {
    const root = render(
      layout,
      {
        namespace: `host-${theme}`,
        theme,
        connectionColourMode: 'monochrome',
      },
      {
        '--rackdown-device-fill': fill,
        '--rackdown-text': '#234567',
        '--rackdown-muted-text': '#345678',
        '--rackdown-device-stroke': '#456789',
        '--rackdown-stroke-width': '0.75',
        '--rackdown-connection-stroke': '#56789a',
        '--rackdown-connection-width': '7',
        '--rackdown-font': 'monospace',
        '--rackdown-label-size': '15px',
        '--rackdown-title-size': '18px',
        '--rackdown-u-label-size': '11px',
      },
    );
    check(
      style(root, DEVICE).fill === rgb(fill.slice(1)) &&
        style(root, DEVICE).stroke === rgb('456789') &&
        style(root, DEVICE).strokeWidth === '0.75px' &&
        style(root, DEVICE_LABEL).fill === rgb('234567') &&
        style(root, '.rackdown-blank-label').fill === rgb('345678') &&
        style(root, DEVICE_LABEL).fontFamily === 'monospace' &&
        style(root, DEVICE_LABEL).fontSize === '15px' &&
        style(root, '.rackdown-rack-title').fontSize === '18px' &&
        style(root, '.rackdown-u-label').fontSize === '11px' &&
        style(root, '.rackdown-connection').stroke === rgb('56789a') &&
        style(root, '.rackdown-connection').strokeWidth === '7px',
      `${theme}: inherited host custom properties override colour, typography and width fallbacks`,
    );
  }

  fixtures.replaceChildren();
  const explicit = render(
    layout,
    {
      namespace: 'explicit',
      theme: 'dark',
      connectionPalette: ['#112233'],
      connectionStyles: {
        [layout.connections[0].id]: {
          color: '#ff00aa',
          width: 3.5,
          pattern: 'dotted',
          opacity: 0.4,
        },
      },
    },
    {
      '--rackdown-connection-stroke': 'red',
      '--rackdown-connection-width': '7',
    },
  );
  render(otherLayout, {
    namespace: 'monochrome-neighbour',
    theme: 'light',
    connectionColourMode: 'monochrome',
  });
  const connections = explicit.querySelectorAll('.rackdown-connection');
  check(
    getComputedStyle(connections[0]).stroke === rgb('ff00aa') &&
      getComputedStyle(connections[0]).strokeWidth === '3.5px' &&
      getComputedStyle(connections[0]).strokeOpacity === '0.4' &&
      getComputedStyle(connections[0]).strokeDasharray === '1px, 4px' &&
      getComputedStyle(connections[1]).stroke === rgb('112233') &&
      getComputedStyle(connections[1]).strokeWidth === '7px',
    'explicit connection intent and automatic colours survive host properties and a monochrome neighbour',
  );

  // A single host class must still beat a zero-specificity connection rule,
  // and a later host class must tie the renderer's ordinary class specificity.
  const hostStyle = document.createElement('style');
  hostStyle.textContent =
    '.rackdown-device { fill: #abcdef; } .rackdown-connection { stroke-width: 9px; stroke: #fedcba; }';
  fixtures.append(hostStyle);
  check(
    style(explicit, DEVICE).fill === rgb('abcdef') &&
      getComputedStyle(connections[1]).strokeWidth === '9px' &&
      getComputedStyle(connections[1]).stroke === rgb('fedcba'),
    'root scoping adds no specificity over ordinary host classes',
  );

  fixtures.replaceChildren();
  const sanitized = render(layout, {
    namespace: '9 / " <style> 日本語',
    theme: 'light',
  });
  check(
    sanitized.id === 'rackdown-9-style-root',
    'sanitized namespace keeps its existing CSS-safe root id',
  );
  checkSelectors(sanitized);
  check(
    style(sanitized, DEVICE).fill === rgb('e2e8f0'),
    'sanitized root matches its stylesheet',
  );
} catch (error) {
  check(false, error.stack ?? String(error));
}
document.documentElement.dataset.testStatus =
  failures === 0 ? 'passed' : 'failed';
results.textContent += `\n${messages.length - failures} passed; ${failures} failed; browser media: ${matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'}`;
