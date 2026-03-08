/**
 * ADR-003 types — SplatPainter postMessage API
 * These types define the complete contract between SplatPainter and its hosts.
 */

// ─── Message Envelope ───────────────────────────────────────────────

export interface SplatPainterMessage {
  type: string;
  version: string;
  timestamp: number;
  correlationId?: string;
}

// ─── Permissions ────────────────────────────────────────────────────

export interface MakerPermissions {
  tier1: boolean;
  tier2: boolean;
  tier3: boolean;
}

// ─── Channel Layout ─────────────────────────────────────────────────

export interface SplatChannelLayout {
  r: string;
  g: string;
  b: string;
  a: string;
}

// ─── Layer6Data ─────────────────────────────────────────────────────

export interface Layer6Data {
  version: '1.0';
  resolution: number;
  blendMode: 'overlay' | 'replace';
  splatmap: {
    url: string;
    channelLayout: SplatChannelLayout;
  };
  strokeLog?: string;
}

// ─── PathStyle ──────────────────────────────────────────────────────

export interface PathStyleData {
  version: '1.0';
  styles: PathStyle[];
}

export interface PathStyle {
  pathIndex: number;
  pathId: string;
  baseMaterial: string;
  edgeMaterial?: string;
  edgeExtent?: number;
  edgeNoise?: number;
  wearSensitivity?: number;
  wearMaterial?: string;
}

// ─── TextureCatalog ─────────────────────────────────────────────────

export interface TextureCatalogEntry {
  id: string;
  name: string;
  category: string[];
  material: string;
  condition?: string;
  resolution: number;
  format: 'png' | 'ktx2';
  channels: { albedo: boolean; normal: boolean; roughness?: boolean };
  tileScale: number;
  previewUrl: string;
  fullUrl: string;
  surfaceType: 'floor' | 'wall' | 'ceiling' | 'any';
  occlusionAO: boolean;
  previewColor?: string;
}

// ─── TerrainInfluence ───────────────────────────────────────────────

export interface TerrainInfluenceConfig {
  radius: number;
  falloff: 'linear' | 'exponential' | 'step';
  textureId: string;
  intensity: number;
  blendMode: 'overlay' | 'replace' | 'multiply' | 'additive';
  edgeNoise: number;
  displayName: string;
  category: string;
  previewColor: string;
  priority?: number;
  stackable?: boolean;
}

// ─── SplineMetadata (from ADR-002) ──────────────────────────────────

export interface SplineMetadata {
  version: '2.0';
  maxInfluenceDistance: number;
  terrainSize: number;
  sdfResolution: number;
  paths: SplineMeta[];
}

export interface SplineMeta {
  index: number;
  id: string;
  name: string;
  type: 'trail' | 'path' | 'road' | 'river';
  closed: boolean;
  length: number;
  controlPointCount: number;
  avgWidth: number;
  avgFalloff: number;
  maxWidth: number;
  maxFalloff: number;
  depth: number;
  boundingBox: { min: [number, number, number]; max: [number, number, number] };
  controlPoints: {
    position: [number, number, number];
    width: number;
    falloff: number;
    depth: number;
    textureId?: string;
  }[];
}

// ─── Host → SplatPainter Messages ───────────────────────────────────

export type HostContext = 'terraformer' | 'world' | 'dungeon';

export interface SplatPainterInit extends SplatPainterMessage {
  type: 'SPLATPAINTER_INIT';
  context: HostContext;
  splatPainterVersion?: string;
  permissions: MakerPermissions;
  terrain: {
    heightmapUrl: string;
    terrainSize: number;
    resolution: number;
    layer6Resolution?: number;
  };
  baseSplat: {
    url: string;
    channelLayout: SplatChannelLayout;
  };
  layer6Data?: Layer6Data;
  pathData?: {
    sdfUrl: string;
    splineMetadata: SplineMetadata;
  };
  textureCatalog: TextureCatalogEntry[];
  activeInfluences?: TerrainInfluenceConfig[];
  saveMode?: 'auto' | 'explicit' | 'hybrid';
  hostContext?: Record<string, unknown>;
}

export interface SplatPainterUpdatePermissions extends SplatPainterMessage {
  type: 'SPLATPAINTER_UPDATE_PERMISSIONS';
  permissions: MakerPermissions;
}

export interface SplatPainterUpdateInfluences extends SplatPainterMessage {
  type: 'SPLATPAINTER_UPDATE_INFLUENCES';
  influences: TerrainInfluenceConfig[];
}

// ─── SplatPainter → Host Messages ───────────────────────────────────

export interface SplatPainterCapabilities {
  tier1: boolean;
  tier2: boolean;
  tier3: boolean;
  pathEditor: boolean;
  maxTextureSlots: number;
}

export interface SplatPainterReady extends SplatPainterMessage {
  type: 'SPLATPAINTER_READY';
  loadedVersion: string;
  capabilities: SplatPainterCapabilities;
}

export interface SplatPainterSave extends SplatPainterMessage {
  type: 'SPLATPAINTER_SAVE';
  layer6Data: Layer6Data;
  isDirty: boolean;
  hostContext?: Record<string, unknown>;
}

export interface SplatPainterCheckpoint extends SplatPainterMessage {
  type: 'SPLATPAINTER_CHECKPOINT';
  layer6Data: Layer6Data;
  pathStyles?: PathStyleData;
  summary: {
    strokeCount: number;
    materialsUsed: string[];
    areaModified: number;
  };
  hostContext?: Record<string, unknown>;
}

export interface SplatPainterDirty extends SplatPainterMessage {
  type: 'SPLATPAINTER_DIRTY';
  isDirty: boolean;
}

export interface SplatPainterClose extends SplatPainterMessage {
  type: 'SPLATPAINTER_CLOSE';
  wasDirty: boolean;
}

export interface SplatPainterError extends SplatPainterMessage {
  type: 'SPLATPAINTER_ERROR';
  code: string;
  message: string;
  recoverable: boolean;
}

export type InboundMessage =
  | SplatPainterInit
  | SplatPainterUpdatePermissions
  | SplatPainterUpdateInfluences;

export type OutboundMessage =
  | SplatPainterReady
  | SplatPainterSave
  | SplatPainterCheckpoint
  | SplatPainterDirty
  | SplatPainterClose
  | SplatPainterError;
