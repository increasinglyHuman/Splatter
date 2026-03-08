/**
 * Toolbar — left-edge tool selector.
 * Stealth: fades to 15% opacity when idle, full on hover.
 */

import type { BrushTool } from '../painting/brush.js';

export interface ToolbarCallbacks {
  onToolChange: (tool: BrushTool) => void;
  onUndo: () => void;
  onRedo: () => void;
}

const TOOLS: { id: BrushTool; icon: string; title: string }[] = [
  { id: 'paint', icon: '🖌', title: 'Paint (P)' },
  { id: 'erase', icon: '◻', title: 'Erase (E)' },
  { id: 'smear', icon: '☰', title: 'Smear (S)' },
];

export class Toolbar {
  private el: HTMLElement;
  private selected: BrushTool = 'paint';
  private buttons = new Map<BrushTool, HTMLButtonElement>();

  constructor(callbacks: ToolbarCallbacks) {
    this.el = document.getElementById('toolbar')!;
    this.el.innerHTML = '';

    for (const tool of TOOLS) {
      const btn = document.createElement('button');
      btn.className = 'tool-btn' + (tool.id === this.selected ? ' selected' : '');
      btn.textContent = tool.icon;
      btn.title = tool.title;
      btn.addEventListener('click', () => {
        this.select(tool.id);
        callbacks.onToolChange(tool.id);
      });
      this.buttons.set(tool.id, btn);
      this.el.appendChild(btn);
    }

    // Separator
    const sep = document.createElement('div');
    sep.className = 'tool-separator';
    this.el.appendChild(sep);

    // Undo/Redo
    const undoBtn = document.createElement('button');
    undoBtn.className = 'tool-btn';
    undoBtn.textContent = '↩';
    undoBtn.title = 'Undo (Ctrl+Z)';
    undoBtn.addEventListener('click', callbacks.onUndo);
    this.el.appendChild(undoBtn);

    const redoBtn = document.createElement('button');
    redoBtn.className = 'tool-btn';
    redoBtn.textContent = '↪';
    redoBtn.title = 'Redo (Ctrl+Shift+Z)';
    redoBtn.addEventListener('click', callbacks.onRedo);
    this.el.appendChild(redoBtn);
  }

  select(tool: BrushTool): void {
    this.selected = tool;
    for (const [id, btn] of this.buttons) {
      btn.classList.toggle('selected', id === tool);
    }
  }

  /** Flash toolbar visible briefly */
  flash(): void {
    this.el.classList.add('active');
    setTimeout(() => this.el.classList.remove('active'), 2000);
  }
}
