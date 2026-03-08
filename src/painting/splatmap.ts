/**
 * Splatmap — the rasterized RGBA paint buffer.
 * Each channel stores a blend weight (0–255) for one texture.
 * Four channels = four materials per splatmap (Phase 1).
 */

import type { SplatChannelLayout, Layer6Data } from '../types/index.js';

export class Splatmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8ClampedArray;
  readonly channelLayout: SplatChannelLayout;

  private dirty = false;
  private dirtyBounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };

  constructor(width: number, height: number, channelLayout: SplatChannelLayout) {
    this.width = width;
    this.height = height;
    this.channelLayout = channelLayout;
    // Initialize transparent (all zeros = no paint)
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  /** Load from an existing ImageData (e.g., from a URL) */
  static fromImageData(img: ImageData, channelLayout: SplatChannelLayout): Splatmap {
    const s = new Splatmap(img.width, img.height, channelLayout);
    s.data.set(img.data);
    return s;
  }

  /** Paint at (x, y) with given channel strengths and opacity */
  paint(cx: number, cy: number, radius: number, channel: 0 | 1 | 2 | 3, opacity: number): void {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > r2) continue;

        // Smooth falloff from center
        const t = 1 - Math.sqrt(dist2) / radius;
        const strength = t * t * opacity; // quadratic falloff

        const idx = (y * this.width + x) * 4;
        this.applyWeight(idx, channel, strength);
      }
    }

    // Expand dirty bounds
    this.dirtyBounds.x0 = Math.min(this.dirtyBounds.x0, x0);
    this.dirtyBounds.y0 = Math.min(this.dirtyBounds.y0, y0);
    this.dirtyBounds.x1 = Math.max(this.dirtyBounds.x1, x1);
    this.dirtyBounds.y1 = Math.max(this.dirtyBounds.y1, y1);
    this.dirty = true;
  }

  /** Erase at (x, y) — reduces all channels toward zero */
  erase(cx: number, cy: number, radius: number, opacity: number): void {
    const r2 = radius * radius;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > r2) continue;

        const t = 1 - Math.sqrt(dist2) / radius;
        const strength = t * t * opacity;

        const idx = (y * this.width + x) * 4;
        for (let c = 0; c < 4; c++) {
          this.data[idx + c] = Math.round(this.data[idx + c] * (1 - strength));
        }
      }
    }

    this.dirtyBounds.x0 = Math.min(this.dirtyBounds.x0, x0);
    this.dirtyBounds.y0 = Math.min(this.dirtyBounds.y0, y0);
    this.dirtyBounds.x1 = Math.max(this.dirtyBounds.x1, x1);
    this.dirtyBounds.y1 = Math.max(this.dirtyBounds.y1, y1);
    this.dirty = true;
  }

  /** Smear — pull color from source toward destination */
  smear(fromX: number, fromY: number, toX: number, toY: number, radius: number, opacity: number): void {
    // Sample source color
    const si = (Math.round(fromY) * this.width + Math.round(fromX)) * 4;
    if (si < 0 || si >= this.data.length - 3) return;

    const srcR = this.data[si];
    const srcG = this.data[si + 1];
    const srcB = this.data[si + 2];
    const srcA = this.data[si + 3];

    const r2 = radius * radius;
    const cx = toX, cy = toY;
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(this.width - 1, Math.ceil(cx + radius));
    const y1 = Math.min(this.height - 1, Math.ceil(cy + radius));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const dist2 = dx * dx + dy * dy;
        if (dist2 > r2) continue;

        const t = 1 - Math.sqrt(dist2) / radius;
        const strength = t * t * opacity * 0.5; // gentler than paint

        const idx = (y * this.width + x) * 4;
        this.data[idx]     = Math.round(this.data[idx]     + (srcR - this.data[idx])     * strength);
        this.data[idx + 1] = Math.round(this.data[idx + 1] + (srcG - this.data[idx + 1]) * strength);
        this.data[idx + 2] = Math.round(this.data[idx + 2] + (srcB - this.data[idx + 2]) * strength);
        this.data[idx + 3] = Math.round(this.data[idx + 3] + (srcA - this.data[idx + 3]) * strength);
      }
    }

    this.dirtyBounds.x0 = Math.min(this.dirtyBounds.x0, x0);
    this.dirtyBounds.y0 = Math.min(this.dirtyBounds.y0, y0);
    this.dirtyBounds.x1 = Math.max(this.dirtyBounds.x1, x1);
    this.dirtyBounds.y1 = Math.max(this.dirtyBounds.y1, y1);
    this.dirty = true;
  }

  /** Apply weight for a channel, normalizing so all channels sum to 255 */
  private applyWeight(idx: number, channel: 0 | 1 | 2 | 3, strength: number): void {
    // Increase target channel
    const added = Math.round(255 * strength);
    const newVal = Math.min(255, this.data[idx + channel] + added);
    this.data[idx + channel] = newVal;

    // Normalize: reduce other channels proportionally so sum ≤ 255
    let total = 0;
    for (let c = 0; c < 4; c++) total += this.data[idx + c];
    if (total > 255) {
      const scale = 255 / total;
      for (let c = 0; c < 4; c++) {
        this.data[idx + c] = Math.round(this.data[idx + c] * scale);
      }
    }
  }

  isDirty(): boolean {
    return this.dirty;
  }

  clearDirty(): void {
    this.dirty = false;
    this.dirtyBounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  }

  /** Approximate area modified in texels² */
  getDirtyArea(): number {
    if (!this.dirty) return 0;
    const w = this.dirtyBounds.x1 - this.dirtyBounds.x0;
    const h = this.dirtyBounds.y1 - this.dirtyBounds.y0;
    return Math.max(0, w * h);
  }

  /** Export as ImageData for canvas rendering */
  toImageData(): ImageData {
    return new ImageData(new Uint8ClampedArray(this.data), this.width, this.height);
  }

  /** Export as data URL for Layer6Data */
  toDataUrl(): string {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(this.toImageData(), 0, 0);
    return canvas.toDataURL('image/png');
  }

  /** Build the Layer6Data object for the protocol */
  toLayer6Data(): Layer6Data {
    return {
      version: '1.0',
      resolution: this.width,
      blendMode: 'overlay',
      splatmap: {
        url: this.toDataUrl(),
        channelLayout: this.channelLayout,
      },
    };
  }
}
