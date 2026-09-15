import { Keymap, MarkdownRenderChild } from 'obsidian';
import { classifyHostNavigation } from './host-navigation.js';
import type RackDownPlugin from './main.js';
import { parseObsidianWikiLink } from './obsidian-wikilink.js';
import type { RackDownRenderedDevice } from './render-rackdown.js';

const HOST_LINK_SELECTOR = '.rackdown-host-link[data-rackdown-target]';

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

/** Reapply host-specific link semantics after an SVG view is replaced. */
export function decorateRackDownHostLinks(
  diagram: HTMLElement,
  devices: readonly RackDownRenderedDevice[],
): number {
  let count = 0;

  for (const group of diagram.querySelectorAll('.rackdown-external-group')) {
    const linkStyle = group.getAttribute('data-link-style');
    const target = group.getAttribute('data-target');
    const label = group.getAttribute('data-label') ?? target ?? '';
    const navigation = classifyHostNavigation(linkStyle, target);
    if (navigation.kind === 'none') continue;

    group.classList.add('rackdown-external-link');
    decorateHostLink(group, navigation.target, label, navigation.kind);
    count += 1;
  }

  const groups = new Map<string, Element>();
  for (const group of diagram.querySelectorAll(
    '.rackdown-device-group[data-device-id]',
  )) {
    const id = group.getAttribute('data-device-id');
    if (id) groups.set(id, group);
  }

  for (const device of devices) {
    const wikiLink = parseObsidianWikiLink(device.label);
    const group = groups.get(device.id);
    if (!wikiLink || !group) continue;

    const title = group.querySelector('title');
    if (title) title.textContent = wikiLink.display;
    const label = group.querySelector('.rackdown-device-label');
    if (label) label.textContent = wikiLink.display;

    group.classList.add('rackdown-device-link');
    decorateHostLink(group, wikiLink.target, wikiLink.display);
    count += 1;
  }

  return count;
}

function hostLinkElement(
  target: EventTarget | null,
  container: HTMLElement,
): Element | undefined {
  if (!(target instanceof Element)) {
    return undefined;
  }

  const link = target.closest(HOST_LINK_SELECTOR);
  return link && container.contains(link) ? link : undefined;
}

function hostLinkTarget(element: Element): string | undefined {
  const target = element.getAttribute('data-rackdown-target')?.trim();
  return target ? target : undefined;
}

function hostLinkAction(element: Element): 'internal' | 'external-url' {
  const action = element.getAttribute('data-rackdown-action');
  return action === 'external-url' ? 'external-url' : 'internal';
}

function openExternalUrl(element: Element, url: string): void {
  const win =
    (element as unknown as { win?: Window }).win ??
    element.ownerDocument?.defaultView ??
    window;
  win.open(url, '_blank', 'noopener');
}

export class RackDownHostLinks extends MarkdownRenderChild {
  constructor(
    containerEl: HTMLElement,
    private readonly plugin: RackDownPlugin,
    private readonly sourcePath: string,
  ) {
    super(containerEl);
  }

  private openLink(element: Element, target: string, newLeaf: boolean): void {
    const action = hostLinkAction(element);
    if (action === 'external-url') {
      openExternalUrl(element, target);
      return;
    }

    void this.plugin.app.workspace.openLinkText(
      target,
      this.sourcePath,
      newLeaf,
    );
  }

  private activateFrom(
    target: EventTarget | null,
    event: Event,
    newLeaf: boolean,
  ): void {
    const link = hostLinkElement(target, this.containerEl);
    const destination = link ? hostLinkTarget(link) : undefined;
    if (!link || !destination) {
      return;
    }

    event.preventDefault();
    this.openLink(link, destination, newLeaf);
  }

  override onload(): void {
    const activateMouseLink = (event: MouseEvent): void => {
      if (event.button !== 0 && event.button !== 1) {
        return;
      }

      this.activateFrom(
        event.target,
        event,
        event.button === 1 || Boolean(Keymap.isModEvent(event)),
      );
    };

    this.registerDomEvent(this.containerEl, 'click', activateMouseLink);
    this.registerDomEvent(this.containerEl, 'auxclick', activateMouseLink);

    this.registerDomEvent(this.containerEl, 'keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }

      this.activateFrom(event.target, event, Boolean(Keymap.isModEvent(event)));
    });
  }
}
