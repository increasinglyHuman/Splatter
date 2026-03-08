/**
 * SplatPainter App — main controller.
 * Receives INIT from host, builds UI, manages painting lifecycle.
 * Implements ADR-003 protocol + poqpoq stealth UI philosophy.
 *
 * LAZY LOADING: Only the protocol handler loads at boot (~1KB).
 * Painting engine, UI modules, and splatmap are dynamically imported
 * on first SPLATPAINTER_INIT — nothing heavy until the host says go.
 */

import { ProtocolHandler, PROTOCOL_VERSION } from './protocol/handler.js';
import type {
  SplatPainterInit,
  SplatPainterUpdatePermissions,
  MakerPermissions,
  TextureCatalogEntry,
  SplatChannelLayout,
} from './types/index.js';

// Lazy-loaded module types (resolved on INIT)
type Splatmap = import('./painting/splatmap.js').Splatmap;
type UndoStack = import('./painting/undo.js').UndoStack;
type BrushEngine = import('./painting/brush.js').BrushEngine;
type Toolbar = import('./ui/toolbar.js').Toolbar;
type Palette = import('./ui/palette.js').Palette;
type SettingsPanel = import('./ui/settings.js').SettingsPanel;
type PaintCanvas = import('./ui/canvas.js').PaintCanvas;

export class SplatPainterApp {
  private protocol!: ProtocolHandler;
  private splatmap: Splatmap | null = null;
  private undo: UndoStack | null = null;
  private engine: BrushEngine | null = null;
  private canvas: PaintCanvas | null = null;
  private toolbar: Toolbar | null = null;
  private palette: Palette | null = null;
  private settings: SettingsPanel | null = null;

  private permissions: MakerPermissions = { tier1: false, tier2: false, tier3: false };
  private hostContext?: Record<string, unknown>;
  private saveMode: 'auto' | 'explicit' | 'hybrid' = 'hybrid';
  private isDirty = false;
  private saveTimer: ReturnType<typeof setInterval> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private statusEl!: HTMLElement;
  private hintEl!: HTMLElement;

  start(): void {
    this.statusEl = document.getElementById('status')!;
    this.hintEl = document.getElementById('keyboard-hint')!;

    this.showStatus('Waiting for host...');

    // Only the protocol handler loads eagerly — ~1KB parsed at boot
    this.protocol = new ProtocolHandler({
      onInit: (msg) => this.handleInit(msg),
      onUpdatePermissions: (msg) => this.handlePermissions(msg),
      onUpdateInfluences: (_msg) => {
        // Phase 2: update influence overlay visualization
      },
    });
  }

  private async handleInit(msg: SplatPainterInit): Promise<void> {
    this.permissions = msg.permissions;
    this.hostContext = msg.hostContext;
    this.saveMode = msg.saveMode ?? 'hybrid';

    // Determine splatmap resolution
    const resolution = msg.terrain.layer6Resolution ?? msg.terrain.resolution;

    // Build channel layout
    const layout: SplatChannelLayout = msg.layer6Data?.splatmap.channelLayout
      ?? msg.baseSplat.channelLayout
      ?? this.defaultLayout(msg.textureCatalog);

    // ── Lazy load all heavy modules in parallel ──────────────────
    const [
      { Splatmap },
      { UndoStack },
      { BrushEngine },
      { TextureAtlas },
      { Toolbar },
      { Palette },
      { SettingsPanel },
      { PaintCanvas },
    ] = await Promise.all([
      import('./painting/splatmap.js'),
      import('./painting/undo.js'),
      import('./painting/brush.js'),
      import('./painting/textures.js'),
      import('./ui/toolbar.js'),
      import('./ui/palette.js'),
      import('./ui/settings.js'),
      import('./ui/canvas.js'),
    ]);

    // Create splatmap
    this.splatmap = new Splatmap(resolution, resolution, layout);

    // TODO Phase 2: load existing layer6Data from msg.layer6Data?.splatmap.url

    // Create painting engine
    this.undo = new UndoStack();
    this.engine = new BrushEngine(this.splatmap, this.undo);

    this.engine.onDirtyChange = (dirty) => {
      if (dirty !== this.isDirty) {
        this.isDirty = dirty;
        this.protocol.send({ type: 'SPLATPAINTER_DIRTY', isDirty: dirty });
      }
    };

    // Build UI
    this.toolbar = new Toolbar({
      onToolChange: (tool) => {
        this.engine!.setTool(tool);
        this.showStatus(tool, 800);
      },
      onUndo: () => {
        if (this.engine!.performUndo()) {
          this.canvas!.requestRedraw();
          this.showStatus('Undo', 600);
        }
      },
      onRedo: () => {
        if (this.engine!.performRedo()) {
          this.canvas!.requestRedraw();
          this.showStatus('Redo', 600);
        }
      },
    });

    this.palette = new Palette();
    this.palette.load(msg.textureCatalog.slice(0, 4));
    this.palette.onSelect = (index) => {
      this.engine!.setActiveChannel(Math.min(3, index) as 0 | 1 | 2 | 3);
    };

    this.settings = new SettingsPanel({
      onRadiusChange: (r) => this.engine!.setRadius(r),
      onOpacityChange: (o) => this.engine!.setOpacity(o),
    });

    this.canvas = new PaintCanvas(this.engine);

    // Load terrain textures for material-blended preview
    const atlas = new TextureAtlas(msg.textureCatalog, resolution, resolution);
    atlas.ready.then(() => {
      console.log('[SplatPainter] Atlas ready, layers:', atlas.layers.length);
      this.canvas!.setAtlas(atlas);
      this.showStatus('Textures loaded', 800);
    }).catch((err) => {
      console.error('[SplatPainter] Atlas failed:', err);
    });

    // Flash UI visible briefly so the maker knows it exists
    this.toolbar.flash();
    this.palette.flash();
    this.settings.flash();

    // Bind keyboard shortcuts
    this.bindKeyboard();

    // Start auto-save timer (hybrid/auto mode)
    if (this.saveMode !== 'explicit') {
      this.saveTimer = setInterval(() => this.autoSave(), 1000);
    }

    // Send READY
    this.protocol.send({
      type: 'SPLATPAINTER_READY',
      loadedVersion: PROTOCOL_VERSION,
      capabilities: {
        tier1: this.permissions.tier1,
        tier2: false,  // Phase 2
        tier3: false,  // Phase 3
        pathEditor: false,  // Phase 2
        maxTextureSlots: 4,
      },
    });

    this.showStatus(`${msg.context} · ${resolution}×${resolution}`, 2000);

    // Show keyboard hint after a moment of inactivity
    setTimeout(() => {
      this.hintEl.textContent = 'P paint · E erase · S smear · [ ] size · Ctrl+Z undo';
      this.hintEl.classList.add('visible');
      setTimeout(() => this.hintEl.classList.remove('visible'), 5000);
    }, 3000);
  }

  private bindKeyboard(): void {
    document.addEventListener('keydown', (e) => {
      if (!this.engine) return; // not initialized yet
      this.resetIdleTimer();

      // Tool shortcuts
      if (!e.ctrlKey && !e.metaKey) {
        switch (e.key.toLowerCase()) {
          case 'p':
            this.engine.setTool('paint');
            this.toolbar!.select('paint');
            this.showStatus('Paint', 600);
            return;
          case 'e':
            this.engine.setTool('erase');
            this.toolbar!.select('erase');
            this.showStatus('Erase', 600);
            return;
          case 's':
            this.engine.setTool('smear');
            this.toolbar!.select('smear');
            this.showStatus('Smear', 600);
            return;
          case '[':
            this.engine.setRadius(this.engine.currentSettings.radius - 4);
            this.settings!.setRadius(this.engine.currentSettings.radius);
            return;
          case ']':
            this.engine.setRadius(this.engine.currentSettings.radius + 4);
            this.settings!.setRadius(this.engine.currentSettings.radius);
            return;
          case '1': case '2': case '3': case '4': {
            const ch = (Number(e.key) - 1) as 0 | 1 | 2 | 3;
            this.engine.setActiveChannel(ch);
            this.palette!.selectIndex(ch);
            return;
          }
        }
      }

      // Ctrl+Z / Ctrl+Shift+Z
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          if (this.engine.performRedo()) {
            this.canvas!.requestRedraw();
            this.showStatus('Redo', 600);
          }
        } else {
          if (this.engine.performUndo()) {
            this.canvas!.requestRedraw();
            this.showStatus('Undo', 600);
          }
        }
        return;
      }

      // Ctrl+S — explicit checkpoint
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        this.checkpoint();
        return;
      }
    });
  }

  private autoSave(): void {
    if (!this.isDirty || !this.splatmap?.isDirty()) return;

    this.protocol.send({
      type: 'SPLATPAINTER_SAVE',
      layer6Data: this.splatmap.toLayer6Data(),
      isDirty: this.isDirty,
      hostContext: this.hostContext,
    });
    this.splatmap.clearDirty();
  }

  private checkpoint(): void {
    if (!this.splatmap || !this.engine) return;

    this.protocol.send({
      type: 'SPLATPAINTER_CHECKPOINT',
      layer6Data: this.splatmap.toLayer6Data(),
      summary: {
        strokeCount: this.engine.getStrokeCount(),
        materialsUsed: this.engine.getMaterialsUsed(),
        areaModified: this.splatmap.getDirtyArea(),
      },
      hostContext: this.hostContext,
    });
    this.isDirty = false;
    this.protocol.send({ type: 'SPLATPAINTER_DIRTY', isDirty: false });
    this.showStatus('Saved', 1000);
  }

  private handlePermissions(msg: SplatPainterUpdatePermissions): void {
    this.permissions = msg.permissions;
    // Phase 2: show/hide tier 2/3 UI based on permissions
  }

  private showStatus(text: string, duration = 0): void {
    this.statusEl.textContent = text;
    this.statusEl.classList.add('visible');
    if (duration > 0) {
      setTimeout(() => this.statusEl.classList.remove('visible'), duration);
    }
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      // After idle: could trigger auto-hide or hint
    }, 4000);
  }

  private defaultLayout(catalog: TextureCatalogEntry[]): SplatChannelLayout {
    return {
      r: catalog[0]?.id ?? 'grass',
      g: catalog[1]?.id ?? 'dirt',
      b: catalog[2]?.id ?? 'rock',
      a: catalog[3]?.id ?? 'sand',
    };
  }

  destroy(): void {
    if (this.saveTimer) clearInterval(this.saveTimer);
    if (this.idleTimer) clearTimeout(this.idleTimer);

    if (this.isDirty) {
      this.checkpoint();
    }

    this.protocol.send({
      type: 'SPLATPAINTER_CLOSE',
      wasDirty: this.isDirty,
    });

    this.canvas?.destroy();
    this.protocol.destroy();
  }
}
