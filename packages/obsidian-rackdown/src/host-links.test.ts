import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RackDownHostLinks } from './host-links.js';
import { fire, TestElement } from './host-test-support.js';
import type RackDownPlugin from './main.js';

vi.mock('obsidian', async () => {
  const { TestRenderChild } = await import('./host-test-support.js');
  return {
    MarkdownRenderChild: TestRenderChild,
    Keymap: {
      isModEvent: (event: MouseEvent) => event.ctrlKey || event.metaKey,
    },
  };
});

describe('host link activation', () => {
  beforeEach(() => vi.stubGlobal('Element', TestElement));

  it.each([
    ['click', {}, false],
    ['click', { ctrlKey: true }, true],
    ['click', { metaKey: true }, true],
    ['auxclick', { button: 1 }, true],
    ['keydown', { key: 'Enter' }, false],
    ['keydown', { key: 'Enter', ctrlKey: true }, true],
  ] as const)(
    'preserves internal links for %s %j',
    (type, properties, newLeaf) => {
      const container = new TestElement();
      const link = container.append(new TestElement('g', 'rackdown-host-link'));
      link.setAttribute('data-rackdown-target', 'Devices/Switch#Ports');
      const label = link.append(new TestElement('text'));
      const openLinkText = vi.fn();
      const plugin = {
        app: { workspace: { openLinkText } },
      } as unknown as RackDownPlugin;
      const controller = new RackDownHostLinks(
        container.asHtml(),
        plugin,
        'Racks/Lab.md',
      );
      controller.onload();
      expect(fire(container, type, label, properties).defaultPrevented).toBe(
        true,
      );
      expect(openLinkText).toHaveBeenCalledWith(
        'Devices/Switch#Ports',
        'Racks/Lab.md',
        newLeaf,
      );
    },
  );

  it.each(['click', 'auxclick', 'keydown'])(
    'opens URLs safely through %s',
    (type) => {
      const container = new TestElement();
      const link = container.append(new TestElement('g', 'rackdown-host-link'));
      link.setAttribute('data-rackdown-target', 'https://example.com/device');
      link.setAttribute('data-rackdown-action', 'external-url');
      const openLinkText = vi.fn();
      const plugin = {
        app: { workspace: { openLinkText } },
      } as unknown as RackDownPlugin;
      new RackDownHostLinks(container.asHtml(), plugin, 'Lab.md').onload();
      fire(container, type, link, {
        button: type === 'auxclick' ? 1 : 0,
        key: 'Enter',
      });
      expect(link.ownerDocument.defaultView.open).toHaveBeenCalledWith(
        'https://example.com/device',
        '_blank',
        'noopener',
      );
      expect(openLinkText).not.toHaveBeenCalled();
    },
  );

  it('does not activate navigation for connection paths or right clicks', () => {
    const container = new TestElement();
    const route = container.append(
      new TestElement('path', 'rackdown-connection'),
    );
    const link = container.append(new TestElement('g', 'rackdown-host-link'));
    link.setAttribute('data-rackdown-target', 'Device');
    const openLinkText = vi.fn();
    const plugin = {
      app: { workspace: { openLinkText } },
    } as unknown as RackDownPlugin;
    new RackDownHostLinks(container.asHtml(), plugin, 'Lab.md').onload();
    expect(fire(container, 'click', route).defaultPrevented).toBe(false);
    expect(
      fire(container, 'keydown', route, { key: 'Enter' }).defaultPrevented,
    ).toBe(false);
    expect(fire(container, 'click', link, { button: 2 }).defaultPrevented).toBe(
      false,
    );
    expect(openLinkText).not.toHaveBeenCalled();
  });
});
