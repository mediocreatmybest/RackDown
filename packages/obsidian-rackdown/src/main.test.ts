import type { MarkdownPostProcessorContext } from 'obsidian';
import { MarkdownView } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fire, TestElement, TestModal } from './host-test-support.js';
import RackDownPlugin from './main.js';
import { DEFAULT_SETTINGS } from './settings.js';

const host = vi.hoisted(() => ({
  saved: undefined as unknown,
  saveData: vi.fn(),
  leaves: [] as { view: unknown }[],
  processor: undefined as
    | undefined
    | ((
        source: string,
        element: HTMLElement,
        context: MarkdownPostProcessorContext,
      ) => Promise<void>),
}));

vi.mock('obsidian', async () => {
  const { TestElement, TestMenu, TestModal, TestRenderChild } = await import(
    './host-test-support.js'
  );
  return {
    MarkdownRenderChild: TestRenderChild,
    Modal: TestModal,
    Menu: TestMenu,
    MarkdownView: class {
      previewMode = { rerender: vi.fn() };
    },
    PluginSettingTab: class {
      containerEl = new TestElement();
    },
    Setting: class {},
    Plugin: class {
      app = {
        workspace: {
          iterateAllLeaves: (callback: (leaf: { view: unknown }) => void) =>
            host.leaves.forEach(callback),
        },
      };
      loadData = async () => host.saved;
      saveData = async (data: unknown) => {
        host.saveData(data);
        host.saved = data;
      };
      addSettingTab = vi.fn();
      registerMarkdownCodeBlockProcessor(
        _language: string,
        processor: typeof host.processor,
      ): void {
        host.processor = processor;
      }
    },
  };
});

async function renderBlock(source: string) {
  const instance = plugin();
  await instance.onload();
  const element = new TestElement();
  const children: { load(): void; unload(): void }[] = [];
  const context = {
    sourcePath: 'Notes/Lab.md',
    getSectionInfo: () => ({ lineStart: 4 }),
    addChild: (child: (typeof children)[number]) => {
      children.push(child);
      child.load();
    },
  } as unknown as MarkdownPostProcessorContext;
  await host.processor?.(source, element.asHtml(), context);
  return {
    element,
    instance,
    button: element.querySelector('.rackdown-notes-button'),
    unload: () => {
      for (const child of children) child.unload();
    },
  };
}

function openNotes(button: TestElement | undefined): TestModal {
  expect(button, 'Notes native button').toBeDefined();
  fire(button as TestElement, 'click', button as TestElement);
  const modal = TestModal.instances.at(-1);
  expect(modal?.opened).toBe(true);
  return modal as TestModal;
}
vi.mock('./catalogue.js', () => ({
  CatalogueProvider: class {
    async deviceIndex() {
      return {};
    }
  },
}));

function plugin(): RackDownPlugin {
  return Reflect.construct(RackDownPlugin, []) as RackDownPlugin;
}

describe('Obsidian settings lifecycle', () => {
  beforeEach(() => {
    vi.stubGlobal('__RACKDOWN_CATALOGUE_PAYLOAD__', '');
    host.saved = undefined;
    host.saveData.mockClear();
    host.leaves = [];
    TestModal.instances = [];
  });

  it('adds a conditional native Notes count without removing No connections', async () => {
    const empty = await renderBlock('rack "Lab" 8U');
    expect(empty.button).toBeUndefined();
    expect(
      empty.element.querySelector('.rackdown-notes-present'),
    ).toBeUndefined();
    const fixture = await renderBlock(
      'rack "Lab" 8U\n8 "Core" notes "same" notes "same"',
    );
    expect(fixture.button?.tag).toBe('button');
    expect(fixture.button?.getAttribute('type')).toBe('button');
    expect(fixture.button?.textContent).toBe('Notes (2)');
    expect(
      fixture.element.querySelector('.rackdown-connection-view-empty')
        ?.textContent,
    ).toBe('No connections');
    expect(
      fixture.element
        .querySelector('.rackdown-connection-view')
        ?.getAttribute('aria-label'),
    ).toBe('Diagram controls');
    expect(TestModal.instances).toHaveLength(0);
    const modal = openNotes(fixture.button);
    expect(modal.titleEl.textContent).toBe('RackDown notes');
    expect(
      modal.contentEl.querySelectorAll('p').map((p) => p.textContent),
    ).toEqual(['same', 'same']);
  });

  it('keeps authored note order, duplicates, exact targets, hidden faces and fractional positions', async () => {
    const fixture = await renderBlock(`notes for host "forward"
rack "Lab" 8U views rear
8 switch "Core" as core notes "first" notes "first"
rear 5 server "Host" as host notes "host"
core:1 -- host:2 fibre category network notes "link one"
core:1 -- host:2 copper category power notes "link two"
notes at 3 "empty"
notes at rear 3.5 "rear"
notes for core "last"`);
    expect(fixture.button?.textContent).toBe('Notes (9)');
    const modal = openNotes(fixture.button);
    expect(
      modal.contentEl.querySelectorAll('p').map((p) => p.textContent),
    ).toEqual([
      'forward',
      'first',
      'first',
      'host',
      'link one',
      'link two',
      'empty',
      'rear',
      'last',
    ]);
    const headings = modal.contentEl
      .querySelectorAll('h3')
      .map((h) => h.textContent);
    expect(headings[0]).toContain('Host');
    expect(headings[0]).toContain('Lab / rear / U5');
    expect(headings[1]).toContain('Core');
    expect(headings[1]).toContain('Lab / front / U8');
    expect(headings[4]).toContain('Core:1');
    expect(headings[4]).toContain('Host:2');
    expect(headings[4]).toContain('connection 1');
    expect(headings[5]).toContain('connection 2');
    expect(headings[6]).toBe('Lab / front / U3');
    expect(headings[7]).toBe('Lab / rear / U3.5');
  });

  it('disambiguates duplicate rack names and parallel external connections in layout order', async () => {
    const fixture = await renderBlock(`rack "Same" 8U
8 "Core" as a notes "A"
a:1 -- [[Remote|WAN]] notes "external one"
a:1 -- [[Remote|WAN]] notes "external two"
rack "Same" 8U
8 "Core" as b notes "B"
notes at 2 "position B"`);
    const headings = openNotes(fixture.button)
      .contentEl.querySelectorAll('h3')
      .map((h) => h.textContent);
    expect(headings[0]).toContain('Same (rack 1) / front / U8');
    expect(headings[1]).toContain('Core:1');
    expect(headings[1]).toContain('WAN');
    expect(headings[1]).toContain('connection 1');
    expect(headings[2]).toContain('connection 2');
    expect(headings[3]).toContain('Same (rack 2) / front / U8');
    expect(headings[4]).toBe('Same (rack 2) / front / U2');
  });

  it.each([true, false])(
    'disambiguates colliding shared-row device descriptions with aliases=%s',
    async (withAliases) => {
      const fixture = await renderBlock(`rack "Lab" 8U
8 "Solo" notes "unique"
8 "Core"${withAliases ? ' as first' : ''} notes "first"
8 "Core"${withAliases ? ' as second' : ''} notes "second"${withAliases ? '\nfirst:1 -- [[WAN]] notes "first connection"\nsecond:1 -- [[WAN]] notes "second connection"' : ''}`);
      const modal = openNotes(fixture.button);
      const headings = modal.contentEl
        .querySelectorAll('h3')
        .map((h) => h.textContent);
      expect(headings.slice(0, 3)).toEqual([
        'Solo — Lab / front / U8',
        'Core (device 1) — Lab / front / U8',
        'Core (device 2) — Lab / front / U8',
      ]);
      if (withAliases) {
        expect(headings[3]).toBe('Core (device 1):1 (Lab / front / U8) — WAN');
        expect(headings[4]).toBe('Core (device 2):1 (Lab / front / U8) — WAN');
      }
      expect(
        modal.contentEl.querySelectorAll('p').map((p) => p.textContent),
      ).toEqual(
        withAliases
          ? [
              'unique',
              'first',
              'second',
              'first connection',
              'second connection',
            ]
          : ['unique', 'first', 'second'],
      );
    },
  );

  it('renders malicious HTML, Markdown and URLs literally using text elements', async () => {
    const text =
      '<img src=x onerror=alert(1)> **bold** [[Wiki]] [URL](https://example.com/)';
    const fixture = await renderBlock(
      `rack "<script>rack</script>" 8U\n8 "<b>Core</b>" notes "${text}"`,
    );
    const modal = openNotes(fixture.button);
    expect(modal.contentEl.querySelector('p')?.textContent).toBe(text);
    expect(modal.contentEl.querySelector('h3')?.textContent).toContain(
      '<b>Core</b>',
    );
    expect(modal.contentEl.querySelector('h3')?.textContent).toContain(
      '<script>rack</script>',
    );
    for (const tag of ['img', 'script', 'a', 'b'])
      expect(modal.contentEl.querySelector(tag)).toBeUndefined();
    modal.close();
    expect(modal.contentEl.children).toHaveLength(0);
  });

  it('retains every note across category filters without changing SVG, scroll or settings when opened', async () => {
    const fixture = await renderBlock(
      'rack "Lab" 8U views rear\n8 "Core" as core notes "hidden face"\ncore:1 -- [[WAN]] category network notes "network"\ncore:2 -- [[Power]] category power notes "power"',
    );
    const select = fixture.element.querySelector('select') as TestElement;
    select.value = 'console';
    fire(select, 'change', select);
    const diagram = fixture.element.querySelector(
      '.rackdown-diagram',
    ) as TestElement;
    diagram.scrollLeft = 24;
    diagram.asHtml().scrollTop = 67;
    const svg = diagram.innerHTML;
    const settings = JSON.stringify(fixture.instance.settings);
    const status = fixture.element.querySelector(
      '.rackdown-connection-view-status',
    )?.textContent;
    expect(
      openNotes(fixture.button)
        .contentEl.querySelectorAll('p')
        .map((p) => p.textContent),
    ).toEqual(['hidden face', 'network', 'power']);
    expect(diagram.innerHTML).toBe(svg);
    expect(diagram.scrollLeft).toBe(24);
    expect(diagram.asHtml().scrollTop).toBe(67);
    expect(select.value).toBe('console');
    expect(
      fixture.element.querySelector('.rackdown-connection-view-status')
        ?.textContent,
    ).toBe(status);
    expect(JSON.stringify(fixture.instance.settings)).toBe(settings);
    expect(host.saveData).not.toHaveBeenCalled();
  });

  it('owns independent modal lifecycles and restores connected opener focus on native close', async () => {
    const first = await renderBlock('rack "A" 8U\n8 "Core" notes "first"');
    const second = await renderBlock('rack "B" 8U\n8 "Core" notes "second"');
    const firstModal = openNotes(first.button);
    const secondModal = openNotes(second.button);
    expect(firstModal).not.toBe(secondModal);
    expect(firstModal.contentEl.querySelector('p')?.textContent).toBe('first');
    firstModal.close();
    expect(first.button?.focus).toHaveBeenCalledExactlyOnceWith({
      preventScroll: true,
    });
    expect(secondModal.opened).toBe(true);
    const reopened = openNotes(first.button);
    expect(reopened.contentEl.querySelectorAll('p')).toHaveLength(1);
    if (first.button) first.button.isConnected = false;
    first.unload();
    expect(reopened.opened).toBe(false);
    expect(first.button?.focus).toHaveBeenCalledOnce();
    expect(secondModal.opened).toBe(true);
    const modalCount = TestModal.instances.length;
    fire(first.button as TestElement, 'click', first.button as TestElement);
    expect(TestModal.instances).toHaveLength(modalCount);
    second.unload();
    expect(secondModal.opened).toBe(false);
    expect(second.button?.focus).not.toHaveBeenCalled();
    expect(
      second.element.querySelector('.rackdown-notes-button'),
    ).toBeUndefined();
  });

  it('loads validated settings before registering blocks and the settings tab', async () => {
    host.saved = { routing: 'lanes', theme: 'none' };
    const instance = plugin();
    await instance.onload();
    expect(instance.settings).toEqual({
      ...DEFAULT_SETTINGS,
      routing: 'lanes',
    });
    expect(instance.addSettingTab).toHaveBeenCalledOnce();
    expect(host.processor).toBeTypeOf('function');
  });

  it('persists changes, rerenders every open Markdown preview and survives reload', async () => {
    const first = Reflect.construct(MarkdownView, []) as MarkdownView;
    const second = Reflect.construct(MarkdownView, []) as MarkdownView;
    host.leaves = [{ view: first }, { view: {} }, { view: second }];
    const instance = plugin();
    await instance.onload();
    await instance.updateSetting('routing', 'direct');
    await instance.updateSetting('externalPlacement', 'right');
    await instance.updateSetting('connectionColourMode', 'monochrome');
    await instance.updateSetting('theme', 'dark');
    await instance.updateSetting('connectionThickness', 2.75);
    expect(host.saveData).toHaveBeenLastCalledWith({
      routing: 'direct',
      externalPlacement: 'right',
      connectionColourMode: 'monochrome',
      connectionThickness: 2.75,
      theme: 'dark',
    });
    expect(first.previewMode.rerender).toHaveBeenCalledWith(true);
    expect(second.previewMode.rerender).toHaveBeenCalledWith(true);
    const reloaded = plugin();
    await reloaded.onload();
    expect(reloaded.settings).toEqual(instance.settings);
  });

  it('uses current settings on subsequent processor calls and renders with null section metadata', async () => {
    const instance = plugin();
    await instance.onload();
    const processor = host.processor;
    const context = {
      sourcePath: 'Notes/Lab.md',
      getSectionInfo: () => null,
      addChild: (child: { load: () => void }) => child.load(),
    } as unknown as MarkdownPostProcessorContext;
    const initial = new TestElement();
    await processor?.('rack "Lab" 12U', initial.asHtml(), context);
    expect(initial.querySelector('.rackdown-connection-view')).toBeDefined();
    expect(
      initial.querySelector('.rackdown-connection-view-empty')?.textContent,
    ).toBe('No connections');
    expect(initial.querySelector('select')).toBeUndefined();
    expect(initial.querySelector('.rackdown-diagram')?.innerHTML).toContain(
      'data-connection-routing="perimeter"',
    );
    await instance.updateSetting('routing', 'orthogonal');
    await instance.updateSetting('theme', 'light');
    await instance.updateSetting('connectionThickness', 4);
    const subsequent = new TestElement();
    await processor?.(
      'rack "Lab" 12U\n10 switch "Core" as core\ncore:1 -- [[Remote]]',
      subsequent.asHtml(),
      context,
    );
    const svg = subsequent.querySelector('.rackdown-diagram')?.innerHTML;
    expect(subsequent.querySelector('select')?.value).toBe('all');
    expect(
      subsequent.querySelector('.rackdown-connection-view-status')?.textContent,
    ).toBe('Showing 1 of 1 connections');
    expect(svg).toContain('stroke-width="4"');
    expect(svg).toContain('data-connection-routing="orthogonal"');
    expect(svg).toContain('obsidian-Notes-Lab-md-0');
    expect(
      subsequent
        .querySelector('.rackdown-block')
        ?.getAttribute('data-rackdown-theme'),
    ).toBe('light');
  });

  it('keeps one document diagnostic section while changing a block view', async () => {
    const instance = plugin();
    await instance.onload();
    const context = {
      sourcePath: 'Notes/Lab.md',
      getSectionInfo: () => ({ lineStart: 12 }),
      addChild: (child: { load: () => void }) => child.load(),
    } as unknown as MarkdownPostProcessorContext;
    const element = new TestElement();
    await host.processor?.(
      'rack "Lab" 12U\n10 switch "Core" as core\n' +
        'core:1 -- [[Remote]] category network\nbanana',
      element.asHtml(),
      context,
    );
    const diagnostics = element.querySelector('.rackdown-diagnostics');
    const select = element.querySelector('select');
    expect(diagnostics).toBeDefined();
    expect(element.querySelectorAll('.rackdown-diagnostics')).toHaveLength(1);
    if (!select) throw new Error('Missing connection selector');
    select.value = 'power';
    select.dispatchEvent(new Event('change'));
    select.value = 'network';
    select.dispatchEvent(new Event('change'));
    expect(element.querySelectorAll('.rackdown-diagnostics')).toEqual([
      diagnostics,
    ]);
  });
});
