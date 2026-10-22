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
const count = messages.filter((message) => message.startsWith('FAIL')).length;
results.prepend(
  `${count ? 'FAIL' : 'PASS'}: ${messages.length} checks, ${count} failures\n\n`,
);
window.addEventListener('pagehide', () =>
  controllers.forEach(({ controller, observer }) => {
    controller.onunload();
    observer.disconnect();
  }),
);
