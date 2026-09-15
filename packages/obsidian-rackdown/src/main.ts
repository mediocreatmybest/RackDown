import type { DeviceIndex, Diagnostic } from '@rackdown/core';
import { MarkdownView, Plugin } from 'obsidian';

import { CatalogueProvider } from './catalogue.js';
import { RackDownConnectionViews } from './connection-views.js';
import { RackDownHostLinks } from './host-links.js';
import { prepareRackDown } from './render-rackdown.js';
import { normalizeSettings, type RackDownPluginSettings } from './settings.js';
import { RackDownSettingTab } from './settings-tab.js';

declare const __RACKDOWN_CATALOGUE_PAYLOAD__: string;

function blockNamespace(
  sourcePath: string,
  element: HTMLElement,
  lineStart: number | undefined,
): string {
  const siblingIndex = element.parentElement
    ? Array.from(element.parentElement.children).indexOf(element)
    : 0;
  return `obsidian-${sourcePath}-${lineStart ?? siblingIndex}`;
}

function catalogueFailureDiagnostic(error: unknown): Diagnostic {
  const detail = error instanceof Error ? error.message : String(error);
  return {
    severity: 'warn',
    line: 1,
    column: 1,
    message:
      'Device catalogue unavailable; rendering with generic definitions.',
    hint: detail,
  };
}

export default class RackDownPlugin extends Plugin {
  settings: RackDownPluginSettings = normalizeSettings(undefined);

  private readonly catalogue = new CatalogueProvider(
    __RACKDOWN_CATALOGUE_PAYLOAD__,
  );

  async updateSetting(
    key: keyof RackDownPluginSettings,
    value: string | number,
  ): Promise<void> {
    this.settings = normalizeSettings({ ...this.settings, [key]: value });
    await this.saveData(this.settings);
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view instanceof MarkdownView) {
        leaf.view.previewMode.rerender(true);
      }
    });
  }

  override async onload(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
    this.addSettingTab(new RackDownSettingTab(this));
    this.registerMarkdownCodeBlockProcessor(
      'rackdown',
      async (source, element, context) => {
        let devices: DeviceIndex = {};
        let catalogueDiagnostic: Diagnostic | undefined;
        try {
          devices = await this.catalogue.deviceIndex();
        } catch (error) {
          console.error('RackDown device catalogue failed to load.', error);
          catalogueDiagnostic = catalogueFailureDiagnostic(error);
        }

        const section = context.getSectionInfo(element);
        const namespace = blockNamespace(
          context.sourcePath,
          element,
          section?.lineStart,
        );
        const prepared = prepareRackDown(source, devices);
        const diagnostics = catalogueDiagnostic
          ? [catalogueDiagnostic, ...prepared.diagnostics]
          : prepared.diagnostics;
        const block = element.createDiv({ cls: 'rackdown-block' });
        block.setAttribute('data-rackdown-theme', this.settings.theme);
        const controls =
          prepared.layout.connections.length > 0
            ? block.createDiv({ cls: 'rackdown-connection-view' })
            : undefined;
        const diagram = block.createDiv({ cls: 'rackdown-diagram' });
        context.addChild(
          new RackDownConnectionViews(
            block,
            controls,
            diagram,
            prepared,
            { namespace },
            this.settings,
          ),
        );
        context.addChild(
          new RackDownHostLinks(block, this, context.sourcePath),
        );

        if (diagnostics.length === 0) {
          return;
        }

        const diagnosticsElement = block.createDiv({
          cls: 'rackdown-diagnostics',
        });
        diagnosticsElement.setAttribute('aria-label', 'RackDown diagnostics');
        const list = diagnosticsElement.createEl('ul');

        for (const diagnostic of diagnostics) {
          const item = list.createEl('li', {
            cls: `rackdown-diagnostic rackdown-diagnostic-${diagnostic.severity}`,
          });
          item.createSpan({
            cls: 'rackdown-diagnostic-severity',
            text: diagnostic.severity.toUpperCase(),
          });
          item.appendText(` — Line ${diagnostic.line}: ${diagnostic.message}`);

          if (diagnostic.hint) {
            item.createDiv({
              cls: 'rackdown-diagnostic-hint',
              text: diagnostic.hint,
            });
          }
        }
      },
    );
  }
}
