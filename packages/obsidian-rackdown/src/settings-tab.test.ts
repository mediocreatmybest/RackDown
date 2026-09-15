import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestElement } from './host-test-support.js';
import type RackDownPlugin from './main.js';
import { DEFAULT_SETTINGS } from './settings.js';
import { RackDownSettingTab } from './settings-tab.js';

const host = vi.hoisted(() => ({ grouped: true }));

vi.mock('obsidian', async () => {
  const { TestElement } = await import('./host-test-support.js');
  class Setting {
    element: TestElement;
    constructor(container: TestElement) {
      this.element = container.createDiv({ cls: 'setting-item' });
    }
    setName(text: string) {
      this.element.createDiv({ cls: 'setting-item-name', text });
      return this;
    }
    setDesc(text: string) {
      this.element.createDiv({ cls: 'setting-item-description', text });
      return this;
    }
    addDropdown(configure: (control: Control) => void) {
      configure(new Control(this.element.createEl('select')));
      return this;
    }
    addSlider(configure: (control: Control) => void) {
      configure(new Control(this.element.createEl('input', { type: 'range' })));
      return this;
    }
  }
  class Control {
    constructor(readonly element: TestElement) {}
    addOptions(options: Record<string, string>) {
      for (const [value, text] of Object.entries(options)) {
        this.element.createEl('option', { text, attr: { value } });
      }
      return this;
    }
    setValue(value: string | number) {
      this.element.setAttribute('value', String(value));
      return this;
    }
    setLimits(min: number, max: number, step: number) {
      for (const [key, value] of Object.entries({ min, max, step })) {
        this.element.setAttribute(key, String(value));
      }
      return this;
    }
    setDynamicTooltip() {
      this.element.setAttribute('data-dynamic-tooltip', 'true');
      return this;
    }
    onChange(callback: (value: string | number) => Promise<void>) {
      this.element.addEventListener('change', () => {
        const value = this.element.getAttribute('value') ?? '';
        void callback(this.element.tag === 'input' ? Number(value) : value);
      });
      return this;
    }
  }
  return {
    PluginSettingTab: class {
      containerEl = new TestElement();
    },
    Setting,
    get SettingGroup() {
      return host.grouped
        ? class {
            list: TestElement;
            constructor(container: TestElement) {
              this.list = container.createDiv({ cls: 'setting-group' });
            }
            addSetting(configure: (setting: Setting) => void) {
              configure(new Setting(this.list));
              return this;
            }
          }
        : undefined;
    },
  };
});

describe('native settings presentation', () => {
  beforeEach(() => {
    host.grouped = true;
  });

  it.each([true, false])(
    'keeps every row together with native group available=%s',
    async (grouped) => {
      host.grouped = grouped;
      const plugin = {
        app: {},
        settings: { ...DEFAULT_SETTINGS, connectionThickness: 2.75 },
        updateSetting: vi.fn().mockResolvedValue(undefined),
      };
      const tab = new RackDownSettingTab(plugin as unknown as RackDownPlugin);
      tab.display();
      tab.display();
      const container = tab.containerEl as unknown as TestElement;
      const groups = container.querySelectorAll('.setting-group');
      expect(groups).toHaveLength(grouped ? 1 : 0);
      const parent = grouped ? (groups[0] as TestElement) : container;
      const rows = container.querySelectorAll('.setting-item');
      expect(rows).toHaveLength(5);
      expect(rows.every((row) => row.parentElement === parent)).toBe(true);
      expect(
        rows.map((row) => row.querySelector('.setting-item-name')?.textContent),
      ).toEqual([
        'Routing',
        'External placement',
        'Connection colour',
        'Connection thickness',
        'Theme',
      ]);
      expect(
        rows[4]?.querySelector('.setting-item-description')?.textContent,
      ).toBe('Diagram colour theme. Auto follows the current Obsidian theme.');
      const dropdowns = container.querySelectorAll('select');
      expect(
        dropdowns.map((dropdown) =>
          dropdown.children.map((option) => option.textContent),
        ),
      ).toEqual([
        ['Perimeter', 'Direct', 'Orthogonal', 'Lanes'],
        ['Bottom', 'Right'],
        ['Auto', 'Monochrome'],
        ['Auto', 'Light', 'Dark'],
      ]);
      expect(
        dropdowns.map((dropdown) => dropdown.getAttribute('value')),
      ).toEqual(['perimeter', 'bottom', 'auto', 'auto']);
      const slider = container.querySelector('input') as TestElement;
      expect(Object.fromEntries(slider.attributes)).toMatchObject({
        type: 'range',
        min: '1',
        max: '4',
        step: '0.25',
        value: '2.75',
        'data-dynamic-tooltip': 'true',
      });
      slider.setAttribute('value', '3.25');
      slider.dispatchEvent(new Event('change'));
      expect(plugin.updateSetting).toHaveBeenCalledWith(
        'connectionThickness',
        3.25,
      );
      const theme = dropdowns[3] as TestElement;
      theme.setAttribute('value', 'dark');
      theme.dispatchEvent(new Event('change'));
      expect(plugin.updateSetting).toHaveBeenCalledWith('theme', 'dark');
    },
  );
});
