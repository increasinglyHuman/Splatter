/**
 * Texture Palette — bottom-edge material selector.
 * Shows swatches from the TextureCatalog. Stealth auto-hide.
 */

import type { TextureCatalogEntry } from '../types/index.js';

export class Palette {
  private el: HTMLElement;
  private entries: TextureCatalogEntry[] = [];
  private selectedIndex = 0;
  private swatches: HTMLElement[] = [];

  onSelect?: (index: number, entry: TextureCatalogEntry) => void;

  constructor() {
    this.el = document.getElementById('palette')!;
  }

  load(entries: TextureCatalogEntry[]): void {
    this.entries = entries;
    this.el.innerHTML = '';
    this.swatches = [];

    entries.forEach((entry, i) => {
      const swatch = document.createElement('div');
      swatch.className = 'palette-swatch' + (i === 0 ? ' selected' : '');
      swatch.title = entry.name;

      // Use previewColor as fallback, previewUrl if available
      if (entry.previewUrl) {
        swatch.style.backgroundImage = `url(${entry.previewUrl})`;
      } else if (entry.previewColor) {
        swatch.style.backgroundColor = entry.previewColor;
      } else {
        // Generate a color from the textureId hash
        swatch.style.backgroundColor = this.hashColor(entry.id);
      }

      swatch.addEventListener('click', () => {
        this.selectIndex(i);
        this.onSelect?.(i, entry);
      });

      this.swatches.push(swatch);
      this.el.appendChild(swatch);
    });
  }

  selectIndex(index: number): void {
    this.swatches[this.selectedIndex]?.classList.remove('selected');
    this.selectedIndex = index;
    this.swatches[this.selectedIndex]?.classList.add('selected');
  }

  getSelected(): TextureCatalogEntry | null {
    return this.entries[this.selectedIndex] ?? null;
  }

  getSelectedChannel(): 0 | 1 | 2 | 3 {
    // First 4 entries map to RGBA channels
    return Math.min(3, this.selectedIndex) as 0 | 1 | 2 | 3;
  }

  /** Flash palette visible briefly */
  flash(): void {
    this.el.classList.add('active');
    setTimeout(() => this.el.classList.remove('active'), 2000);
  }

  private hashColor(str: string): string {
    let h = 0;
    for (let i = 0; i < str.length; i++) {
      h = (h * 31 + str.charCodeAt(i)) & 0xffffff;
    }
    return `#${h.toString(16).padStart(6, '0')}`;
  }
}
