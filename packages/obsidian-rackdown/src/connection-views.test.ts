import { parse, resolve } from '@rackdown/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONNECTION_VIEW_LABELS,
  type RackDownConnectionView,
  RackDownConnectionViews,
} from './connection-views.js';
import { RackDownHostLinks } from './host-links.js';
import { fire, TestElement, TestMenu, TestModal } from './host-test-support.js';
import type RackDownPlugin from './main.js';
import { RackDownNotes } from './notes.js';
import { prepareRackDown } from './render-rackdown.js';
import { DEFAULT_SETTINGS } from './settings.js';

vi.mock('@rackdown/core', async (importOriginal) => {
  const core = await importOriginal<typeof import('@rackdown/core')>();
  return { ...core, parse: vi.fn(core.parse), resolve: vi.fn(core.resolve) };
});

vi.mock('obsidian', async () => {
  const { TestMenu, TestModal, TestRenderChild } = await import(
    './host-test-support.js'
  );
  return {
    MarkdownRenderChild: TestRenderChild,
    Modal: TestModal,
    Menu: TestMenu,
    Keymap: { isModEvent: () => false },
  };
});

const SOURCE = `rack "Lab" 12U
10 switch "[[Devices/Core|Core]]" as core
8 server "Server" as server
core:net -- [WAN](https://example.com/wan) category network
server:net -- [Patch panel](Infrastructure/Patch.md) category network
core:pwr -- [[Power/Feed|Power feed]] category power
core:con -- external "Console port" category console
core:other -- [[Mystery endpoint]]`;

function attributes(source: string): Record<string, string> {
  return Object.fromEntries(
    [...source.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [
      match[1] as string,
      match[2] as string,
    ]),
  );
}

function appendFromOpening(
  parent: TestElement,
  tag: string,
  opening: string,
): TestElement {
  const element = parent.append(new TestElement(tag));
  for (const [key, value] of Object.entries(attributes(opening))) {
    element.setAttribute(key, value);
  }
  return element;
}

/** Build only the semantic nodes exercised by the host interaction layer. */
function hydrateSvg(diagram: TestElement, source: string): void {
  diagram.empty();
  const svgOpening = source.match(/<svg\s+([^>]+)>/)?.[1] ?? '';
  const svg = appendFromOpening(diagram, 'svg', svgOpening);

  for (const match of source.matchAll(
    /<rect\s+([^>]*class="rackdown-rack"[^>]*)\/>/g,
  )) {
    appendFromOpening(svg, 'rect', match[1] as string);
  }

  for (const match of source.matchAll(
    /<(path|line)\s+([^>]*class="[^"]*rackdown-connection[^"]*"[^>]*)>\s*<title>([^<]*)<\/title>/g,
  )) {
    const route = appendFromOpening(
      svg,
      match[1] as string,
      match[2] as string,
    );
    route.createEl('title', { text: match[3] as string });
  }

  for (const match of source.matchAll(
    /<g\s+([^>]*class="[^"]*rackdown-device-group[^"]*"[^>]*)>/g,
  )) {
    const group = appendFromOpening(svg, 'g', match[1] as string);
    group.createEl('title', { text: 'device' });
    group.createEl('text', { cls: 'rackdown-device-label', text: 'device' });
  }

  for (const match of source.matchAll(
    /<g\s+([^>]*class="rackdown-external-group"[^>]*)>/g,
  )) {
    const group = appendFromOpening(svg, 'g', match[1] as string);
    group.createEl('title', { text: group.getAttribute('data-label') ?? '' });
  }
}

interface BlockFixture {
  block: TestElement;
  controls: TestElement;
  diagram: TestElement;
  controller: RackDownConnectionViews;
}

function block(source = SOURCE, namespace = 'note-block-1'): BlockFixture {
  const prepared = prepareRackDown(source);
  const block = new TestElement('div', 'rackdown-block');
  const controls = block.createDiv({ cls: 'rackdown-connection-view' });
  const diagram = block.createDiv({ cls: 'rackdown-diagram' });
  diagram.onInnerHtml = (svg) => hydrateSvg(diagram, svg);
  const controller = new RackDownConnectionViews(
    block.asHtml(),
    controls.asHtml(),
    diagram.asHtml(),
    prepared,
    { namespace },
    DEFAULT_SETTINGS,
  );
  controller.load();
  return { block, controls, diagram, controller };
}

function selectView(fixture: BlockFixture, view: RackDownConnectionView): void {
  const select = fixture.controls?.querySelector('select');
  if (!select) throw new Error('Missing connection view selector');
  select.value = view;
  fire(select, 'change', select);
}

function routes(fixture: BlockFixture): TestElement[] {
  return fixture.diagram.querySelectorAll('.rackdown-connection');
}

function routeSummary(fixture: BlockFixture) {
  return routes(fixture).map((route) => ({
    id: route.getAttribute('data-connection-id'),
    category: route.getAttribute('data-category'),
    path: route.getAttribute('d'),
    stroke: route.getAttribute('stroke'),
  }));
}

describe('per-block connection views', () => {
  beforeEach(() => {
    vi.stubGlobal('Element', TestElement);
    vi.mocked(parse).mockClear();
    vi.mocked(resolve).mockClear();
  });

  it.each([6, 12, 42, 52])(
    'keeps a %iU rack the same CSS size as routing space grows',
    (units) => {
      const source = `rack "Lab" ${units}U\n4 switch "Core" as core\n2 server "Server" as server`;
      const connections = [
        '',
        '\ncore:1 -- server:1',
        '\ncore:1 -- [[An external endpoint beyond the rack]]',
        Array.from(
          { length: 20 },
          (_, index) => `\ncore:${index} -- [[External ${index}]]`,
        ).join(''),
      ];
      const fixtures = connections.map((routes) => block(source + routes));
      const sizes = fixtures.map(({ diagram }) => {
        const svg = diagram.querySelector('svg') as TestElement;
        const box = (svg.getAttribute('viewBox') ?? '').split(' ').map(Number);
        // Before explicit presentation sizing, the host CSS fits the entire viewBox.
        const width =
          Number.parseFloat(svg.style.getPropertyValue('width')) || 100;
        const rack = svg.querySelector('.rackdown-rack') as TestElement;
        return {
          width:
            (Number(rack.getAttribute('width')) * width) / (box[2] as number),
          height:
            (Number(rack.getAttribute('height')) * width) / (box[2] as number),
          svgWidth: width,
        };
      });
      for (const size of sizes) {
        expect(size.width).toBeCloseTo(sizes[0]?.width ?? 0);
        expect(size.height).toBeCloseTo(sizes[0]?.height ?? 0);
      }
      expect(sizes[0]?.width).toBeCloseTo(100);
      expect(sizes[3]?.svgWidth).toBeGreaterThan(sizes[0]?.svgWidth ?? 0);
      for (const { controller } of fixtures) controller.unload();
    },
  );

  it('defaults to All with accessible choices and a semantic count', () => {
    const fixture = block();
    const select = fixture.controls?.querySelector('select');
    expect(select?.value).toBe('all');
    expect(
      select?.querySelectorAll('option').map((option) => option.textContent),
    ).toEqual(Object.values(CONNECTION_VIEW_LABELS));
    expect(
      fixture.controls
        ?.querySelector('.rackdown-connection-view-label')
        ?.querySelector('span')?.textContent,
    ).toBe('Connections:');
    expect(select?.getAttribute('aria-label')).toBe('Connection view');
    const status = fixture.controls?.querySelector(
      '.rackdown-connection-view-status',
    );
    expect(status?.textContent).toBe('Showing 5 of 5 connections');
    expect(status?.getAttribute('aria-live')).toBe('polite');
    expect(status?.getAttribute('aria-atomic')).toBe('true');
    expect(routes(fixture)).toHaveLength(5);
  });

  it.each([
    'rack "Lab" 12U views front rear\n4 switch "Core" as core\nrear 2 server "Server" as server',
    'rack "Lab" 12U views rear\nrear 4 switch "Core" as core\nrear 2 server "Server" as server',
    'rack "Lab" 12U\n4 switch "Core" as core\nrack "Other" 42U\n2 server "Server" as server',
  ])(
    'keeps all projected racks stable across connection changes: %s',
    (source) => {
      const first = block(source);
      const connected = block(
        `${source}\ncore:1 -- server:1 category network\ncore:2 -- [[WAN]] category power`,
      );
      function displayedRacks(fixture: BlockFixture) {
        const svg = fixture.diagram.querySelector('svg') as TestElement;
        const boxWidth = Number(svg.getAttribute('viewBox')?.split(' ')[2]);
        const scale =
          Number.parseFloat(svg.style.getPropertyValue('width')) / boxWidth;
        return svg
          .querySelectorAll('.rackdown-rack')
          .map((rack) => [
            Number(rack.getAttribute('width')) * scale,
            Number(rack.getAttribute('height')) * scale,
          ]);
      }
      expect(displayedRacks(connected)).toEqual(displayedRacks(first));
      selectView(connected, 'network');
      expect(displayedRacks(connected)).toEqual(displayedRacks(first));
      selectView(connected, 'console');
      expect(displayedRacks(connected)).toEqual(displayedRacks(first));
      first.controller.unload();
      connected.controller.unload();
    },
  );

  it.each([
    ['network', 2],
    ['power', 1],
    ['console', 1],
    ['unclassified', 1],
  ] as const)(
    'renders the %s category through core selection',
    (view, count) => {
      const fixture = block();
      selectView(fixture, view);
      expect(routes(fixture)).toHaveLength(count);
      expect(
        routes(fixture).every(
          (route) => route.getAttribute('data-category') === view,
        ),
      ).toBe(true);
      expect(
        fixture.controls?.querySelector('.rackdown-connection-view-status')
          ?.textContent,
      ).toBe(`Showing ${count} of 5 connections`);
      expect(fixture.diagram.innerHTML).toContain(
        `Selected ${count} of 5 documented connections`,
      );
    },
  );

  it('renders a valid empty focused view and switches back to All', () => {
    const fixture = block(
      'rack "Lab" 12U\n10 switch "Core" as core\ncore:1 -- [[WAN]] category network',
    );
    selectView(fixture, 'power');
    expect(routes(fixture)).toEqual([]);
    expect(
      fixture.diagram.querySelectorAll('.rackdown-device-group'),
    ).not.toHaveLength(0);
    expect(fixture.diagram.innerHTML).toContain(
      '0 connections. Selected 0 of 1',
    );
    expect(
      fixture.controls?.querySelector('.rackdown-connection-view-status')
        ?.textContent,
    ).toBe('Showing 0 of 1 connections');
    selectView(fixture, 'all');
    expect(routes(fixture)).toHaveLength(1);
    expect(fixture.diagram.innerHTML).not.toContain('Selected 1 of 1');
  });

  it('keeps an accessible empty controls container for a zero-connection document', () => {
    const fixture = block('rack "Lab" 12U\n10 switch "Core"');
    expect(fixture.controls.getAttribute('role')).toBe('group');
    expect(fixture.controls.getAttribute('aria-label')).toBe(
      'Diagram controls',
    );
    expect(
      fixture.controls.querySelector('.rackdown-connection-view-empty')
        ?.textContent,
    ).toBe('No connections');
    expect(fixture.controls.parentElement).toBe(fixture.block);
    expect(fixture.diagram.contains(fixture.controls)).toBe(false);
    expect(fixture.block.querySelector('select')).toBeUndefined();
    expect(fixture.diagram.innerHTML).toContain('<svg');
  });

  it('keeps the controls, rack size and scroll position when switching categories', () => {
    const fixture = block();
    const select = fixture.controls.querySelector('select');
    const svg = fixture.diagram.querySelector('svg') as TestElement;
    const width = svg.style.getPropertyValue('width');
    const height = svg.style.getPropertyValue('height');
    fixture.diagram.scrollLeft = 20;
    fixture.diagram.asHtml().scrollTop = 50;
    for (const category of ['network', 'power', 'all'] as const) {
      selectView(fixture, category);
      const replacement = fixture.diagram.querySelector('svg') as TestElement;
      expect(replacement.style.getPropertyValue('width')).toBe(width);
      expect(replacement.style.getPropertyValue('height')).toBe(height);
      expect(fixture.diagram.scrollLeft).toBe(20);
      expect(fixture.diagram.asHtml().scrollTop).toBe(50);
      expect(fixture.controls.querySelector('select')).toBe(select);
    }
    const markup = fixture.diagram.innerHTML;
    fixture.controller.unload();
    selectView(fixture, 'console');
    expect(fixture.diagram.innerHTML).toBe(markup);
  });

  it('keeps category state independent between rendered blocks', () => {
    const first = block(SOURCE, 'note-block-1');
    const second = block(SOURCE, 'note-block-2');
    selectView(first, 'power');
    expect(routeSummary(first).map(({ category }) => category)).toEqual([
      'power',
    ]);
    expect(routes(second)).toHaveLength(5);
    expect(second.controls?.querySelector('select')?.value).toBe('all');
  });

  it('prepares once, keeps diagnostics stable and reuses the block namespace', () => {
    const fixture = block(`${SOURCE}\nnot a rackdown statement`);
    const diagnostics = fixture.block.createDiv({
      cls: 'rackdown-diagnostics',
    });
    diagnostics.textContent = 'document diagnostic';
    const rootId = fixture.diagram.querySelector('svg')?.getAttribute('id');
    expect(parse).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledOnce();
    selectView(fixture, 'network');
    selectView(fixture, 'power');
    selectView(fixture, 'all');
    expect(parse).toHaveBeenCalledOnce();
    expect(resolve).toHaveBeenCalledOnce();
    expect(fixture.block.querySelectorAll('.rackdown-diagnostics')).toEqual([
      diagnostics,
    ]);
    expect(fixture.diagram.querySelector('svg')?.getAttribute('id')).toBe(
      rootId,
    );
  });

  it('redecorates surviving device and external links without stale externals', () => {
    const fixture = block();
    const openLinkText = vi.fn();
    const hostLinks = new RackDownHostLinks(
      fixture.block.asHtml(),
      { app: { workspace: { openLinkText } } } as unknown as RackDownPlugin,
      'Racks/Lab.md',
    );
    hostLinks.load();

    selectView(fixture, 'network');
    const device = fixture.diagram.querySelector(
      '.rackdown-device-link',
    ) as TestElement;
    const externalLinks = fixture.diagram.querySelectorAll(
      '.rackdown-external-link',
    );
    const wan = externalLinks.find(
      (link) =>
        link.getAttribute('data-rackdown-target') === 'https://example.com/wan',
    ) as TestElement;
    const patchPanel = externalLinks.find(
      (link) =>
        link.getAttribute('data-rackdown-target') === 'Infrastructure/Patch.md',
    );
    expect(device.getAttribute('data-rackdown-target')).toBe('Devices/Core');
    expect(wan.getAttribute('data-rackdown-target')).toBe(
      'https://example.com/wan',
    );
    expect(wan.getAttribute('data-rackdown-action')).toBe('external-url');
    expect(patchPanel).toBeDefined();
    fire(fixture.block, 'keydown', device, { key: 'Enter' });
    expect(openLinkText).toHaveBeenCalledWith(
      'Devices/Core',
      'Racks/Lab.md',
      false,
    );
    fire(fixture.block, 'keydown', patchPanel as TestElement, { key: 'Enter' });
    expect(openLinkText).toHaveBeenLastCalledWith(
      'Infrastructure/Patch.md',
      'Racks/Lab.md',
      false,
    );

    selectView(fixture, 'power');
    expect(
      fixture.diagram
        .querySelector('.rackdown-external-link[data-rackdown-target]')
        ?.getAttribute('data-rackdown-target'),
    ).toBe('Power/Feed');
    expect(fixture.diagram.innerHTML).not.toContain(
      'data-target="https://example.com/wan"',
    );
    expect(fixture.diagram.innerHTML).not.toContain(
      'data-target="Infrastructure/Patch.md"',
    );
    expect(
      fixture.diagram.querySelector('.rackdown-device-link'),
    ).toBeDefined();
  });

  it('cleans up old interactions and resets manual hiding on category change', () => {
    const fixture = block();
    const oldRoutes = routes(fixture);
    const oldHits = fixture.diagram.querySelectorAll(
      '.rackdown-connection-hit',
    );
    fire(fixture.diagram, 'contextmenu', oldRoutes[0] as TestElement);
    TestMenu.latest.action?.();
    expect(
      fixture.block.querySelector('.rackdown-hidden-routes'),
    ).toBeDefined();

    selectView(fixture, 'network');
    expect(
      fixture.block.querySelector('.rackdown-hidden-routes'),
    ).toBeUndefined();
    expect(oldHits.every((hit) => !fixture.diagram.contains(hit))).toBe(true);
    expect(
      oldRoutes.every((route) => route.getAttribute('tabindex') === null),
    ).toBe(true);
    expect(
      fixture.diagram.querySelectorAll('.rackdown-connection-hit'),
    ).toHaveLength(routes(fixture).length);
    expect(
      routes(fixture).every(
        (route) => !route.classes.has('rackdown-connection-hidden'),
      ),
    ).toBe(true);
    expect(
      fire(fixture.diagram, 'contextmenu', oldRoutes[0] as TestElement)
        .defaultPrevented,
    ).toBe(false);
    expect(
      fire(fixture.diagram, 'contextmenu', routes(fixture)[0] as TestElement)
        .defaultPrevented,
    ).toBe(true);
  });

  it('opens full notes without changing manually hidden routes or their interactions', () => {
    const source = `${SOURCE} notes "route note"\nnotes at rear 3.5 "hidden face position"`;
    const fixture = block(source);
    const notes = new RackDownNotes(
      fixture.block.asHtml(),
      {} as RackDownPlugin['app'],
      fixture.controls.asHtml(),
      prepareRackDown(source).layout,
    );
    notes.load();
    const hiddenRoute = routes(fixture)[4] as TestElement;
    fire(fixture.diagram, 'contextmenu', hiddenRoute);
    TestMenu.latest.action?.();
    const hiddenControls = fixture.block.querySelector(
      '.rackdown-hidden-routes',
    );
    const hits = fixture.diagram.querySelectorAll('.rackdown-connection-hit');
    const svg = fixture.diagram.innerHTML;
    const button = fixture.controls.querySelector(
      '.rackdown-notes-button',
    ) as TestElement;
    fire(button, 'click', button);
    const modal = TestModal.instances.at(-1);
    expect(
      modal?.contentEl.querySelectorAll('p').map((p) => p.textContent),
    ).toEqual(['route note', 'hidden face position']);
    expect(hiddenRoute.classes.has('rackdown-connection-hidden')).toBe(true);
    expect(fixture.block.querySelector('.rackdown-hidden-routes')).toBe(
      hiddenControls,
    );
    expect(
      fixture.diagram.querySelectorAll('.rackdown-connection-hit'),
    ).toEqual(hits);
    expect(fixture.diagram.innerHTML).toBe(svg);
    modal?.close();
    expect(hiddenRoute.classes.has('rackdown-connection-hidden')).toBe(true);
    notes.unload();
    fixture.controller.unload();
  });

  it('retains semantic ids, categories, route geometry and automatic colour', () => {
    const fixture = block();
    const all = routeSummary(fixture);
    selectView(fixture, 'network');
    const focused = routeSummary(fixture);
    expect(focused).toEqual(
      all.filter(({ category }) => category === 'network'),
    );
  });
});
