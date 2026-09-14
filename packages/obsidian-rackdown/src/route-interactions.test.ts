import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RackDownHostLinks } from './host-links.js';
import { fire, TestElement, TestMenu } from './host-test-support.js';
import type RackDownPlugin from './main.js';
import { renderRackDown } from './render-rackdown.js';
import { RackDownRouteInteractions } from './route-interactions.js';
import { normalizeSettings } from './settings.js';

vi.mock('obsidian', async () => {
  const { TestMenu, TestRenderChild } = await import('./host-test-support.js');
  return {
    MarkdownRenderChild: TestRenderChild,
    Menu: TestMenu,
    Keymap: { isModEvent: () => false },
  };
});

function block(width = 2, tag = 'path') {
  const container = new TestElement();
  const diagram = container.append(new TestElement());
  const svg = diagram.append(new TestElement('svg'));
  const routes = ['one', 'two'].map((id) => {
    const route = svg.append(new TestElement(tag, 'rackdown-connection'));
    route.setAttribute('data-connection-id', id);
    route.setAttribute('id', `svg-${id}`);
    route.setAttribute('stroke-width', String(width));
    if (tag === 'path') route.setAttribute('d', 'M10,20 L60,20');
    else
      for (const [key, value] of Object.entries({
        x1: '10',
        y1: '20',
        x2: '60',
        y2: '20',
      }))
        route.setAttribute(key, value);
    route.setAttribute('stroke', '#123456');
    route.setAttribute('stroke-dasharray', '3 2');
    route.createEl('title', { text: `Core to ${id}` });
    return route;
  });
  const controller = new RackDownRouteInteractions(
    container.asHtml(),
    diagram.asHtml(),
  );
  controller.onload();
  return { container, diagram, svg, routes, controller };
}

describe('block route interactions', () => {
  beforeEach(() => vi.stubGlobal('Element', TestElement));

  it.each([1, 2, 3, 4, 1.75, 8])(
    'derives emphasis from resolved width %s',
    (width) => {
      const { routes } = block(width);
      for (const route of routes) {
        expect(
          route.style.getPropertyValue('--rackdown-connection-hover-width'),
        ).toBe(`${width + 1}px`);
        expect(
          Number.parseFloat(
            route.style.getPropertyValue('--rackdown-connection-hover-width'),
          ),
        ).toBeGreaterThan(width);
        expect(route.getAttribute('stroke-width')).toBe(String(width));
      }
    },
  );

  it('uses the renderer-resolved explicit width instead of the global thickness', () => {
    const svg = renderRackDown(
      'rack "Lab" 12U\n10 switch "Core" as core\ncore:1 -- [[Remote]]',
      { connectionStyle: { width: 3.75 } },
      {},
      normalizeSettings({ connectionThickness: 1 }),
    ).svg;
    const width = Number(
      svg.match(/data-connection-id="[^"]+"[^>]*stroke-width="([^"]+)"/)?.[1],
    );
    expect(width).toBe(3.75);
    expect(
      block(width).routes[0]?.style.getPropertyValue(
        '--rackdown-connection-hover-width',
      ),
    ).toBe('4.75px');
  });

  it('wires the derived variable to hover, focus and the adjacent hit target in host CSS', () => {
    const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
    expect(css).toContain('.rackdown-connection:hover,');
    expect(css).toContain('.rackdown-connection:focus-visible,');
    expect(css).toContain(
      '.rackdown-connection-hit:hover + .rackdown-connection',
    );
    expect(css).toContain(
      'stroke-width: var(--rackdown-connection-hover-width);',
    );
    expect(css).toContain('stroke-width: 10px;');
    expect(css).toContain('pointer-events: stroke;');
    expect(css).toContain('vector-effect: non-scaling-stroke;');
    expect(css).not.toContain('--rackdown-connection-width: 2.5');
  });

  it.each(['path', 'line'])(
    'adds an unfocusable local hit shape with the same %s geometry and semantic id',
    (tag) => {
      const { svg, diagram, routes } = block(1, tag);
      const hits = diagram.querySelectorAll('.rackdown-connection-hit');
      expect(hits).toHaveLength(2);
      for (const [index, hit] of hits.entries()) {
        const route = routes[index] as TestElement;
        expect(hit.tag).toBe(tag);
        expect(hit.getAttribute('data-connection-id')).toBe(
          route.getAttribute('data-connection-id'),
        );
        expect(hit.getAttribute('id')).toBeNull();
        expect(hit.getAttribute('tabindex')).toBe('-1');
        expect(hit.getAttribute('aria-hidden')).toBe('true');
        expect(hit.querySelector('title')).toBeUndefined();
        for (const key of tag === 'path' ? ['d'] : ['x1', 'y1', 'x2', 'y2']) {
          expect(hit.getAttribute(key)).toBe(route.getAttribute(key));
        }
        expect(svg.children[svg.children.indexOf(route) - 1]).toBe(hit);
      }
    },
  );

  it('hides and restores both representations from the hit target without navigating links', () => {
    const { container, diagram, routes } = block();
    const other = block();
    const hit = diagram.querySelector(
      '.rackdown-connection-hit',
    ) as TestElement;
    const openLinkText = vi.fn();
    const links = new RackDownHostLinks(
      container.asHtml(),
      { app: { workspace: { openLinkText } } } as unknown as RackDownPlugin,
      'Lab.md',
    );
    links.onload();
    for (const type of ['click', 'auxclick', 'keydown']) {
      expect(
        fire(container, type, hit, { key: 'Enter' }).defaultPrevented,
      ).toBe(false);
    }
    expect(openLinkText).not.toHaveBeenCalled();
    const link = diagram.append(new TestElement('g', 'rackdown-host-link'));
    link.setAttribute('data-rackdown-target', 'Remote');
    fire(container, 'click', link);
    expect(openLinkText).toHaveBeenCalledWith('Remote', 'Lab.md', false);
    expect(fire(other.diagram, 'contextmenu', hit).defaultPrevented).toBe(
      false,
    );
    expect(fire(diagram, 'contextmenu', hit).defaultPrevented).toBe(true);
    TestMenu.latest.action?.();
    expect(hit.classes.has('rackdown-connection-hidden')).toBe(true);
    expect(routes[0]?.classes.has('rackdown-connection-hidden')).toBe(true);
    expect(other.routes[0]?.classes.has('rackdown-connection-hidden')).toBe(
      false,
    );
    expect(fire(diagram, 'contextmenu', hit).defaultPrevented).toBe(false);
    const reset = container.querySelector('button') as TestElement;
    fire(reset, 'click', reset);
    expect(hit.classes.has('rackdown-connection-hidden')).toBe(false);
    expect(routes[0]?.classes.has('rackdown-connection-hidden')).toBe(false);
    expect(routes[0]?.focus).toHaveBeenCalled();
    links.unload();
  });

  it('makes connections focusable using their existing title and preserves visual meaning', () => {
    const { svg, routes, container } = block();
    expect(svg.getAttribute('role')).toBe('group');
    for (const route of routes) {
      expect(route.getAttribute('tabindex')).toBe('0');
      expect(route.getAttribute('aria-label')).toBe(
        route.querySelector('title')?.textContent,
      );
      expect(route.getAttribute('stroke')).toBe('#123456');
      expect(route.getAttribute('stroke-dasharray')).toBe('3 2');
    }
    expect(container.querySelector('.rackdown-hidden-routes')).toBeUndefined();
  });

  it('hides by existing id, counts unique hidden routes, and restores all through a button', () => {
    const { container, diagram, routes } = block();
    const other = block();
    const first = routes[0] as TestElement;
    expect(fire(diagram, 'contextmenu', first).defaultPrevented).toBe(true);
    expect(TestMenu.latest.title).toBe('Hide connection');
    expect(first.classes.has('rackdown-connection-hidden')).toBe(false);
    TestMenu.latest.action?.();
    TestMenu.latest.action?.();
    const status = container.querySelector(
      '.rackdown-hidden-routes',
    ) as TestElement;
    expect(status.querySelector('span')?.textContent).toBe('1 route hidden');
    expect(first.classes.has('rackdown-connection-hidden')).toBe(true);
    expect(diagram.contains(first)).toBe(true);
    expect(other.routes[0]?.classes.has('rackdown-connection-hidden')).toBe(
      false,
    );

    fire(diagram, 'contextmenu', routes[1] as TestElement);
    TestMenu.latest.action?.();
    expect(status.querySelector('span')?.textContent).toBe('2 routes hidden');
    const reset = status.querySelector('button') as TestElement;
    expect(reset.textContent).toBe('Show all');
    expect(reset.getAttribute('type')).toBe('button');
    fire(reset, 'click', reset);
    expect(
      routes.every((route) => !route.classes.has('rackdown-connection-hidden')),
    ).toBe(true);
    expect(status.hidden).toBe(true);
    expect(first.focus).toHaveBeenCalled();
    fire(diagram, 'contextmenu', first);
    TestMenu.latest.action?.();
    expect(status.hidden).toBe(false);
    expect(status.querySelector('span')?.textContent).toBe('1 route hidden');
    expect(container.querySelectorAll('.rackdown-hidden-routes')).toHaveLength(
      1,
    );
  });

  it.each([{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }])(
    'supports standard keyboard context menus: %j',
    (keys) => {
      const { diagram, routes } = block();
      const event = fire(diagram, 'keydown', routes[0] as TestElement, keys);
      expect(event.defaultPrevented).toBe(true);
      expect(TestMenu.latest.showAtPosition).toHaveBeenCalledWith(
        { x: 60, y: 45 },
        diagram.ownerDocument,
      );
    },
  );

  it('leaves ordinary clicks, modifier clicks, Enter and link context menus alone', () => {
    const { diagram, routes } = block();
    const link = diagram.append(new TestElement('g', 'rackdown-host-link'));
    for (const type of ['click', 'auxclick']) {
      expect(
        fire(diagram, type, routes[0] as TestElement, { ctrlKey: true })
          .defaultPrevented,
      ).toBe(false);
    }
    expect(
      fire(diagram, 'keydown', routes[0] as TestElement, { key: 'Enter' })
        .defaultPrevented,
    ).toBe(false);
    expect(fire(diagram, 'contextmenu', link).defaultPrevented).toBe(false);
    expect(
      fire(diagram, 'keydown', link, { key: 'ContextMenu' }).defaultPrevented,
    ).toBe(false);
  });

  it('cleans up menus, hidden state and controls with the render child', () => {
    const { container, diagram, routes, controller } = block();
    fire(diagram, 'contextmenu', routes[0] as TestElement);
    TestMenu.latest.action?.();
    controller.unload();
    expect(diagram.querySelectorAll('.rackdown-connection-hit')).toHaveLength(
      0,
    );
    expect(
      routes[0]?.style.getPropertyValue('--rackdown-connection-hover-width'),
    ).toBe('');
    expect(routes[0]?.getAttribute('tabindex')).toBeNull();
    expect(TestMenu.latest.hide).toHaveBeenCalled();
    expect(container.querySelector('.rackdown-hidden-routes')).toBeUndefined();
    expect(routes[0]?.classes.has('rackdown-connection-hidden')).toBe(false);
    expect(
      fire(diagram, 'contextmenu', routes[0] as TestElement).defaultPrevented,
    ).toBe(false);
    expect(
      block().container.querySelector('.rackdown-hidden-routes'),
    ).toBeUndefined();
  });
});
