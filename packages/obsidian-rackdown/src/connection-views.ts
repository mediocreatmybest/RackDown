import { type SvgRenderOptions, selectConnections } from '@rackdown/core';
import { MarkdownRenderChild } from 'obsidian';
import { decorateRackDownHostLinks } from './host-links.js';
import {
  type PreparedRackDown,
  renderPreparedRackDown,
} from './render-rackdown.js';
import { RackDownRouteInteractions } from './route-interactions.js';
import {
  CONNECTION_VIEW_LABELS,
  type RackDownConnectionView,
  type RackDownPluginSettings,
} from './settings.js';
import { RackDownViewport } from './viewport.js';

function isConnectionView(value: string): value is RackDownConnectionView {
  return Object.hasOwn(CONNECTION_VIEW_LABELS, value);
}

/** Owns the temporary selected view and every SVG-scoped interaction child. */
export class RackDownConnectionViews extends MarkdownRenderChild {
  private selected: RackDownConnectionView;
  private status: HTMLElement | undefined;
  private routeInteractions: RackDownRouteInteractions | undefined;
  private viewport: RackDownViewport | undefined;

  constructor(
    containerEl: HTMLElement,
    private readonly controls: HTMLElement,
    private readonly diagram: HTMLElement,
    private readonly prepared: PreparedRackDown,
    private readonly options: SvgRenderOptions,
    private readonly settings: RackDownPluginSettings,
  ) {
    super(containerEl);
    this.selected = settings.defaultConnectionView;
  }

  override onload(): void {
    this.viewport = this.addChild(new RackDownViewport(this.diagram));
    this.buildControls(this.controls);
    this.renderSelectedView();
  }

  private buildControls(controls: HTMLElement): void {
    controls.setAttribute('role', 'group');
    controls.setAttribute('aria-label', 'Diagram controls');
    if (this.prepared.layout.connections.length === 0) {
      controls.createSpan({
        cls: 'rackdown-connection-view-empty',
        text: 'No connections',
      });
      return;
    }
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
    const selection =
      this.selected === 'all'
        ? undefined
        : this.selected === 'none'
          ? { connectionIds: [] }
          : { categories: [this.selected] };
    const options: SvgRenderOptions = {
      ...baseOptions,
      ...(selection ? { connectionSelection: selection } : {}),
    };
    const rendered = renderPreparedRackDown(
      this.prepared,
      options,
      this.settings,
    );
    this.diagram.innerHTML = rendered.svg;
    this.viewport?.setSvg(this.diagram.querySelector('svg') ?? undefined);
    decorateRackDownHostLinks(this.diagram, rendered.devices);

    this.routeInteractions = this.addChild(
      new RackDownRouteInteractions(this.containerEl, this.diagram),
    );
    if (this.status) {
      const selected = selectConnections(this.prepared.layout, selection);
      const total = this.prepared.layout.connections.length;
      this.status.textContent = `Showing ${selected.length} of ${total} connections`;
    }
  }
}
