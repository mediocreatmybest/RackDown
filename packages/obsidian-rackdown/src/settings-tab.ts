import { PluginSettingTab, Setting } from 'obsidian';
import type RackDownPlugin from './main.js';
import {
  CONNECTION_COLOUR_CHOICES,
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
    this.addDropdown(
      'Routing',
      'Connection routing method.',
      'routing',
      ROUTING_CHOICES,
    );
    this.addDropdown(
      'External placement',
      'Where external references appear.',
      'externalPlacement',
      EXTERNAL_PLACEMENT_CHOICES,
    );
    this.addDropdown(
      'Connection colour',
      'Automatic connection colours or monochrome.',
      'connectionColourMode',
      CONNECTION_COLOUR_CHOICES,
    );
    this.addDropdown(
      'Theme',
      'Auto follows the Obsidian theme.',
      'theme',
      THEME_CHOICES,
    );
  }

  private addDropdown(
    name: string,
    description: string,
    key: keyof RackDownPluginSettings,
    choices: Record<string, string>,
  ): void {
    new Setting(this.containerEl)
      .setName(name)
      .setDesc(description)
      .addDropdown((dropdown) => {
        dropdown
          .addOptions(choices)
          .setValue(this.plugin.settings[key])
          .onChange(async (value) => {
            await this.plugin.updateSetting(key, value);
          });
      });
  }
}
