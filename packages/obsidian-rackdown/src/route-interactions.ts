import { MarkdownRenderChild, Menu } from 'obsidian';

const CONNECTION_SELECTOR = '.rackdown-connection[data-connection-id]';
const HIDDEN_CLASS = 'rackdown-connection-hidden';

/** View state lives for exactly one rendered block. */
export class RackDownRouteInteractions extends MarkdownRenderChild {
  private readonly hidden = new Set<string>();
  private connections: SVGElement[] = [];
  private readonly hitTargets = new Map<SVGElement, SVGElement>();
  private status: HTMLElement | undefined;
  private count: HTMLElement | undefined;
  private reset: HTMLButtonElement | undefined;
  private menu: Menu | undefined;

  constructor(
    containerEl: HTMLElement,
    private readonly diagram: HTMLElement,
  ) {
    super(containerEl);
  }

  override onload(): void {
    this.connections = Array.from(
      this.diagram.querySelectorAll<SVGElement>(CONNECTION_SELECTOR),
    );
    // An atomic image role would conceal the interactive SVG descendants.
    this.diagram.querySelector('svg')?.setAttribute('role', 'group');
    for (const connection of this.connections) {
      // Clone only the shape, keeping the hit area below the visible route and
      // the renderer's later device/link layers. Never duplicate an SVG id.
      const hit = connection.cloneNode(false) as SVGElement;
      hit.removeAttribute('id');
      hit.setAttribute('class', 'rackdown-connection-hit');
      hit.setAttribute('aria-hidden', 'true');
      hit.setAttribute('tabindex', '-1');
      connection.before(hit);
      this.hitTargets.set(hit, connection);

      // The renderer has already resolved global and per-connection widths.
      // Add one CSS pixel, without a cap that could thin an explicit wide route.
      const width = Number(connection.getAttribute('stroke-width'));
      connection.style.setProperty(
        '--rackdown-connection-hover-width',
        `${width + 1}px`,
      );
      connection.setAttribute('tabindex', '0');
      connection.setAttribute('role', 'img');
      const title = connection.querySelector('title')?.textContent?.trim();
      if (title) {
        connection.setAttribute('aria-label', title);
      }
    }

    this.registerDomEvent(this.diagram, 'contextmenu', (event) => {
      const connection = this.connectionFrom(event.targetNode);
      if (!connection) return;
      event.preventDefault();
      event.stopPropagation();
      this.connectionMenu(connection).showAtMouseEvent(event);
    });

    this.registerDomEvent(this.diagram, 'keydown', (event) => {
      if (
        event.key !== 'ContextMenu' &&
        !(event.key === 'F10' && event.shiftKey)
      ) {
        return;
      }
      const connection = this.connectionFrom(event.targetNode);
      if (!connection) return;
      event.preventDefault();
      event.stopPropagation();
      const bounds = connection.getBoundingClientRect();
      this.connectionMenu(connection).showAtPosition(
        {
          x: bounds.left + bounds.width / 2,
          y: bounds.top + bounds.height / 2,
        },
        this.diagram.ownerDocument,
      );
    });
  }

  private connectionFrom(target: Node | null): SVGElement | undefined {
    if (!target?.instanceOf(Element)) return undefined;
    const connection =
      this.hitTargets.get(target as SVGElement) ??
      target.closest(CONNECTION_SELECTOR);
    return this.connections.find(
      (candidate) =>
        candidate === connection && !candidate.classList.contains(HIDDEN_CLASS),
    );
  }

  private connectionMenu(connection: SVGElement): Menu {
    this.menu?.hide();
    const menu = new Menu();
    menu.addItem((item) => {
      item
        .setTitle('Hide connection')
        .onClick(() => this.hideConnection(connection));
    });
    this.menu = menu;
    return menu;
  }

  private hideConnection(connection: SVGElement): void {
    const id = connection.getAttribute('data-connection-id');
    if (!id) return;
    this.hidden.add(id);
    for (const route of this.connections) {
      if (route.getAttribute('data-connection-id') === id) {
        route.classList.add(HIDDEN_CLASS);
      }
    }
    for (const [hit, route] of this.hitTargets) {
      if (route.getAttribute('data-connection-id') === id) {
        hit.classList.add(HIDDEN_CLASS);
      }
    }
    if (!this.status) {
      this.status = this.containerEl.createDiv({
        cls: 'rackdown-hidden-routes',
      });
      this.count = this.status.createSpan({ attr: { 'aria-live': 'polite' } });
      this.status.appendText(' · ');
      this.reset = this.status.createEl('button', {
        text: 'Show all',
        type: 'button',
      });
      this.registerDomEvent(this.reset, 'click', () => this.showAll(true));
    }
    if (this.count) {
      this.count.textContent = `${this.hidden.size} ${this.hidden.size === 1 ? 'route' : 'routes'} hidden`;
    }
    this.status.hidden = false;
    this.reset?.focus();
  }

  private showAll(restoreFocus: boolean): void {
    const firstHidden = this.connections.find((route) =>
      route.classList.contains(HIDDEN_CLASS),
    );
    for (const connection of this.connections) {
      connection.classList.remove(HIDDEN_CLASS);
    }
    for (const hit of this.hitTargets.keys())
      hit.classList.remove(HIDDEN_CLASS);
    this.hidden.clear();
    if (restoreFocus) firstHidden?.focus();
    if (this.status) this.status.hidden = true;
  }

  override onunload(): void {
    this.menu?.hide();
    this.showAll(false);
    this.status?.remove();
    for (const hit of this.hitTargets.keys()) hit.remove();
    this.hitTargets.clear();
    for (const connection of this.connections) {
      connection.style.removeProperty('--rackdown-connection-hover-width');
      connection.removeAttribute('tabindex');
      connection.removeAttribute('role');
      connection.removeAttribute('aria-label');
    }
    this.diagram.querySelector('svg')?.setAttribute('role', 'img');
    this.connections = [];
  }
}
