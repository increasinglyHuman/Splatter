/**
 * TextureAtlas — loads or generates terrain textures for canvas preview.
 * When real texture URLs are available (hosted mode), loads those.
 * When not (standalone), generates procedural textures from previewColor.
 *
 * Each texture is stored as tiled pixel data at splatmap resolution,
 * so the canvas renderer can sample per-pixel during blending.
 */

import type { TextureCatalogEntry } from '../types/index.js';

/** RGBA pixel data for one texture, tiled to splatmap dimensions */
export interface TextureLayer {
  data: Uint8ClampedArray;  // RGBA, width × height × 4
  width: number;
  height: number;
}

export class TextureAtlas {
  /** One TextureLayer per splatmap channel (4 max) */
  readonly layers: TextureLayer[] = [];
  readonly ready: Promise<void>;

  constructor(entries: TextureCatalogEntry[], splatWidth: number, splatHeight: number) {
    this.ready = this.build(entries, splatWidth, splatHeight);
  }

  private async build(entries: TextureCatalogEntry[], w: number, h: number): Promise<void> {
    const promises = entries.slice(0, 4).map((entry) =>
      this.loadOrGenerate(entry, w, h)
    );
    const results = await Promise.all(promises);
    this.layers.push(...results);
  }

  private async loadOrGenerate(
    entry: TextureCatalogEntry, w: number, h: number,
  ): Promise<TextureLayer> {
    // Try loading real texture first
    if (entry.previewUrl) {
      try {
        return await this.loadFromUrl(entry.previewUrl, w, h);
      } catch {
        // Fall through to procedural
      }
    }

    // Generate procedural texture from previewColor
    const baseColor = this.parseColor(entry.previewColor ?? '#808080');
    return this.generateMaterial(baseColor, entry.material, w, h);
  }

  private loadFromUrl(url: string, w: number, h: number): Promise<TextureLayer> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const tileSize = Math.min(img.width, img.height, 128);
        const tile = document.createElement('canvas');
        tile.width = tileSize;
        tile.height = tileSize;
        const tctx = tile.getContext('2d')!;
        tctx.drawImage(img, 0, 0, tileSize, tileSize);
        const tileData = tctx.getImageData(0, 0, tileSize, tileSize);
        resolve(this.tileToSplatmap(tileData, tileSize, w, h));
      };
      img.onerror = reject;
      img.src = url;
    });
  }

  private tileToSplatmap(
    tileData: ImageData, tileSize: number, w: number, h: number,
  ): TextureLayer {
    const out = new Uint8ClampedArray(w * h * 4);
    const src = tileData.data;

    for (let y = 0; y < h; y++) {
      const ty = (y % tileSize) * tileSize;
      for (let x = 0; x < w; x++) {
        const tx = x % tileSize;
        const si = (ty + tx) * 4;
        const di = (y * w + x) * 4;
        out[di]     = src[si];
        out[di + 1] = src[si + 1];
        out[di + 2] = src[si + 2];
        out[di + 3] = 255;
      }
    }

    return { data: out, width: w, height: h };
  }

  /**
   * Generate a material-specific procedural texture.
   * Each material gets its own pattern structure — not just noise tint.
   * Designed to look good at low res (256×256) stretched to fullscreen.
   */
  private generateMaterial(
    base: [number, number, number], material: string, w: number, h: number,
  ): TextureLayer {
    switch (material) {
      case 'grass': return this.genGrass(base, w, h);
      case 'dirt':  return this.genDirt(base, w, h);
      case 'rock':  return this.genRock(base, w, h);
      case 'sand':  return this.genSand(base, w, h);
      default:      return this.genGeneric(base, w, h);
    }
  }

  /** Domain warp: distort coordinates with noise for organic irregularity */
  private warp(x: number, y: number, scale: number, strength: number): [number, number] {
    const wx = this.fbm(x * scale + 5.2, y * scale + 1.3, 3) * strength;
    const wy = this.fbm(x * scale + 8.7, y * scale + 3.8, 3) * strength;
    return [x + wx, y + wy];
  }

  /** Grass: organic clumps and blade-like variation */
  private genGrass(base: [number, number, number], w: number, h: number): TextureLayer {
    const out = new Uint8ClampedArray(w * h * 4);
    const [br, bg, bb] = base;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const di = (y * w + x) * 4;
        const nx = x / w, ny = y / h;

        // Warp coordinates for organic feel
        const [wx, wy] = this.warp(nx, ny, 3, 0.4);

        // Large clumps — warped so they're irregular blobs, not circles
        const clump = this.fbm(wx * 4, wy * 4, 4);

        // Blade-like streaks — slightly vertical bias, also warped
        const [bx, by] = this.warp(nx, ny, 5, 0.2);
        const blade = this.fbm(bx * 10, by * 4, 2);

        const bright = 1.0 + clump * 0.25 + blade * 0.12;

        // Push greens apart — dark clumps get blue-green, light ones get yellow-green
        out[di]     = this.clamp(br * bright + clump * 25 + blade * 10);
        out[di + 1] = this.clamp(bg * bright + clump * 40);
        out[di + 2] = this.clamp(bb * bright - clump * 18);
        out[di + 3] = 255;
      }
    }

    return { data: out, width: w, height: h };
  }

  /** Dirt: irregular earthy patches with scattered stones */
  private genDirt(base: [number, number, number], w: number, h: number): TextureLayer {
    const out = new Uint8ClampedArray(w * h * 4);
    const [br, bg, bb] = base;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const di = (y * w + x) * 4;
        const nx = x / w, ny = y / h;

        // Heavy warp for organic dirt clumps
        const [wx, wy] = this.warp(nx, ny, 2.5, 0.5);

        // Large earthy patches
        const patch = this.fbm(wx * 3.5, wy * 3.5, 4);

        // Warped voronoi for irregular pebbles (not uniform grid)
        const [vx, vy] = this.warp(nx, ny, 4, 0.35);
        const spot = this.voronoi(vx * 5, vy * 5);
        const pebble = spot < 0.18 ? -0.18 : spot * 0.08;

        const bright = 1.0 + patch * 0.3 + pebble;

        out[di]     = this.clamp(br * bright + patch * 28);
        out[di + 1] = this.clamp(bg * bright + patch * 14);
        out[di + 2] = this.clamp(bb * bright - patch * 10);
        out[di + 3] = 255;
      }
    }

    return { data: out, width: w, height: h };
  }

  /** Rock: irregular angular faces with organic crack network */
  private genRock(base: [number, number, number], w: number, h: number): TextureLayer {
    const out = new Uint8ClampedArray(w * h * 4);
    const [br, bg, bb] = base;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const di = (y * w + x) * 4;
        const nx = x / w, ny = y / h;

        // Warp for irregular rock faces
        const [wx, wy] = this.warp(nx, ny, 2, 0.45);
        const face = this.fbm(wx * 3, wy * 3, 4);

        // Heavily warped voronoi — irregular crack network, not polka dots
        const [vx, vy] = this.warp(nx, ny, 3, 0.6);
        const crack = this.voronoi(vx * 4, vy * 4);
        // Softer crack falloff instead of hard threshold
        const crackDark = crack < 0.1 ? 0.55 : crack < 0.2 ? 0.7 + (crack - 0.1) * 3 : 1.0;

        // Surface micro-texture
        const surface = this.fbm(nx * 8 + 200, ny * 8 + 200, 2);

        const bright = (0.92 + face * 0.2 + surface * 0.12) * crackDark;

        out[di]     = this.clamp(br * bright + face * 18);
        out[di + 1] = this.clamp(bg * bright + face * 14);
        out[di + 2] = this.clamp(bb * bright + face * 22);
        out[di + 3] = 255;
      }
    }

    return { data: out, width: w, height: h };
  }

  /** Sand: warped dune ripples with organic flow */
  private genSand(base: [number, number, number], w: number, h: number): TextureLayer {
    const out = new Uint8ClampedArray(w * h * 4);
    const [br, bg, bb] = base;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const di = (y * w + x) * 4;
        const nx = x / w, ny = y / h;

        // Warp for organic dune shapes
        const [wx, wy] = this.warp(nx, ny, 2, 0.35);

        // Dune undulations
        const dune = this.fbm(wx * 3, wy * 2.5, 3);

        // Ripples with warped direction — not perfectly diagonal
        const [rx, ry] = this.warp(nx, ny, 3, 0.4);
        const rippleAngle = rx * 6 + ry * 3 + this.fbm(rx * 3, ry * 3, 2) * 3;
        const ripple = Math.sin(rippleAngle * Math.PI * 2) * 0.1;

        const bright = 1.0 + dune * 0.2 + ripple;

        out[di]     = this.clamp(br * bright + dune * 24);
        out[di + 1] = this.clamp(bg * bright + dune * 14);
        out[di + 2] = this.clamp(bb * bright - dune * 12);
        out[di + 3] = 255;
      }
    }

    return { data: out, width: w, height: h };
  }

  /** Generic material: warped multi-octave noise */
  private genGeneric(base: [number, number, number], w: number, h: number): TextureLayer {
    const out = new Uint8ClampedArray(w * h * 4);
    const [br, bg, bb] = base;

    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const di = (y * w + x) * 4;
        const nx = x / w, ny = y / h;
        const [wx, wy] = this.warp(nx, ny, 3, 0.4);
        const n = this.fbm(wx * 4, wy * 4, 4);
        const bright = 1.0 + n * 0.3;

        out[di]     = this.clamp(br * bright);
        out[di + 1] = this.clamp(bg * bright);
        out[di + 2] = this.clamp(bb * bright);
        out[di + 3] = 255;
      }
    }

    return { data: out, width: w, height: h };
  }

  // ── Noise primitives ──────────────────────────────────────────────

  /** Fractal Brownian Motion — layered noise octaves */
  private fbm(x: number, y: number, octaves: number): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxAmp = 0;

    for (let i = 0; i < octaves; i++) {
      value += this.noise2d(x * frequency, y * frequency) * amplitude;
      maxAmp += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }

    return value / maxAmp;
  }

  /** Voronoi / cellular noise — returns distance to nearest cell center */
  private voronoi(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let minDist = 2;

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const cx = ix + dx;
        const cy = iy + dy;
        // Cell center from hash
        const px = cx + (this.hash(cx, cy) * 0.5 + 0.5);
        const py = cy + (this.hash(cx + 97, cy + 131) * 0.5 + 0.5);
        const dist = Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
        if (dist < minDist) minDist = dist;
      }
    }

    return minDist;
  }

  /** Simple 2D value noise (hash-based, no dependencies) */
  private noise2d(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;

    // Smoothstep interpolation
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);

    const n00 = this.hash(ix, iy);
    const n10 = this.hash(ix + 1, iy);
    const n01 = this.hash(ix, iy + 1);
    const n11 = this.hash(ix + 1, iy + 1);

    const nx0 = n00 + (n10 - n00) * sx;
    const nx1 = n01 + (n11 - n01) * sx;

    return nx0 + (nx1 - nx0) * sy;
  }

  /** Integer hash → [-1, 1] */
  private hash(x: number, y: number): number {
    let h = (x * 374761393 + y * 668265263 + 1013904223) | 0;
    h = ((h >> 13) ^ h) | 0;
    h = (h * (h * h * 15731 + 789221) + 1376312589) | 0;
    return (h & 0x7fffffff) / 0x7fffffff * 2 - 1;
  }

  private clamp(v: number): number {
    return Math.max(0, Math.min(255, Math.round(v)));
  }

  private parseColor(hex: string): [number, number, number] {
    const h = hex.replace('#', '');
    return [
      parseInt(h.substring(0, 2), 16) || 128,
      parseInt(h.substring(2, 4), 16) || 128,
      parseInt(h.substring(4, 6), 16) || 128,
    ];
  }
}
