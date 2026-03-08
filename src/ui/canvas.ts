/**
 * PaintCanvas — the main drawing surface.
 * Renders splatmap as blended terrain textures (like Substance Painter).
 * Handles pointer events → BrushEngine.
 */

import { BrushEngine } from '../painting/brush.js';
import type { Splatmap } from '../painting/splatmap.js';
import type { TextureAtlas } from '../painting/textures.js';

export class PaintCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private brushCursor: HTMLElement;
  private engine: BrushEngine;
  private splatmap: Splatmap;
  private atlas: TextureAtlas | null = null;
  private rafId = 0;
  private needsRedraw = true;

  // Fallback channel colors (used only if atlas not ready)
  private channelColors: [number, number, number][] = [
    [220, 80, 60],    // R — warm red
    [80, 180, 80],    // G — forest green
    [60, 120, 220],   // B — sky blue
    [200, 180, 60],   // A — gold
  ];

  constructor(engine: BrushEngine) {
    this.engine = engine;
    this.splatmap = engine.getSplatmap();
    this.canvas = document.getElementById('paint-canvas') as HTMLCanvasElement;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
    this.brushCursor = document.getElementById('brush-cursor')!;

    this.resize();
    window.addEventListener('resize', () => this.resize());

    this.bindPointerEvents();
    this.startRenderLoop();
  }

  /** Set the texture atlas for material-blended rendering */
  setAtlas(atlas: TextureAtlas): void {
    console.log('[PaintCanvas] setAtlas called, layers:', atlas.layers.length,
      'layer0 size:', atlas.layers[0]?.data.length);
    this.atlas = atlas;
    this.needsRedraw = true;
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = this.canvas.clientWidth * dpr;
    this.canvas.height = this.canvas.clientHeight * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.needsRedraw = true;
  }

  private bindPointerEvents(): void {
    let isDown = false;

    this.canvas.addEventListener('pointerdown', (e) => {
      isDown = true;
      this.canvas.setPointerCapture(e.pointerId);
      const [sx, sy] = this.eventToSplatmap(e);
      this.engine.beginStroke(sx, sy);
      this.needsRedraw = true;
    });

    this.canvas.addEventListener('pointermove', (e) => {
      this.updateBrushCursor(e);
      if (!isDown) return;
      const [sx, sy] = this.eventToSplatmap(e);
      this.engine.continueStroke(sx, sy);
      this.needsRedraw = true;
    });

    const endStroke = () => {
      if (!isDown) return;
      isDown = false;
      this.engine.endStroke();
      this.needsRedraw = true;
    };

    this.canvas.addEventListener('pointerup', endStroke);
    this.canvas.addEventListener('pointercancel', endStroke);
    this.canvas.addEventListener('pointerleave', () => {
      this.brushCursor.style.display = 'none';
    });
    this.canvas.addEventListener('pointerenter', () => {
      this.brushCursor.style.display = 'block';
    });
  }

  private eventToSplatmap(e: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    return this.engine.canvasToSplatmap(cx, cy, rect.width, rect.height);
  }

  private updateBrushCursor(e: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    const radius = this.engine.currentSettings.radius;
    const screenRadius = (radius / this.splatmap.width) * rect.width;
    const size = screenRadius * 2;

    this.brushCursor.style.width = `${size}px`;
    this.brushCursor.style.height = `${size}px`;
    this.brushCursor.style.left = `${e.clientX - screenRadius}px`;
    this.brushCursor.style.top = `${e.clientY - screenRadius}px`;
    this.brushCursor.style.display = 'block';
  }

  private startRenderLoop(): void {
    const render = () => {
      this.rafId = requestAnimationFrame(render);
      if (!this.needsRedraw) return;
      this.needsRedraw = false;
      this.draw();
    };
    this.rafId = requestAnimationFrame(render);
  }

  private draw(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const splatData = this.splatmap.data;
    const sw = this.splatmap.width;
    const sh = this.splatmap.height;

    const img = this.ctx.createImageData(sw, sh);
    const out = img.data;

    const hasAtlas = !!(this.atlas && this.atlas.layers.length > 0);

    for (let i = 0; i < sw * sh; i++) {
      const si = i * 4;
      const di = i * 4;

      // Sum channel weights
      let totalWeight = 0;
      for (let c = 0; c < 4; c++) totalWeight += splatData[si + c];

      if (totalWeight > 0) {
        if (hasAtlas) {
          // Texture-blended rendering — sample each layer by weight
          this.blendTextures(out, di, splatData, si, i, totalWeight);
        } else {
          // Fallback: flat color blending
          this.blendColors(out, di, splatData, si);
        }
      } else {
        // Unpainted — subtle checkerboard
        const gx = (i % sw) >> 3;
        const gy = Math.floor(i / sw) >> 3;
        const checker = (gx + gy) & 1;
        out[di]     = checker ? 28 : 32;
        out[di + 1] = checker ? 28 : 32;
        out[di + 2] = checker ? 30 : 36;
        out[di + 3] = 255;
      }
    }

    // Scale splatmap to canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sw;
    tempCanvas.height = sh;
    tempCanvas.getContext('2d')!.putImageData(img, 0, 0);

    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(tempCanvas, 0, 0, w, h);
  }

  /** Blend terrain textures by splatmap weight at pixel index */
  private blendTextures(
    out: Uint8ClampedArray, di: number,
    splatData: Uint8ClampedArray, si: number,
    pixelIndex: number, totalWeight: number,
  ): void {
    let r = 0, g = 0, b = 0;
    const layers = this.atlas!.layers;
    const invTotal = 1 / totalWeight;

    for (let c = 0; c < Math.min(4, layers.length); c++) {
      const weight = splatData[si + c];
      if (weight === 0) continue;

      const norm = weight * invTotal;
      const texData = layers[c].data;
      const ti = pixelIndex * 4;

      r += texData[ti]     * norm;
      g += texData[ti + 1] * norm;
      b += texData[ti + 2] * norm;
    }

    out[di]     = Math.min(255, Math.round(r));
    out[di + 1] = Math.min(255, Math.round(g));
    out[di + 2] = Math.min(255, Math.round(b));
    out[di + 3] = 255;
  }

  /** Fallback: blend flat channel colors */
  private blendColors(
    out: Uint8ClampedArray, di: number,
    splatData: Uint8ClampedArray, si: number,
  ): void {
    let r = 30, g = 30, b = 34;
    for (let c = 0; c < 4; c++) {
      const weight = splatData[si + c] / 255;
      if (weight > 0) {
        const [cr, cg, cb] = this.channelColors[c];
        r += cr * weight;
        g += cg * weight;
        b += cb * weight;
      }
    }
    out[di]     = Math.min(255, Math.round(r));
    out[di + 1] = Math.min(255, Math.round(g));
    out[di + 2] = Math.min(255, Math.round(b));
    out[di + 3] = 255;
  }

  requestRedraw(): void {
    this.needsRedraw = true;
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
  }
}
