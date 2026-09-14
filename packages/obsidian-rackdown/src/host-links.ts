import { Keymap, MarkdownRenderChild } from 'obsidian';
import type RackDownPlugin from './main.js';

const HOST_LINK_SELECTOR = '.rackdown-host-link[data-rackdown-target]';

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
