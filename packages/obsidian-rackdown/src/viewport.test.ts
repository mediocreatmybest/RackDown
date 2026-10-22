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

  function fixture(width = 250, rendered = true) {
    const diagram = new TestElement();
    let contentWidth = width;
    diagram.clientWidth = Math.round(width);
    vi.spyOn(diagram, 'getBoundingClientRect').mockImplementation(() => ({
      left: 0,
      top: 0,
      width: rendered ? contentWidth : 0,
      height: rendered ? 500 : 0,
    }));
    Object.assign(diagram.ownerDocument.defaultView, {
      getComputedStyle: () => ({
        width: `${contentWidth}px`,
      }),
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
    const resize = (width: number, height = 500, liveWidth = width) => {
      contentWidth = liveWidth;
      diagram.clientWidth = Math.round(liveWidth);
      callback(
        [
          {
            target: diagram.asHtml(),
            contentRect: { width, height },
          } as unknown as ResizeObserverEntry,
        ],
        {} as ResizeObserver,
      );
    };
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
    expect(diagram.children).toEqual([svg]);
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

  it.each([0.25, 0.49, 0.75, 235.25, 235.75])(
    'uses fractional content width %s consistently before and after observation',
    (width) => {
      const { svg, viewport, resize } = fixture(width);
      expect(
        Number.parseFloat(svg.style.getPropertyValue('width')),
      ).toBeCloseTo(width * 1.6);
      const write = vi.spyOn(svg.style, 'setProperty');
      resize(width);
      expect(write).not.toHaveBeenCalled();
      viewport.unload();
    },
  );

  it('skips probing a non-rendered container even if its resolved width is positive', () => {
    const { diagram, svg, resize, viewport } = fixture(250, false);
    expect(svg.style.getPropertyValue('width')).toBe('800px');
    expect(diagram.scrollLeft).toBe(0);
    resize(400);
    expect(svg.style.getPropertyValue('width')).toBe('800px');
    expect(diagram.children).toEqual([svg]);
    viewport.unload();
  });

  it('recovers from zero width into a visible subpixel pane and preserves later scrolling', () => {
    const { diagram, svg, resize, viewport } = fixture(0);
    resize(0.25);
    expect(Number.parseFloat(svg.style.getPropertyValue('width'))).toBeCloseTo(
      0.4,
    );
    expect(Number.parseFloat(svg.style.getPropertyValue('height'))).toBeCloseTo(
      1.1,
    );
    diagram.scrollLeft = 0.1;
    resize(0);
    expect(Number.parseFloat(svg.style.getPropertyValue('width'))).toBeCloseTo(
      0.4,
    );
    resize(250);
    expect(svg.style.getPropertyValue('width')).toBe('400px');
    expect(diagram.scrollLeft).toBe(0.1);
    viewport.unload();
  });

  it('uses the live gutter width when an observer entry predates scrollbar changes', () => {
    const { svg, diagram, resize, viewport } = fixture(250.75);
    diagram.scrollLeft = 25;
    resize(250.75, 500, 235.75);
    expect(Number.parseFloat(svg.style.getPropertyValue('width'))).toBeCloseTo(
      377.2,
    );
    expect(Number.parseFloat(svg.style.getPropertyValue('height'))).toBeCloseTo(
      1037.3,
    );
    expect(diagram.scrollLeft).toBe(25);
    resize(235.75, 100, 250.75);
    expect(Number.parseFloat(svg.style.getPropertyValue('width'))).toBeCloseTo(
      401.2,
    );
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
