/**
 * PaintCanvas — the main drawing surface.
 * Renders the splatmap onto a 2D canvas with per-channel color preview.
 * Handles pointer events → BrushEngine.
 */

import { BrushEngine } from '../painting/brush.js';
import type { Splatmap } from '../painting/splatmap.js';

export class PaintCanvas {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private brushCursor: HTMLElement;
  private engine: BrushEngine;
  private splatmap: Splatmap;
  private rafId = 0;
  private needsRedraw = true;

  // Channel preview colors (vibrant, visible on dark background)
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
    // Scale radius from splatmap space to screen space
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
    const data = this.splatmap.data;
    const sw = this.splatmap.width;
    const sh = this.splatmap.height;

    // Create a display image — composite channel colors
    const img = this.ctx.createImageData(sw, sh);
    const out = img.data;

    for (let i = 0; i < sw * sh; i++) {
      const si = i * 4;
      const di = i * 4;

      // Blend channel colors by weight
      let r = 30, g = 30, b = 34; // base: canvas bg color
      let totalWeight = 0;

      for (let c = 0; c < 4; c++) {
        const weight = data[si + c] / 255;
        if (weight > 0) {
          const [cr, cg, cb] = this.channelColors[c];
          r += cr * weight;
          g += cg * weight;
          b += cb * weight;
          totalWeight += weight;
        }
      }

      if (totalWeight > 0) {
        out[di]     = Math.min(255, Math.round(r));
        out[di + 1] = Math.min(255, Math.round(g));
        out[di + 2] = Math.min(255, Math.round(b));
        out[di + 3] = 255;
      } else {
        // Transparent — show grid pattern
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

  requestRedraw(): void {
    this.needsRedraw = true;
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
  }
}
