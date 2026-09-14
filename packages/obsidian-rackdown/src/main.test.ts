import type { MarkdownPostProcessorContext } from 'obsidian';
import { MarkdownView } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestElement } from './host-test-support.js';
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
  const { TestElement, TestMenu, TestRenderChild } = await import(
    './host-test-support.js'
  );
  return {
    MarkdownRenderChild: TestRenderChild,
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
      addChild: vi.fn(),
    } as unknown as MarkdownPostProcessorContext;
    const initial = new TestElement();
    await processor?.('rack "Lab" 12U', initial.asHtml(), context);
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
    expect(svg).toContain('stroke-width="4"');
    expect(svg).toContain('data-connection-routing="orthogonal"');
    expect(svg).toContain('obsidian-Notes-Lab-md-0');
    expect(
      subsequent
        .querySelector('.rackdown-block')
        ?.getAttribute('data-rackdown-theme'),
    ).toBe('light');
  });
});
