import { vi } from 'vitest';

/** Small event/element doubles; these do not simulate Obsidian rendering. */
export class TestElement extends EventTarget {
  readonly attributes = new Map<string, string>();
  readonly classes = new Set<string>();
  readonly classList = {
    add: (name: string) => this.classes.add(name),
    remove: (name: string) => this.classes.delete(name),
    contains: (name: string) => this.classes.has(name),
  };
  readonly children: TestElement[] = [];
  readonly style = {
    properties: new Map<string, string>(),
    setProperty: (key: string, value: string) =>
      this.style.properties.set(key, value),
    getPropertyValue: (key: string) => this.style.properties.get(key) ?? '',
    removeProperty: (key: string) => this.style.properties.delete(key),
  };
  parentElement: TestElement | undefined;
  textContent = '';
  innerHTML = '';
  hidden = false;
  focus = vi.fn();
  ownerDocument = { defaultView: { open: vi.fn() } };

  constructor(
    readonly tag = 'div',
    cls = '',
  ) {
    super();
    for (const name of cls.split(' ').filter(Boolean)) this.classes.add(name);
  }

  instanceOf(type: typeof TestElement): boolean {
    return this instanceof type;
  }
  setAttribute(key: string, value: string): void {
    if (key === 'class') {
      this.classes.clear();
      for (const name of value.split(' ')) this.classes.add(name);
    }
    this.attributes.set(key, value);
  }
  removeAttribute(key: string): void {
    this.attributes.delete(key);
  }
  cloneNode(): TestElement {
    const clone = new TestElement(this.tag, [...this.classes].join(' '));
    for (const [key, value] of this.attributes) clone.setAttribute(key, value);
    return clone;
  }
  before(child: TestElement): void {
    child.parentElement = this.parentElement;
    this.parentElement?.children.splice(
      this.parentElement.children.indexOf(this),
      0,
      child,
    );
  }
  getAttribute(key: string): string | null {
    return this.attributes.get(key) ?? null;
  }
  appendText(text: string): void {
    this.textContent += text;
  }
  append(child: TestElement): TestElement {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }
  contains(child: TestElement): boolean {
    return this === child || this.children.some((node) => node.contains(child));
  }
  matches(selector: string): boolean {
    const match = /^(?:\.([\w-]+)|([\w-]+))(?:\[([\w-]+)\])?$/.exec(selector);
    if (!match) throw new Error(`Unsupported test selector: ${selector}`);
    return (
      (match[1] ? this.classes.has(match[1]) : this.tag === match[2]) &&
      (!match[3] || this.attributes.has(match[3]))
    );
  }
  closest(selector: string): TestElement | undefined {
    return this.matches(selector)
      ? this
      : this.parentElement?.closest(selector);
  }
  querySelectorAll(selector: string): TestElement[] {
    return this.children.flatMap((child) => [
      ...(child.matches(selector) ? [child] : []),
      ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector: string): TestElement | undefined {
    return this.querySelectorAll(selector)[0];
  }
  createEl(
    tag: string,
    options: {
      cls?: string;
      text?: string;
      type?: string;
      attr?: Record<string, string>;
    } = {},
  ): TestElement {
    const child = this.append(new TestElement(tag, options.cls));
    child.textContent = options.text ?? '';
    for (const [key, value] of Object.entries(options.attr ?? {}))
      child.setAttribute(key, value);
    if (options.type) child.setAttribute('type', options.type);
    return child;
  }
  createDiv(options = {}): TestElement {
    return this.createEl('div', options);
  }
  createSpan(options = {}): TestElement {
    return this.createEl('span', options);
  }
  remove(): void {
    const siblings = this.parentElement?.children;
    siblings?.splice(siblings.indexOf(this), 1);
  }
  empty(): void {
    this.children.length = 0;
  }
  getBoundingClientRect(): {
    left: number;
    top: number;
    width: number;
    height: number;
  } {
    return { left: 10, top: 20, width: 100, height: 50 };
  }
  asHtml(): HTMLElement {
    return this as unknown as HTMLElement;
  }
}

export function fire(
  container: TestElement,
  type: string,
  target: TestElement,
  properties: Record<string, unknown> = {},
): Event {
  const event = new Event(type, { cancelable: true });
  Object.defineProperties(
    event,
    Object.fromEntries(
      Object.entries({
        target,
        targetNode: target,
        button: 0,
        ...properties,
      }).map(([key, value]) => [key, { value }]),
    ),
  );
  container.dispatchEvent(event);
  return event;
}

export class TestRenderChild {
  private cleanups: (() => void)[] = [];
  constructor(readonly containerEl: HTMLElement) {}
  registerDomEvent(
    element: EventTarget,
    type: string,
    listener: EventListener,
  ): void {
    element.addEventListener(type, listener);
    this.cleanups.push(() => element.removeEventListener(type, listener));
  }
  unload(): void {
    this.onunload();
    for (const cleanup of this.cleanups) cleanup();
  }
  onunload(): void {}
}

export class TestMenu {
  static latest: TestMenu;
  title = '';
  action: (() => void) | undefined;
  hide = vi.fn();
  showAtMouseEvent = vi.fn();
  showAtPosition = vi.fn();
  constructor() {
    TestMenu.latest = this;
  }
  addItem(
    callback: (item: {
      setTitle: (title: string) => { onClick: (action: () => void) => void };
    }) => void,
  ): void {
    callback({
      setTitle: (title) => {
        this.title = title;
        return {
          onClick: (action) => {
            this.action = action;
          },
        };
      },
    });
  }
}
