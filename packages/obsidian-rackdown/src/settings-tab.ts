import { PluginSettingTab, Setting, SettingGroup } from 'obsidian';
import type RackDownPlugin from './main.js';
import {
  CONNECTION_COLOUR_CHOICES,
  CONNECTION_THICKNESS,
  EXTERNAL_PLACEMENT_CHOICES,
  type RackDownPluginSettings,
  ROUTING_CHOICES,
  THEME_CHOICES,
} from './settings.js';

export class RackDownSettingTab extends PluginSettingTab {
  constructor(private readonly plugin: RackDownPlugin) {
    super(plugin.app, plugin);
  }

  override display(): void {
    this.containerEl.empty();
    // SettingGroup owns the host's grouped row styling (Obsidian 1.11+).
    // Older hosts retain their native Setting layout without a version bump.
    const group =
      typeof SettingGroup === 'function'
        ? new SettingGroup(this.containerEl)
        : undefined;
    const addSetting = (configure: (setting: Setting) => void): void => {
      if (group) group.addSetting(configure);
      else configure(new Setting(this.containerEl));
    };
    this.addDropdown(
      addSetting,
      'Routing',
      'Connection routing method.',
      'routing',
      ROUTING_CHOICES,
    );
    this.addDropdown(
      addSetting,
      'External placement',
      'Where external references appear.',
      'externalPlacement',
      EXTERNAL_PLACEMENT_CHOICES,
    );
    this.addDropdown(
      addSetting,
      'Connection colour',
      'Automatic connection colours or monochrome.',
      'connectionColourMode',
      CONNECTION_COLOUR_CHOICES,
    );
    addSetting((setting) => {
      setting
        .setName('Connection thickness')
        .setDesc('Default visible connection width.')
        .addSlider((slider) => {
          slider
            .setLimits(
              CONNECTION_THICKNESS.min,
              CONNECTION_THICKNESS.max,
              CONNECTION_THICKNESS.step,
            )
            .setValue(this.plugin.settings.connectionThickness)
            .setDynamicTooltip()
            .onChange(async (value) => {
              await this.plugin.updateSetting('connectionThickness', value);
            });
        });
    });
    this.addDropdown(
      addSetting,
      'Theme',
      'Diagram colour theme. Auto follows the current Obsidian theme.',
      'theme',
      THEME_CHOICES,
    );
  }

  private addDropdown(
    addSetting: (configure: (setting: Setting) => void) => void,
    name: string,
    description: string,
    key: Exclude<keyof RackDownPluginSettings, 'connectionThickness'>,
    choices: Record<string, string>,
  ): void {
    addSetting((setting) =>
      setting
        .setName(name)
        .setDesc(description)
        .addDropdown((dropdown) => {
          dropdown
            .addOptions(choices)
            .setValue(this.plugin.settings[key])
            .onChange(async (value) => {
              await this.plugin.updateSetting(key, value);
            });
        }),
    );
  }
}
