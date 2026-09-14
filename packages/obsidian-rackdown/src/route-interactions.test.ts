import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fire, TestElement, TestMenu } from './host-test-support.js';
import { RackDownRouteInteractions } from './route-interactions.js';

vi.mock('obsidian', async () => {
  const { TestMenu, TestRenderChild } = await import('./host-test-support.js');
  return {
    MarkdownRenderChild: TestRenderChild,
    Menu: TestMenu,
  };
});

function block() {
  const container = new TestElement();
  const diagram = container.append(new TestElement());
  const svg = diagram.append(new TestElement('svg'));
  const routes = ['one', 'two'].map((id) => {
    const route = svg.append(new TestElement('path', 'rackdown-connection'));
    route.setAttribute('data-connection-id', id);
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
