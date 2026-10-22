// Only the Obsidian lifecycle/DOM APIs needed by the local browser fixtures.
export class MarkdownRenderChild {
  constructor(containerEl) {
    this.containerEl = containerEl;
    this.children = [];
    this.cleanups = [];
    this.loaded = false;
  }
  load() {
    this.loaded = true;
    this.onload();
  }
  onload() {}
  onunload() {}
  addChild(child) {
    this.children.push(child);
    if (this.loaded) child.load();
    return child;
  }
  removeChild(child) {
    this.children.splice(this.children.indexOf(child), 1);
    child.unload();
    return child;
  }
  registerDomEvent(element, type, listener) {
    element.addEventListener(type, listener);
    this.cleanups.push(() => element.removeEventListener(type, listener));
  }
  unload() {
    this.onunload();
    for (const child of this.children.splice(0)) child.unload();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.loaded = false;
  }
}
export class Menu {}
export const Keymap = { isModEvent: () => false };

HTMLElement.prototype.createEl = function (tag, options = {}) {
  const element = document.createElement(tag);
  if (options.cls) element.className = options.cls;
  if (options.text) element.textContent = options.text;
  if (options.value) element.value = options.value;
  for (const [name, value] of Object.entries(options.attr ?? {}))
    element.setAttribute(name, value);
  this.append(element);
  return element;
};
HTMLElement.prototype.createDiv = function (options) {
  return this.createEl('div', options);
};
HTMLElement.prototype.createSpan = function (options) {
  return this.createEl('span', options);
};
