/**
 * SplatPainter entry point.
 * Boots the app and waits for SPLATPAINTER_INIT from the host.
 *
 * Can also run standalone with mock data for development.
 */

import { SplatPainterApp } from './app.js';

const app = new SplatPainterApp();
app.start();

// Standalone dev mode: if no INIT received within 1s, self-init with mock data
if (window.parent === window) {
  // Not in an iframe — we're running standalone for development
  setTimeout(() => {
    window.postMessage({
      type: 'SPLATPAINTER_INIT',
      version: '1.0.0',
      timestamp: Date.now(),
      context: 'terraformer',
      permissions: { tier1: true, tier2: true, tier3: true },
      terrain: {
        heightmapUrl: '',
        terrainSize: 1000,
        resolution: 256,
      },
      baseSplat: {
        url: '',
        channelLayout: { r: 'grass_01', g: 'dirt_01', b: 'rock_01', a: 'sand_01' },
      },
      textureCatalog: [
        { id: 'grass_01', name: 'Grass', category: ['outdoor'], material: 'grass', resolution: 512, format: 'png', channels: { albedo: true, normal: true }, tileScale: 1, previewUrl: '', fullUrl: '', surfaceType: 'any', occlusionAO: false, previewColor: '#4a7c3f' },
        { id: 'dirt_01', name: 'Dirt', category: ['outdoor'], material: 'dirt', resolution: 512, format: 'png', channels: { albedo: true, normal: true }, tileScale: 1, previewUrl: '', fullUrl: '', surfaceType: 'any', occlusionAO: false, previewColor: '#8b6914' },
        { id: 'rock_01', name: 'Rock', category: ['outdoor'], material: 'rock', resolution: 512, format: 'png', channels: { albedo: true, normal: true }, tileScale: 1, previewUrl: '', fullUrl: '', surfaceType: 'any', occlusionAO: false, previewColor: '#6b6b6b' },
        { id: 'sand_01', name: 'Sand', category: ['outdoor'], material: 'sand', resolution: 512, format: 'png', channels: { albedo: true, normal: true }, tileScale: 1, previewUrl: '', fullUrl: '', surfaceType: 'any', occlusionAO: false, previewColor: '#c4a84d' },
      ],
      saveMode: 'hybrid',
    }, '*');
  }, 100);
}

// Clean up on unload
window.addEventListener('beforeunload', () => {
  app.destroy();
});
