import type { DeviceIndex, Diagnostic } from '@rackdown/core';
import { MarkdownView, Plugin } from 'obsidian';

import { CatalogueProvider } from './catalogue.js';
import { RackDownHostLinks } from './host-links.js';
import { classifyHostNavigation } from './host-navigation.js';
import { parseObsidianWikiLink } from './obsidian-wikilink.js';
import {
  type RackDownRenderedDevice,
  renderRackDown,
} from './render-rackdown.js';
import { RackDownRouteInteractions } from './route-interactions.js';
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

function decorateHostLink(
  element: Element,
  target: string,
  display: string,
  action: 'internal' | 'external-url' = 'internal',
): void {
  element.classList.add('rackdown-host-link');
  element.setAttribute('data-rackdown-target', target);
  element.setAttribute('data-rackdown-action', action);
  element.setAttribute('role', 'link');
  element.setAttribute('tabindex', '0');
  element.setAttribute('aria-label', `Open ${display}`);
}

function decorateExternalLinks(diagram: HTMLElement): number {
  let count = 0;

  for (const group of diagram.querySelectorAll('.rackdown-external-group')) {
    const linkStyle = group.getAttribute('data-link-style');
    const target = group.getAttribute('data-target');
    const label = group.getAttribute('data-label') ?? target ?? '';

    const navigation = classifyHostNavigation(linkStyle, target);
    if (navigation.kind === 'none') {
      continue;
    }

    group.classList.add('rackdown-external-link');
    decorateHostLink(group, navigation.target, label, navigation.kind);
    count += 1;
  }

  return count;
}

function decorateDeviceLinks(
  diagram: HTMLElement,
  devices: readonly RackDownRenderedDevice[],
): number {
  const groups = new Map<string, Element>();
  for (const group of diagram.querySelectorAll(
    '.rackdown-device-group[data-device-id]',
  )) {
    const id = group.getAttribute('data-device-id');
    if (id) {
      groups.set(id, group);
    }
  }

  let count = 0;
  for (const device of devices) {
    const wikiLink = parseObsidianWikiLink(device.label);
    const group = groups.get(device.id);
    if (!wikiLink || !group) {
      continue;
    }

    const title = group.querySelector('title');
    if (title) {
      title.textContent = wikiLink.display;
    }

    const label = group.querySelector('.rackdown-device-label');
    if (label) {
      label.textContent = wikiLink.display;
    }

    group.classList.add('rackdown-device-link');
    decorateHostLink(group, wikiLink.target, wikiLink.display);
    count += 1;
  }

  return count;
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
        const result = renderRackDown(
          source,
          {
            namespace: blockNamespace(
              context.sourcePath,
              element,
              section?.lineStart,
            ),
          },
          devices,
          this.settings,
        );
        const diagnostics = catalogueDiagnostic
          ? [catalogueDiagnostic, ...result.diagnostics]
          : result.diagnostics;
        const block = element.createDiv({ cls: 'rackdown-block' });
        block.setAttribute('data-rackdown-theme', this.settings.theme);
        const diagram = block.createDiv({ cls: 'rackdown-diagram' });

        diagram.innerHTML = result.svg;
        context.addChild(new RackDownRouteInteractions(block, diagram));

        const linkCount =
          decorateExternalLinks(diagram) +
          decorateDeviceLinks(diagram, result.devices);
        if (linkCount > 0) {
          context.addChild(
            new RackDownHostLinks(block, this, context.sourcePath),
          );
        }

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
