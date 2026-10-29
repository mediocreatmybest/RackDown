import type {
  LayoutConnectionEndpoint,
  LayoutDevice,
  LayoutNote,
  RackLayout,
} from '@rackdown/core';
import { type App, MarkdownRenderChild, Modal } from 'obsidian';

function noteHeadings(layout: RackLayout): Map<string, string> {
  const racks = new Map(layout.racks.map((rack) => [rack.id, rack]));
  const devices = new Map(layout.devices.map((device) => [device.id, device]));
  function position(rackId: string, face: string, units: number): string {
    const rack = racks.get(rackId);
    const namesakes = layout.racks.filter((item) => item.name === rack?.name);
    const name = rack?.name ?? rackId;
    const label =
      namesakes.length > 1
        ? `${name} (rack ${namesakes.findIndex((item) => item.id === rackId) + 1})`
        : name;
    return `${label} / ${face} / U${units}`;
  }
  function devicePosition(device: LayoutDevice): string {
    return position(device.rackId, device.mountFace, device.positionU);
  }
  function deviceLabel(device: LayoutDevice): string {
    const namesakes = layout.devices.filter(
      (item) =>
        item.label === device.label &&
        item.rackId === device.rackId &&
        item.mountFace === device.mountFace &&
        item.positionU === device.positionU,
    );
    return namesakes.length > 1
      ? `${device.label} (device ${namesakes.findIndex((item) => item.id === device.id) + 1})`
      : device.label;
  }
  function endpoint(endpoint: LayoutConnectionEndpoint): string {
    if (endpoint.kind === 'external') return endpoint.label;
    const device = devices.get(endpoint.deviceId);
    const label = device ? deviceLabel(device) : endpoint.deviceId;
    const port = endpoint.portName === undefined ? '' : `:${endpoint.portName}`;
    return `${label}${port}${device ? ` (${devicePosition(device)})` : ''}`;
  }

  const connectionLabels = layout.connections.map(
    (connection) => `${endpoint(connection.from)} — ${endpoint(connection.to)}`,
  );
  const totals = new Map<string, number>();
  for (const label of connectionLabels)
    totals.set(label, (totals.get(label) ?? 0) + 1);
  const ordinals = new Map<string, number>();
  const connections = new Map(
    layout.connections.map((connection, index) => {
      const label = connectionLabels[index] as string;
      const ordinal = (ordinals.get(label) ?? 0) + 1;
      ordinals.set(label, ordinal);
      return [
        connection.id,
        (totals.get(label) ?? 0) > 1
          ? `${label} (connection ${ordinal})`
          : label,
      ];
    }),
  );

  return new Map(
    (layout.notes ?? []).map((note) => {
      const target = note.target;
      let heading: string;
      if (target.kind === 'device') {
        const device = devices.get(target.deviceId);
        heading = device
          ? `${deviceLabel(device)} — ${devicePosition(device)}`
          : target.deviceId;
      } else if (target.kind === 'connection') {
        heading = connections.get(target.connectionId) ?? target.connectionId;
      } else {
        heading = position(target.rackId, target.mountFace, target.positionU);
      }
      return [note.id, heading];
    }),
  );
}

class RackDownNotesModal extends Modal {
  constructor(
    app: App,
    private readonly notes: readonly LayoutNote[],
    private readonly headings: ReadonlyMap<string, string>,
    private readonly onClosed: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle('RackDown notes');
    this.contentEl.classList.add('rackdown-notes');
    this.contentEl.createDiv({ text: 'All notes for this block.' });
    for (const note of this.notes) {
      const section = this.contentEl.createEl('section');
      section.createEl('h3', { text: this.headings.get(note.id) ?? '' });
      section.createEl('p', { text: note.text });
    }
  }

  override onClose(): void {
    this.contentEl.empty();
    this.onClosed();
  }
}

/** Owns the notes affordance and native modal for one rendered block. */
export class RackDownNotes extends MarkdownRenderChild {
  private button: HTMLButtonElement | undefined;
  private modal: RackDownNotesModal | undefined;

  constructor(
    containerEl: HTMLElement,
    private readonly app: App,
    private readonly controls: HTMLElement,
    private readonly layout: RackLayout,
    private readonly showNotesButton = true,
  ) {
    super(containerEl);
  }

  override onload(): void {
    const notes = this.layout.notes;
    if (!this.showNotesButton || !notes?.length) return;
    this.controls.classList.add('rackdown-notes-present');
    const button = this.controls.createEl('button', {
      cls: 'rackdown-notes-button',
      text: `Notes (${notes.length})`,
      type: 'button',
    });
    this.button = button;
    this.registerDomEvent(button, 'click', () => {
      if (this.modal) return;
      this.modal = new RackDownNotesModal(
        this.app,
        notes,
        noteHeadings(this.layout),
        () => {
          this.modal = undefined;
          if (button.isConnected) button.focus({ preventScroll: true });
        },
      );
      this.modal.open();
    });
  }

  override onunload(): void {
    this.button?.remove();
    this.button = undefined;
    this.controls.classList.remove('rackdown-notes-present');
    this.modal?.close();
    this.modal = undefined;
  }
}
