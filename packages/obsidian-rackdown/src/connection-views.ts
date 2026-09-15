import {
  type ConnectionCategory,
  type SvgRenderOptions,
  selectConnections,
} from '@rackdown/core';
import { MarkdownRenderChild } from 'obsidian';
import { decorateRackDownHostLinks } from './host-links.js';
import {
  type PreparedRackDown,
  renderPreparedRackDown,
} from './render-rackdown.js';
import { RackDownRouteInteractions } from './route-interactions.js';
import type { RackDownPluginSettings } from './settings.js';

export type RackDownConnectionView = 'all' | ConnectionCategory;

export const CONNECTION_VIEW_LABELS = {
  all: 'All',
  network: 'Network',
  power: 'Power',
  console: 'Console',
  unclassified: 'Unclassified',
} as const satisfies Record<RackDownConnectionView, string>;

function isConnectionView(value: string): value is RackDownConnectionView {
  return Object.hasOwn(CONNECTION_VIEW_LABELS, value);
}

/** Owns the temporary selected view and every SVG-scoped interaction child. */
export class RackDownConnectionViews extends MarkdownRenderChild {
  private selected: RackDownConnectionView = 'all';
  private status: HTMLElement | undefined;
  private routeInteractions: RackDownRouteInteractions | undefined;

  constructor(
    containerEl: HTMLElement,
    private readonly controls: HTMLElement | undefined,
    private readonly diagram: HTMLElement,
    private readonly prepared: PreparedRackDown,
    private readonly options: SvgRenderOptions,
    private readonly settings: RackDownPluginSettings,
  ) {
    super(containerEl);
  }

  override onload(): void {
    if (this.controls) this.buildControls(this.controls);
    this.renderSelectedView();
  }

  private buildControls(controls: HTMLElement): void {
    const label = controls.createEl('label', {
      cls: 'rackdown-connection-view-label',
    });
    label.createSpan({ text: 'Connections:' });
    const select = label.createEl('select', {
      cls: 'rackdown-connection-view-select',
      attr: { 'aria-label': 'Connection view' },
    });

    for (const [value, text] of Object.entries(CONNECTION_VIEW_LABELS)) {
      select.createEl('option', { text, value });
    }
    select.value = this.selected;

    this.status = controls.createSpan({
      cls: 'rackdown-connection-view-status',
      attr: { 'aria-live': 'polite', 'aria-atomic': 'true' },
    });
    this.registerDomEvent(select, 'change', () => {
      if (!isConnectionView(select.value)) return;
      this.selected = select.value;
      this.renderSelectedView();
    });
  }

  private renderSelectedView(): void {
    if (this.routeInteractions) {
      this.removeChild(this.routeInteractions);
      this.routeInteractions = undefined;
    }

    const { connectionSelection: _selection, ...baseOptions } = this.options;
    const options: SvgRenderOptions =
      this.selected === 'all'
        ? baseOptions
        : {
            ...baseOptions,
            connectionSelection: { categories: [this.selected] },
          };
    const rendered = renderPreparedRackDown(
      this.prepared,
      options,
      this.settings,
    );
    this.diagram.innerHTML = rendered.svg;
    decorateRackDownHostLinks(this.diagram, rendered.devices);

    this.routeInteractions = this.addChild(
      new RackDownRouteInteractions(this.containerEl, this.diagram),
    );
    if (this.status) {
      const selected =
        this.selected === 'all'
          ? this.prepared.layout.connections
          : selectConnections(this.prepared.layout, {
              categories: [this.selected],
            });
      const total = this.prepared.layout.connections.length;
      this.status.textContent = `Showing ${selected.length} of ${total} connections`;
    }
  }
}
