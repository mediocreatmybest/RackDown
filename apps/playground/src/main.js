import { parse, resolve, toSvg } from '@rackdown/core';
import { deviceIndex } from '@rackdown/devices';
import { DEFAULT_SOURCE } from './default-source.js';

const CONNECTION_ROUTING_MODES = ['direct', 'orthogonal', 'lanes', 'perimeter'];
const CONNECTION_ROUTING_LABELS = {
  direct: 'Direct',
  orthogonal: 'Orthogonal',
  lanes: 'Lanes',
  perimeter: 'Perimeter',
};
const CONNECTION_PATTERN_MODES = ['natural', 'solid', 'dashed', 'dotted'];
const CONNECTION_PATTERN_LABELS = {
  natural: 'Natural',
  solid: 'Solid',
  dashed: 'Dashed',
  dotted: 'Dotted',
};

const source = document.querySelector('#source');
const preview = document.querySelector('#preview');
const diagnostics = document.querySelector('#diagnostics-list');
const status = document.querySelector('#status');
const externalPlacement = document.querySelector('#external-placement');
const connectionRouting = document.querySelector('#connection-routing');
const connectionColours = document.querySelector('#connection-colours');
const connectionPattern = document.querySelector('#connection-pattern');
const reset = document.querySelector('#reset-example');

if (
  !(source instanceof HTMLTextAreaElement) ||
  !(preview instanceof HTMLElement) ||
  !(diagnostics instanceof HTMLElement) ||
  !(status instanceof HTMLElement) ||
  !(externalPlacement instanceof HTMLButtonElement) ||
  !(connectionRouting instanceof HTMLButtonElement) ||
  !(connectionColours instanceof HTMLButtonElement) ||
  !(connectionPattern instanceof HTMLButtonElement) ||
  !(reset instanceof HTMLButtonElement)
) {
  throw new Error('RackDown playground markup is incomplete.');
}

let externalPlacementMode = 'bottom';
let connectionRoutingMode = 'direct';
let connectionColourMode = 'auto';
let connectionPatternMode = 'natural';

function plural(count, singular) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

function cycleMode(modes, current) {
  const index = modes.indexOf(current);
  return modes[(index + 1) % modes.length];
}

function updateExternalPlacementButton() {
  const label = externalPlacementMode === 'bottom' ? 'Bottom' : 'Right';
  externalPlacement.textContent = `Externals: ${label}`;
}

function updateConnectionRoutingButton() {
  connectionRouting.textContent = `Routing: ${CONNECTION_ROUTING_LABELS[connectionRoutingMode]}`;
}

function updateConnectionColoursButton() {
  connectionColours.textContent =
    connectionColourMode === 'auto'
      ? 'Cables: Auto colour'
      : 'Cables: Monochrome';
}

function updateConnectionPatternButton() {
  connectionPattern.textContent = `Pattern: ${CONNECTION_PATTERN_LABELS[connectionPatternMode]}`;
}

function renderDiagnostics(items) {
  diagnostics.replaceChildren();

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'diagnostics-empty';
    empty.textContent = 'No diagnostics. The rack is looking tidy.';
    diagnostics.append(empty);
    return;
  }

  const list = document.createElement('ol');
  list.className = 'diagnostics-items';

  for (const item of items) {
    const row = document.createElement('li');
    row.className = `diagnostic diagnostic-${item.severity}`;

    const location = document.createElement('span');
    location.className = 'diagnostic-location';
    location.textContent = item.column
      ? `Line ${item.line}:${item.column}`
      : `Line ${item.line}`;

    const message = document.createElement('span');
    message.className = 'diagnostic-message';
    message.textContent = item.message;

    row.append(location, message);

    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'diagnostic-hint';
      hint.textContent = item.hint;
      row.append(hint);
    }

    list.append(row);
  }

  diagnostics.append(list);
}

function render() {
  try {
    const documentModel = parse(source.value);
    const layout = resolve(documentModel, deviceIndex);
    preview.innerHTML = toSvg(layout, {
      namespace: 'playground',
      externalPlacement: externalPlacementMode,
      connectionRouting: connectionRoutingMode,
      connectionColourMode,
      ...(connectionPatternMode === 'natural'
        ? {}
        : { connectionStyle: { pattern: connectionPatternMode } }),
    });
    renderDiagnostics(layout.diagnostics);

    status.textContent = [
      plural(layout.racks.length, 'rack'),
      plural(layout.devices.length, 'device'),
      plural(layout.connections.length, 'connection'),
      plural(layout.diagnostics.length, 'diagnostic'),
    ].join(' · ');
    status.dataset.state =
      layout.diagnostics.length === 0 ? 'clean' : 'warning';
  } catch (error) {
    preview.replaceChildren();
    const failure = document.createElement('p');
    failure.className = 'preview-error';
    failure.textContent = 'Unexpected renderer error.';
    preview.append(failure);

    renderDiagnostics([
      {
        severity: 'error',
        line: 1,
        message: error instanceof Error ? error.message : String(error),
        hint: 'This is a playground failure rather than a normal RackDown diagnostic.',
      },
    ]);
    status.textContent = 'Renderer error';
    status.dataset.state = 'error';
  }
}

source.value = DEFAULT_SOURCE;
updateExternalPlacementButton();
updateConnectionRoutingButton();
updateConnectionColoursButton();
updateConnectionPatternButton();
source.addEventListener('input', render);
externalPlacement.addEventListener('click', () => {
  externalPlacementMode =
    externalPlacementMode === 'bottom' ? 'right' : 'bottom';
  updateExternalPlacementButton();
  render();
});
connectionRouting.addEventListener('click', () => {
  connectionRoutingMode = cycleMode(
    CONNECTION_ROUTING_MODES,
    connectionRoutingMode,
  );
  updateConnectionRoutingButton();
  render();
});
connectionColours.addEventListener('click', () => {
  connectionColourMode =
    connectionColourMode === 'auto' ? 'monochrome' : 'auto';
  updateConnectionColoursButton();
  render();
});
connectionPattern.addEventListener('click', () => {
  connectionPatternMode = cycleMode(
    CONNECTION_PATTERN_MODES,
    connectionPatternMode,
  );
  updateConnectionPatternButton();
  render();
});
reset.addEventListener('click', () => {
  source.value = DEFAULT_SOURCE;
  externalPlacementMode = 'bottom';
  connectionRoutingMode = 'direct';
  connectionColourMode = 'auto';
  connectionPatternMode = 'natural';
  updateExternalPlacementButton();
  updateConnectionRoutingButton();
  updateConnectionColoursButton();
  updateConnectionPatternButton();
  render();
  source.focus();
});

render();
