/**
 * Brush Settings panel — top-right, stealth auto-hide.
 * Radius and opacity sliders.
 */

export interface SettingsCallbacks {
  onRadiusChange: (r: number) => void;
  onOpacityChange: (o: number) => void;
}

export class SettingsPanel {
  private el: HTMLElement;
  private radiusSlider!: HTMLInputElement;
  private opacitySlider!: HTMLInputElement;
  private radiusValue!: HTMLElement;
  private opacityValue!: HTMLElement;

  constructor(callbacks: SettingsCallbacks) {
    this.el = document.getElementById('brush-settings')!;
    this.el.innerHTML = '';

    // Radius
    this.el.appendChild(this.makeRow('Size', 1, 128, 16, (v) => {
      this.radiusValue.textContent = String(v);
      callbacks.onRadiusChange(v);
    }, (slider, valEl) => {
      this.radiusSlider = slider;
      this.radiusValue = valEl;
    }));

    // Opacity
    this.el.appendChild(this.makeRow('Flow', 1, 100, 60, (v) => {
      this.opacityValue.textContent = `${v}%`;
      callbacks.onOpacityChange(v / 100);
    }, (slider, valEl) => {
      this.opacitySlider = slider;
      this.opacityValue = valEl;
    }));
  }

  private makeRow(
    label: string,
    min: number,
    max: number,
    initial: number,
    onChange: (v: number) => void,
    capture: (slider: HTMLInputElement, valEl: HTMLElement) => void,
  ): HTMLElement {
    const row = document.createElement('div');
    row.className = 'setting-row';

    const lbl = document.createElement('span');
    lbl.className = 'setting-label';
    lbl.textContent = label;

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(initial);
    slider.addEventListener('input', () => onChange(Number(slider.value)));

    const val = document.createElement('span');
    val.className = 'setting-value';
    val.textContent = label === 'Flow' ? `${initial}%` : String(initial);

    capture(slider, val);

    row.appendChild(lbl);
    row.appendChild(slider);
    row.appendChild(val);
    return row;
  }

  setRadius(r: number): void {
    this.radiusSlider.value = String(r);
    this.radiusValue.textContent = String(r);
  }

  setOpacity(o: number): void {
    const pct = Math.round(o * 100);
    this.opacitySlider.value = String(pct);
    this.opacityValue.textContent = `${pct}%`;
  }

  flash(): void {
    this.el.classList.add('active');
    setTimeout(() => this.el.classList.remove('active'), 2000);
  }
}
