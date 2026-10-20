import { MarkdownRenderChild } from 'obsidian';

interface Rectangle {
  x: number;
  y: number;
  width: number;
  height: number;
}

function validRectangle(rect: Rectangle): boolean {
  return (
    Object.values(rect).every(Number.isFinite) &&
    rect.width > 0 &&
    rect.height > 0 &&
    Number.isFinite(rect.x + rect.width) &&
    Number.isFinite(rect.y + rect.height)
  );
}

/** One CSS pixel per SVG unit is nominal, matching core's pixel export mode. */
export function calculateViewportSize(
  viewBox: Rectangle,
  racks: readonly Rectangle[],
  availableWidth: number,
): { width: number; height: number; initialScrollLeft: number } {
  const box = validRectangle(viewBox)
    ? viewBox
    : { x: 0, y: 0, width: 300, height: 150 };
  const validRacks = racks.filter(validRectangle);
  const rackWidth = validRacks.length
    ? Math.max(...validRacks.map((rack) => rack.x + rack.width)) -
      Math.min(...validRacks.map((rack) => rack.x))
    : box.width;
  const scale =
    Number.isFinite(availableWidth) && availableWidth > 0
      ? Math.min(1, availableWidth / rackWidth)
      : 1;
  const rackLeft = validRacks.length
    ? Math.min(...validRacks.map((rack) => rack.x))
    : box.x;
  const initialScrollLeft =
    Number.isFinite(availableWidth) && availableWidth > 0
      ? Math.max(
          0,
          Math.min(
            box.width * scale - availableWidth,
            (rackLeft - box.x) * scale -
              (availableWidth - rackWidth * scale) / 2,
          ),
        )
      : 0;
  return {
    width: box.width * scale,
    height: box.height * scale,
    initialScrollLeft,
  };
}

/** Owns sizing only; category replacement and resizing never reparse the source. */
export class RackDownViewport extends MarkdownRenderChild {
  private observer: ResizeObserver | undefined;
  private svg: SVGSVGElement | undefined;
  private viewBox: Rectangle = { x: 0, y: 0, width: 300, height: 150 };
  private racks: Rectangle[] = [];
  private availableWidth = 0;
  private positioned = false;

  override onload(): void {
    this.containerEl.setAttribute('tabindex', '0');
    this.containerEl.setAttribute('role', 'region');
    this.containerEl.setAttribute(
      'aria-label',
      'Rack diagram, scroll to explore',
    );
    this.availableWidth = this.containerEl.clientWidth;
    // Use the owning window so detached Obsidian panes have the correct realm.
    const Observer = this.containerEl.ownerDocument.defaultView?.ResizeObserver;
    if (Observer) {
      this.observer = new Observer((entries) => {
        const entry = entries.find(({ target }) => target === this.containerEl);
        const width = entry?.contentRect.width;
        if (width === undefined || width <= 0 || width === this.availableWidth)
          return;
        this.availableWidth = width;
        this.applySize();
      });
      this.observer.observe(this.containerEl);
    }
  }

  setSvg(svg: SVGSVGElement | undefined): void {
    this.svg = svg;
    if (!svg) return;
    const [x = 0, y = 0, width = 0, height = 0] = (
      svg.getAttribute('viewBox') ?? ''
    )
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    this.viewBox = { x, y, width, height };
    // Core emits these rectangles directly in viewBox coordinates, without transforms.
    this.racks = Array.from(svg.querySelectorAll('.rackdown-rack'), (rack) => ({
      x: Number(rack.getAttribute('x')),
      y: Number(rack.getAttribute('y')),
      width: Number(rack.getAttribute('width')),
      height: Number(rack.getAttribute('height')),
    }));
    this.applySize();
  }

  private applySize(): void {
    if (!this.svg) return;
    const size = calculateViewportSize(
      this.viewBox,
      this.racks,
      this.availableWidth,
    );
    this.svg.style.setProperty('width', `${size.width}px`);
    this.svg.style.setProperty('height', `${size.height}px`);
    // A large routing margin must not be the initial subject of the diagram.
    // Do this once when visible; later filtering/resizing must not reset user scrolling.
    if (!this.positioned && this.availableWidth > 0) {
      this.containerEl.scrollLeft = size.initialScrollLeft;
      this.positioned = true;
    }
  }

  override onunload(): void {
    this.observer?.disconnect();
    this.observer = undefined;
    this.svg = undefined;
    this.racks = [];
    this.positioned = false;
  }
}
