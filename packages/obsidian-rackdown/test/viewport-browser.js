import { RackDownConnectionViews } from '../src/connection-views.ts';
import { RackDownNotes } from '../src/notes.ts';
import { prepareRackDown } from '../src/render-rackdown.ts';
import { DEFAULT_SETTINGS } from '../src/settings.ts';
import { RackDownViewport } from '../src/viewport.ts';

const results = document.querySelector('#results');
const messages = [];
const controllers = [];
const frames = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );
function check(condition, message) {
  messages.push(`${condition ? 'PASS' : 'FAIL'} ${message}`);
  results.textContent = messages.join('\n');
}
function svg(height = 2000, extra = 0) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${500 + extra} ${height}"><rect class="rackdown-rack" x="0" y="0" width="500" height="${height}"/>${extra ? '<path d="M 250 20 H 750" stroke="red"/>' : ''}</svg>`;
}
async function fixture(width, height = 2000, gutter = 'stable') {
  const block = document.createElement('div');
  block.className = 'rackdown-block';
  block.style.width = `${width}px`;
  const diagram = document.createElement('div');
  diagram.className = 'rackdown-diagram';
  diagram.style.scrollbarGutter = gutter;
  block.append(diagram);
  document.querySelector('#fixtures').append(block);
  const measurements = [];
  const observer = new ResizeObserver(([entry]) =>
    measurements.push({
      client: diagram.clientWidth,
      observed: entry.contentRect.width,
    }),
  );
  observer.observe(diagram);
  const controller = new RackDownViewport(diagram);
  controller.onload();
  diagram.innerHTML = svg(height);
  controller.setSvg(diagram.querySelector('svg'));
  const initialWidth = diagram
    .querySelector('svg')
    .getBoundingClientRect().width;
  await frames();
  controllers.push({ controller, observer });
  return { block, diagram, controller, initialWidth, measurements };
}

for (const width of [250, 250.25, 250.75]) {
  for (const height of [100, 2400]) {
    const f = await fixture(width, height);
    const actual = f.diagram.querySelector('svg').getBoundingClientRect().width;
    const measured = f.measurements.at(-1);
    check(
      f.diagram.scrollWidth === f.diagram.clientWidth,
      `${width}px/${height} units: no horizontal overflow; client=${measured.client}, observer=${measured.observed}, initial=${f.initialWidth}, final=${actual}`,
    );
    check(
      f.initialWidth <= measured.observed + 0.02,
      `${width}px: initial size does not round up into the gutter`,
    );
  }
}
const changing = await fixture(250.75, 100, 'auto');
for (const height of [2400, 100, 2400]) {
  changing.diagram.innerHTML = svg(height);
  changing.controller.setSvg(changing.diagram.querySelector('svg'));
  await frames();
  check(
    changing.diagram.scrollWidth === changing.diagram.clientWidth,
    `changing vertical scrollbar at ${height} units fits content width`,
  );
}
const routed = await fixture(250.25);
const resized = await fixture(250.25);
resized.block.style.width = '230.75px';
resized.diagram.style.paddingInline = '2.25px';
resized.diagram.style.border = '1px solid black';
resized.diagram.style.scrollbarGutter = 'stable both-edges';
await frames();
check(
  resized.diagram.scrollWidth === resized.diagram.clientWidth,
  'fractional pane resize with padding, borders and two gutters has no horizontal overflow',
);
check(
  Math.abs(
    resized.diagram.querySelector('svg').getBoundingClientRect().width -
      resized.measurements.at(-1).observed,
  ) < 0.02,
  'resized SVG fills the actual content width',
);
const settledWidth = resized.diagram.querySelector('svg').style.width;
await frames();
check(
  resized.diagram.querySelector('svg').style.width === settledWidth,
  'scrollbar sizing settles without oscillation',
);
resized.block.style.zoom = '1.25';
await frames();
check(
  Math.abs(
    Number.parseFloat(
      getComputedStyle(resized.diagram.querySelector('svg')).width,
    ) - resized.measurements.at(-1).observed,
  ) < 0.02,
  'zoomed viewport uses the fractional content width',
);
routed.diagram.innerHTML = svg(2400, 300);
routed.controller.setSvg(routed.diagram.querySelector('svg'));
await frames();
check(
  routed.diagram.scrollWidth > routed.diagram.clientWidth,
  'routing space retains native horizontal scrolling',
);
routed.diagram.scrollLeft = 40;
routed.diagram.scrollTop = 100;
routed.diagram.innerHTML = svg(2400, 300);
routed.controller.setSvg(routed.diagram.querySelector('svg'));
await frames();
check(
  routed.diagram.scrollLeft === 40 && routed.diagram.scrollTop === 100,
  'replacement preserves scroll position',
);
check(
  getComputedStyle(routed.diagram).overflowX === 'auto',
  'overflow is scrollable, not hidden',
);
function controlsFixture(width, count, withNotes = false) {
  const block = document
    .querySelector('#fixtures')
    .createDiv({ cls: 'rackdown-block' });
  block.style.width = `${width}px`;
  const controls = block.createDiv({ cls: 'rackdown-connection-view' });
  const diagram = block.createDiv({ cls: 'rackdown-diagram' });
  let source =
    'rack "Lab" 52U\n50 switch "Core" as core\n2 server "Server" as server' +
    Array.from(
      { length: count },
      (_, i) =>
        `\ncore:${i} -- [[Endpoint ${i}]] category ${i % 2 ? 'power' : 'network'}`,
    ).join('');
  if (withNotes) source += '\nnotes at rear 1 "browser notes"';
  const prepared = prepareRackDown(source);
  const controller = new RackDownConnectionViews(
    block,
    controls,
    diagram,
    prepared,
    { namespace: `toolbar-${width}-${count}` },
    DEFAULT_SETTINGS,
  );
  controller.load();
  controllers.push({ controller, observer: { disconnect() {} } });
  const notes = new RackDownNotes(block, {}, controls, prepared.layout);
  notes.load();
  controllers.push({ controller: notes, observer: { disconnect() {} } });
  return { block, controls, diagram };
}
let reservedHeight;
for (const width of [120, 240.25, 600]) {
  const fixtures = [0, 1, 5].map((count) => controlsFixture(width, count));
  await frames();
  const offsets = fixtures.map(
    ({ block, diagram }) =>
      diagram.getBoundingClientRect().top - block.getBoundingClientRect().top,
  );
  check(
    offsets.every((offset) => Math.abs(offset - offsets[0]) < 0.02),
    `${width}px: zero/one/many connections reserve equal vertical space`,
  );
  check(
    Boolean(
      fixtures[0].controls.querySelector('.rackdown-connection-view-empty'),
    ) && !fixtures[0].controls.querySelector('select'),
    `${width}px: empty state has no unusable selector`,
  );
  for (const fixture of fixtures) {
    const height = fixture.controls.getBoundingClientRect().height;
    reservedHeight ??= height;
    check(
      Math.abs(height - reservedHeight) < 0.02 &&
        fixture.controls.scrollWidth <= fixture.controls.clientWidth,
      `${width}px: controls neither wrap nor overflow`,
    );
  }
  const { controls, diagram, block } = fixtures[2];
  const select = controls.querySelector('select');
  const initial = diagram
    .querySelector('.rackdown-rack')
    .getBoundingClientRect();
  const diagramOffset = () =>
    diagram.getBoundingClientRect().top - block.getBoundingClientRect().top;
  const toolbarTop = diagramOffset();
  const widthBefore = diagram.querySelector('svg').style.width;
  diagram.scrollLeft = 20;
  diagram.scrollTop = 100;
  const scroll = [diagram.scrollLeft, diagram.scrollTop];
  select.value = 'power';
  select.dispatchEvent(new Event('change'));
  await frames();
  const after = diagram.querySelector('.rackdown-rack').getBoundingClientRect();
  check(
    Math.abs(after.width - initial.width) < 0.02 &&
      Math.abs(after.height - initial.height) < 0.02 &&
      diagram.querySelector('svg').style.width === widthBefore,
    `${width}px: category switching preserves rack scale`,
  );
  check(
    diagram.scrollLeft === scroll[0] &&
      diagram.scrollTop === scroll[1] &&
      diagramOffset() === toolbarTop,
    `${width}px: category switching preserves scrolling and layout (${diagram.scrollLeft},${diagram.scrollTop} expected ${scroll}; offset ${diagramOffset()} expected ${toolbarTop})`,
  );
  check(
    fixtures[1].controls.querySelector('select').value === 'all',
    `${width}px: block selection is independent`,
  );
  check(
    controls.querySelector('.rackdown-connection-view-status').textContent ===
      'Showing 2 of 5 connections',
    `${width}px: focused category count stays accurate`,
  );
  const subdued =
    matchMedia('(hover: hover) and (pointer: fine)').matches &&
    !matchMedia('(any-pointer: coarse)').matches &&
    !block.matches(':hover');
  check(
    Number(getComputedStyle(controls).opacity) === (subdued ? 0.7 : 1),
    `${width}px: idle controls respect the device hover capability`,
  );
  select.focus();
  check(
    getComputedStyle(controls).opacity === '1' &&
      diagramOffset() === toolbarTop,
    `${width}px: keyboard focus reveals controls without movement`,
  );
  select.blur();
}

for (const width of [120, 240.25, 600]) {
  for (const count of [0, 1, 5]) {
    const withoutNotes = controlsFixture(width, count);
    const withNotes = controlsFixture(width, count, true);
    await frames();
    const measure = ({ block, controls, diagram }) => ({
      height: controls.getBoundingClientRect().height,
      offset:
        diagram.getBoundingClientRect().top - block.getBoundingClientRect().top,
    });
    const baseline = measure(withoutNotes);
    const annotated = measure(withNotes);
    const button = withNotes.controls.querySelector('.rackdown-notes-button');
    const primary =
      withNotes.controls.querySelector('label') ??
      withNotes.controls.querySelector('.rackdown-connection-view-empty');
    const status = withNotes.controls.querySelector(
      '.rackdown-connection-view-status',
    );
    check(
      annotated.height === baseline.height &&
        annotated.offset === baseline.offset,
      `${width}px/${count} routes: notes reserve exactly the existing two toolbar rows`,
    );
    check(
      getComputedStyle(button).gridRowStart === '1' &&
        getComputedStyle(button).gridColumnStart === '2' &&
        getComputedStyle(primary).gridRowStart === '1' &&
        (!status || getComputedStyle(status).gridRowStart === '2'),
      `${width}px/${count} routes: notes stay beside the selector or No connections`,
    );
    check(
      withNotes.controls.scrollWidth <= withNotes.controls.clientWidth,
      `${width}px/${count} routes: notes toolbar has no horizontal overflow`,
    );
  }
}

const count = messages.filter((message) => message.startsWith('FAIL')).length;
results.prepend(
  `${count ? 'FAIL' : 'PASS'}: ${messages.length} checks, ${count} failures\n\n`,
);
window.addEventListener('pagehide', () =>
  controllers.forEach(({ controller, observer }) => {
    controller.unload();
    observer.disconnect();
  }),
);
