import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestElement } from './host-test-support.js';
import { calculateViewportSize, RackDownViewport } from './viewport.js';

vi.mock('obsidian', async () => {
  const { TestRenderChild } = await import('./host-test-support.js');
  return { MarkdownRenderChild: TestRenderChild };
});

const rack = { x: 0, y: 0, width: 500, height: 2000 };
const box = { x: -100, y: -50, width: 800, height: 2200 };

describe('viewport geometry', () => {
  it('scales the full viewport uniformly using rack width, capped at nominal size', () => {
    expect(calculateViewportSize(box, [rack], 250)).toEqual({
      width: 400,
      height: 1100,
      initialScrollLeft: 50,
    });
    expect(calculateViewportSize(box, [rack], 1000)).toEqual({
      width: 800,
      height: 2200,
      initialScrollLeft: 0,
    });
    expect(calculateViewportSize({ ...box, width: 1600 }, [rack], 250)).toEqual(
      { width: 800, height: 1100, initialScrollLeft: 50 },
    );
  });

  it('fits the union of projected racks including their gap and nonzero origins', () => {
    const racks = [
      { ...rack, x: -100 },
      { ...rack, x: 500 },
    ];
    expect(calculateViewportSize({ ...box, width: 1400 }, racks, 550)).toEqual({
      width: 700,
      height: 1100,
      initialScrollLeft: 0,
    });
  });

  it('keeps empty diagrams readable and ignores malformed rack geometry', () => {
    expect(calculateViewportSize(box, [], 400)).toEqual({
      width: 400,
      height: 1100,
      initialScrollLeft: 0,
    });
    expect(
      calculateViewportSize(box, [{ ...rack, width: NaN }, rack], 250),
    ).toEqual({ width: 400, height: 1100, initialScrollLeft: 50 });
    expect(calculateViewportSize({ ...box, height: 0 }, [], 100)).toEqual({
      width: 100,
      height: 50,
      initialScrollLeft: 0,
    });
    for (const width of [0, -1, NaN, Infinity]) {
      expect(calculateViewportSize(box, [rack], width)).toEqual({
        width: 800,
        height: 2200,
        initialScrollLeft: 0,
      });
    }
  });
});

describe('viewport lifecycle', () => {
  let callback: ResizeObserverCallback;
  let observe: ReturnType<typeof vi.fn>;
  let disconnect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    observe = vi.fn();
    disconnect = vi.fn();
  });

  function fixture(width = 250) {
    const diagram = new TestElement();
    diagram.clientWidth = width;
    Object.assign(diagram.ownerDocument.defaultView, {
      ResizeObserver: class {
        constructor(cb: ResizeObserverCallback) {
          callback = cb;
        }
        observe = observe;
        disconnect = disconnect;
      },
    });
    const viewport = new RackDownViewport(diagram.asHtml());
    viewport.load();
    const svg = diagram.createEl('svg', {
      attr: { viewBox: '-100 -50 800 2200' },
    });
    svg.createEl('rect', {
      cls: 'rackdown-rack',
      attr: { x: '0', y: '0', width: '500', height: '2000' },
    });
    viewport.setSvg(svg as unknown as SVGSVGElement);
    const resize = (width: number, height = 500) =>
      callback(
        [
          {
            target: diagram.asHtml(),
            contentRect: { width, height },
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    return { diagram, viewport, svg, resize };
  }

  it('resizes cached geometry for pane changes without replacing SVG nodes', () => {
    const { diagram, viewport, svg, resize } = fixture();
    expect(observe).toHaveBeenCalledWith(diagram);
    expect(svg.style.getPropertyValue('width')).toBe('400px');
    resize(400);
    expect(svg.style.getPropertyValue('width')).toBe('640px');
    expect(svg.style.getPropertyValue('height')).toBe('1760px');
    expect(diagram.querySelector('svg')).toBe(svg);
    const write = vi.spyOn(svg.style, 'setProperty');
    resize(400, 600);
    expect(write).not.toHaveBeenCalled();
    viewport.unload();
    expect(disconnect).toHaveBeenCalledOnce();
    resize(100);
    expect(write).not.toHaveBeenCalled();
  });

  it('recovers when a hidden preview becomes visible and ignores temporary zero width', () => {
    const { svg, resize, viewport } = fixture(0);
    expect(svg.style.getPropertyValue('width')).toBe('800px');
    resize(250);
    expect(svg.style.getPropertyValue('width')).toBe('400px');
    resize(0);
    expect(svg.style.getPropertyValue('width')).toBe('400px');
    viewport.unload();
  });

  it('starts on the rack even when routing creates a wide left margin', () => {
    const { viewport, diagram, svg, resize } = fixture(0);
    svg.setAttribute('viewBox', '-700 -50 1300 2200');
    viewport.setSvg(svg as unknown as SVGSVGElement);
    resize(250);
    // Rack starts at 700 SVG units; at half scale, scroll past the 350px route margin.
    expect(diagram.asHtml().scrollLeft).toBe(350);
    diagram.scrollLeft = 100;
    resize(1000);
    expect(diagram.scrollLeft).toBe(100);
    viewport.setSvg(svg as unknown as SVGSVGElement);
    expect(diagram.scrollLeft).toBe(100);
    viewport.unload();
  });

  it('uses the current width for replacement SVGs and makes the scroll area keyboard accessible', () => {
    const { diagram, svg, viewport, resize } = fixture();
    expect(diagram.getAttribute('tabindex')).toBe('0');
    expect(diagram.getAttribute('role')).toBe('region');
    expect(diagram.getAttribute('aria-label')).toContain('scroll');
    resize(400);
    const replacement = svg.cloneNode();
    replacement.append(svg.children[0]?.cloneNode() as TestElement);
    viewport.setSvg(replacement as unknown as SVGSVGElement);
    expect(replacement.style.getPropertyValue('width')).toBe('640px');
    resize(250);
    expect(replacement.style.getPropertyValue('width')).toBe('400px');
    expect(svg.style.getPropertyValue('width')).toBe('640px');
    viewport.unload();
  });

  it('handles absent SVG and missing geometry without throwing or collapsing', () => {
    const { viewport, resize } = fixture();
    viewport.setSvg(undefined);
    expect(() => resize(200)).not.toThrow();
    const svg = new TestElement('svg');
    viewport.setSvg(svg as unknown as SVGSVGElement);
    expect(svg.style.getPropertyValue('width')).toBe('200px');
    expect(svg.style.getPropertyValue('height')).toBe('100px');
    viewport.unload();
  });
});
