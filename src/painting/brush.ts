/**
 * Brush engine — Tier 1 tools.
 * Handles mouse/touch input → splatmap operations.
 */

import { Splatmap } from './splatmap.js';
import { UndoStack } from './undo.js';

export type BrushTool = 'paint' | 'erase' | 'smear';

export interface BrushSettings {
  tool: BrushTool;
  radius: number;          // in splatmap texels
  opacity: number;          // 0–1
  activeChannel: 0 | 1 | 2 | 3;
}

export class BrushEngine {
  private splatmap: Splatmap;
  private undo: UndoStack;
  private settings: BrushSettings;
  private painting = false;
  private lastX = 0;
  private lastY = 0;
  private strokeCount = 0;
  private materialsUsed = new Set<string>();

  onDirtyChange?: (dirty: boolean) => void;

  constructor(splatmap: Splatmap, undo: UndoStack) {
    this.splatmap = splatmap;
    this.undo = undo;
    this.settings = {
      tool: 'paint',
      radius: 16,
      opacity: 0.6,
      activeChannel: 0,
    };
    // Push initial state
    this.undo.push(splatmap.data);
  }

  get currentSettings(): Readonly<BrushSettings> {
    return this.settings;
  }

  setTool(tool: BrushTool): void {
    this.settings.tool = tool;
  }

  setRadius(r: number): void {
    this.settings.radius = Math.max(1, Math.min(128, r));
  }

  setOpacity(o: number): void {
    this.settings.opacity = Math.max(0, Math.min(1, o));
  }

  setActiveChannel(ch: 0 | 1 | 2 | 3): void {
    this.settings.activeChannel = ch;
    // Track which material is used
    const layout = this.splatmap.channelLayout;
    const ids = [layout.r, layout.g, layout.b, layout.a];
    this.materialsUsed.add(ids[ch]);
  }

  /** Convert canvas coordinates to splatmap coordinates */
  canvasToSplatmap(canvasX: number, canvasY: number, canvasWidth: number, canvasHeight: number): [number, number] {
    return [
      (canvasX / canvasWidth) * this.splatmap.width,
      (canvasY / canvasHeight) * this.splatmap.height,
    ];
  }

  beginStroke(sx: number, sy: number): void {
    this.painting = true;
    this.lastX = sx;
    this.lastY = sy;
    this.applyAt(sx, sy);
  }

  continueStroke(sx: number, sy: number): void {
    if (!this.painting) return;

    // Interpolate between last and current position for smooth strokes
    const dx = sx - this.lastX;
    const dy = sy - this.lastY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const step = Math.max(1, this.settings.radius * 0.3);

    if (dist > step) {
      const steps = Math.ceil(dist / step);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        this.applyAt(this.lastX + dx * t, this.lastY + dy * t);
      }
    } else {
      this.applyAt(sx, sy);
    }

    this.lastX = sx;
    this.lastY = sy;
  }

  endStroke(): void {
    if (!this.painting) return;
    this.painting = false;
    this.strokeCount++;
    // Snapshot for undo
    this.undo.push(this.splatmap.data);
    this.onDirtyChange?.(true);
  }

  private applyAt(sx: number, sy: number): void {
    const { tool, radius, opacity, activeChannel } = this.settings;

    switch (tool) {
      case 'paint':
        this.splatmap.paint(sx, sy, radius, activeChannel, opacity);
        break;
      case 'erase':
        this.splatmap.erase(sx, sy, radius, opacity);
        break;
      case 'smear':
        this.splatmap.smear(this.lastX, this.lastY, sx, sy, radius, opacity);
        break;
    }
  }

  performUndo(): boolean {
    const snapshot = this.undo.undo();
    if (!snapshot) return false;
    this.splatmap.data.set(snapshot);
    this.onDirtyChange?.(true);
    return true;
  }

  performRedo(): boolean {
    const snapshot = this.undo.redo();
    if (!snapshot) return false;
    this.splatmap.data.set(snapshot);
    this.onDirtyChange?.(true);
    return true;
  }

  getStrokeCount(): number {
    return this.strokeCount;
  }

  getMaterialsUsed(): string[] {
    return [...this.materialsUsed];
  }

  getSplatmap(): Splatmap {
    return this.splatmap;
  }
}
