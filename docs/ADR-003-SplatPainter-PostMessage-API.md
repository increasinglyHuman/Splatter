# poqpoq // Architecture Decision Record

---

# ADR-003 — SplatPainter postMessage API & Module Boundaries

| Field | Value |
|-------|-------|
| **Status** | **Ratified** — all teams reviewed and approved (2026-03-09) |
| **Date** | March 2026 |
| **Author** | Splatter Team |
| **Domain** | SplatPainter · Host Integration · Data Formats |
| **Affects** | All teams (Terraformer, World, DungeonMaster, Glitch, Scripter) |
| **Depends on** | ADR-001 (Terrain Texture Authority), ADR-002 (Path SDF Contract) |

---

## Context

ADR-001 established that SplatPainter is a **sandboxed iframe micro-app** embedded by three host tools (Terraformer, World, DungeonMaster). All communication between host and SplatPainter flows through `window.postMessage`. This ADR defines the complete message protocol, module boundaries, data formats, and lifecycle for that integration.

### Design Constraints

1. SplatPainter has **zero knowledge** of its host's internals — it receives data, provides UI, returns results
2. Three hosts today (Terraformer, World, DungeonMaster), potentially more in the future
3. Hosts compute permissions — SplatPainter enforces them but doesn't derive them
4. Save strategy must handle browser crashes (auto-recovery) without flooding hosts (checkpoint for persistence)
5. Layer 6 data format must be consumable by both World's runtime compositor and Glitch's preview renderer
6. Version negotiation prevents breaking changes from silently corrupting data

---

## Decision

### 1. Message Envelope

All messages between host and SplatPainter share a common envelope:

```typescript
interface SplatPainterMessage {
  type: string;                    // Message type identifier
  version: string;                 // Protocol version (semver, e.g., "1.0.0")
  timestamp: number;               // Unix milliseconds
  correlationId?: string;          // Optional: links request/response pairs
}
```

Messages flow in two directions:
- **Host → SplatPainter:** Initialization, data updates, permission changes
- **SplatPainter → Host:** Save events, dirty state, user actions

### 2. Host → SplatPainter Messages

#### `SPLATPAINTER_INIT`

Sent once when the iframe loads. Contains everything SplatPainter needs to render.

```typescript
interface SplatPainterInit extends SplatPainterMessage {
  type: 'SPLATPAINTER_INIT';

  /** Which host is embedding us — determines available features */
  context: 'terraformer' | 'world' | 'dungeon';

  /** Requested SplatPainter version (omit for latest) */
  splatPainterVersion?: string;

  /** Maker permissions — host-computed, SplatPainter-enforced */
  permissions: MakerPermissions;

  /** Terrain geometry */
  terrain: {
    heightmapUrl: string;          // URL to heightmap (PNG or R16) — supports https:, blob:, data: protocols
    terrainSize: number;           // World units (e.g., 1000)
    resolution: number;            // Heightmap resolution (e.g., 1024)
    layer6Resolution?: number;     // Preferred Layer6Data resolution (defaults to terrain resolution if omitted)
  };

  /** Base splatmap (Layers 1+2, baked by Terraformer) */
  baseSplat: {
    url: string;                   // URL to base splatmap texture
    channelLayout: SplatChannelLayout;
  };

  /** Layer 6 overrides (existing paint data, if any) */
  layer6Data?: Layer6Data;

  /** Path system data (from ADR-002) */
  pathData?: {
    sdfUrl: string;                // URL to pathSDF.bin (RG16F)
    splineMetadata: SplineMetadata; // Inline or URL
  };

  /** Texture catalog for the brush palette */
  textureCatalog: TextureCatalogEntry[];

  /** Terrain influence configs on objects in the scene (Layer 5, read-only context) */
  activeInfluences?: TerrainInfluenceConfig[];

  /** Save mode preference */
  saveMode?: 'auto' | 'explicit' | 'hybrid';

  /** Opaque host metadata — SplatPainter echoes unchanged on CHECKPOINT/SAVE */
  hostContext?: Record<string, unknown>;

  /** DungeonMaster-specific (context: 'dungeon' only) */
  cellGeometry?: DungeonCellGeometry;
}
```

```typescript
interface MakerPermissions {
  tier1: boolean;  // Brush tools (paint, erase, smear, opacity)
  tier2: boolean;  // Rule composer (condition nodes)
  tier3: boolean;  // Physics painter (terrain_influence UI) + AI proposals
}
```

**Permission source is host-agnostic.** Each host computes permissions however it wants:
- **World:** Derives from NEXUS `instance_members.role` (visitor→false/false/false, member→true/false/false, builder→true/true/false, admin/owner→true/true/true)
- **Terraformer:** Always `{ tier1: true, tier2: true, tier3: true }` (you're the world designer)
- **DungeonMaster:** Always `{ tier1: true, tier2: true, tier3: true }` (you're the dungeon designer)

SplatPainter doesn't know or care where the permissions came from.

#### `SPLATPAINTER_UPDATE_PERMISSIONS`

Sent if permissions change during a session (e.g., role change in World).

```typescript
interface SplatPainterUpdatePermissions extends SplatPainterMessage {
  type: 'SPLATPAINTER_UPDATE_PERMISSIONS';
  permissions: MakerPermissions;
}
```

#### `SPLATPAINTER_UPDATE_INFLUENCES`

Sent when object terrain influences change in the scene (scripts calling `setTerrainInfluence`, objects moving).

```typescript
interface SplatPainterUpdateInfluences extends SplatPainterMessage {
  type: 'SPLATPAINTER_UPDATE_INFLUENCES';
  influences: TerrainInfluenceConfig[];
}
```

### 3. SplatPainter → Host Messages

#### `SPLATPAINTER_READY`

Sent when SplatPainter has loaded, parsed the init payload, and is ready for interaction.

```typescript
interface SplatPainterReady extends SplatPainterMessage {
  type: 'SPLATPAINTER_READY';

  /** Actual version loaded (may differ from requested if version pinning failed) */
  loadedVersion: string;

  /** Capabilities available at this version */
  capabilities: SplatPainterCapabilities;
}

interface SplatPainterCapabilities {
  tier1: boolean;       // Brush tools available
  tier2: boolean;       // Rule composer available
  tier3: boolean;       // Physics painter available
  pathEditor: boolean;  // PathStyleEditor available
  maxTextureSlots: number; // How many materials the shader supports
}
```

#### `SPLATPAINTER_SAVE` (Auto-Recovery)

Sent periodically during painting for crash recovery. **Debounced to at most 1 per second.** Hosts may store this transiently (localStorage, session storage) — it is NOT a persistence event.

```typescript
interface SplatPainterSave extends SplatPainterMessage {
  type: 'SPLATPAINTER_SAVE';
  layer6Data: Layer6Data;
  isDirty: boolean;               // True if unsaved changes exist since last checkpoint
  hostContext?: Record<string, unknown>;  // Echoed from INIT, unmodified
}
```

#### `SPLATPAINTER_CHECKPOINT` (Explicit Save)

Sent on user action: Save button, Ctrl+S, or panel close with unsaved changes. **This is the persistence event.** Hosts must durably store this data.

```typescript
interface SplatPainterCheckpoint extends SplatPainterMessage {
  type: 'SPLATPAINTER_CHECKPOINT';
  layer6Data: Layer6Data;
  pathStyles?: PathStyleData;     // If PathStyleEditor was used
  summary: {
    strokeCount: number;
    materialsUsed: string[];      // textureIds touched
    areaModified: number;         // Square metres affected (approximate)
  };
  hostContext?: Record<string, unknown>;  // Echoed from INIT, unmodified
}
```

#### `SPLATPAINTER_DIRTY`

Sent when dirty state changes. Hosts can use this to show unsaved-changes indicators.

```typescript
interface SplatPainterDirty extends SplatPainterMessage {
  type: 'SPLATPAINTER_DIRTY';
  isDirty: boolean;
}
```

#### `SPLATPAINTER_CLOSE`

Sent when the user explicitly closes SplatPainter (close button, Escape key). If dirty, a `SPLATPAINTER_CHECKPOINT` is sent first.

```typescript
interface SplatPainterClose extends SplatPainterMessage {
  type: 'SPLATPAINTER_CLOSE';
  wasDirty: boolean;              // Whether a checkpoint was triggered on close
}
```

#### `SPLATPAINTER_ERROR`

Sent when SplatPainter encounters an unrecoverable error.

```typescript
interface SplatPainterError extends SplatPainterMessage {
  type: 'SPLATPAINTER_ERROR';
  code: string;                   // Machine-readable error code
  message: string;                // Human-readable description
  recoverable: boolean;           // Can the user retry?
}
```

Error codes:

| Code | Meaning |
|------|---------|
| `VERSION_MISMATCH` | Requested version unavailable |
| `TEXTURE_LOAD_FAILED` | Could not load texture URL |
| `HEIGHTMAP_LOAD_FAILED` | Could not load heightmap |
| `SDF_LOAD_FAILED` | Could not load path SDF |
| `CATALOG_EMPTY` | No textures in catalog |
| `UNKNOWN` | Unexpected error |

### 4. Layer6Data Format

Layer 6 data is the maker's paint overrides — the output of Tier 1 brush tools. It must be consumable by World's runtime compositor (shader), Glitch's preview renderer (shader), and restorable by SplatPainter (undo/load).

**Format: Rasterized splatmap** (preferred by World and Glitch for shader consumption).

```typescript
interface Layer6Data {
  /** Format version */
  version: '1.0';

  /** Resolution of the override splatmap (may differ from terrain resolution) */
  resolution: number;

  /** How this data blends with lower layers */
  blendMode: 'overlay' | 'replace';

  /** Rasterized splatmap — binary data URL or inline base64 */
  splatmap: {
    /** Data URL (data:application/octet-stream;base64,...) or fetch URL */
    url: string;

    /**
     * Channel layout — maps RGBA channels to TextureCatalog entries.
     * Each channel stores the blend weight (0.0–1.0) for one material.
     * A single RGBA splatmap supports 4 materials.
     * Multiple splatmaps are used for >4 materials (future Phase 2).
     */
    channelLayout: SplatChannelLayout;
  };

  /** Stroke log for undo/redo (SplatPainter-internal, opaque to hosts) */
  strokeLog?: string;
}

/**
 * Maps RGBA channels to TextureCatalog texture IDs.
 * Channel value 0.0 = no contribution, 1.0 = full contribution.
 * Values across all channels at a texel should sum to 1.0 (normalized).
 */
interface SplatChannelLayout {
  r: string;   // textureId for R channel
  g: string;   // textureId for G channel
  b: string;   // textureId for B channel
  a: string;   // textureId for A channel
}
```

**Why rasterized, not stroke-based:**
- World and Glitch need to sample per-fragment in a shader — rasterized data is a single texture fetch
- Stroke-based data requires rasterization at load time — unnecessary indirection
- The `strokeLog` field preserves undo capability within SplatPainter without imposing rasterization cost on consumers

**Resolution policy:**
- Default: match terrain heightmap resolution (1:1 UV mapping)
- May be lower for large terrains (512 splatmap on 1024 heightmap) — bilinear filtering handles upscale
- Host specifies preferred resolution in `SPLATPAINTER_INIT` terrain config

### 5. PathStyleData Format

Output of the PathStyleEditor — per-path material and effect assignments.

```typescript
interface PathStyleData {
  version: '1.0';
  styles: PathStyle[];
}

interface PathStyle {
  /** Path index (matches SplineMeta.index / SDF G channel) */
  pathIndex: number;

  /** Path UUID (matches SplineMeta.id) — for cross-reference */
  pathId: string;

  /** Base material for the path surface */
  baseMaterial: string;        // textureId

  /** Edge material (moss, gravel, etc.) */
  edgeMaterial?: string;       // textureId

  /** How far the edge material extends beyond path width (metres) */
  edgeExtent?: number;

  /** Edge noise intensity (0.0–1.0) */
  edgeNoise?: number;

  /** Wear sensitivity — how much traffic data affects texture (0.0–1.0) */
  wearSensitivity?: number;

  /** Center wear material (exposed substrate under heavy traffic) */
  wearMaterial?: string;       // textureId
}
```

### 6. TextureCatalog Entry Schema

The shared texture catalog browsed by SplatPainter and consumed by all teams.

```typescript
interface TextureCatalogEntry {
  /** Unique texture identifier */
  id: string;

  /** Human-readable name */
  name: string;

  /** Browsing categories (multi-tag) */
  category: string[];

  /** Base material type */
  material: string;

  /** Condition descriptor */
  condition?: string;

  /** Resolution in pixels (square) */
  resolution: number;

  /** File format */
  format: 'png' | 'ktx2';

  /** Available PBR channels */
  channels: {
    albedo: boolean;
    normal: boolean;
    roughness?: boolean;
  };

  /** Default tile scale */
  tileScale: number;

  /** Preview image URL (small, for catalog browsing) */
  previewUrl: string;

  /** Full texture URL (for rendering) */
  fullUrl: string;

  /** Surface type — which faces this texture suits (DM addition) */
  surfaceType: 'floor' | 'wall' | 'ceiling' | 'any';

  /** Whether texture includes baked ambient occlusion (DM addition) */
  occlusionAO: boolean;

  /** Hex colour for UI swatches */
  previewColor?: string;
}
```

### 7. DungeonMaster Context (Future — Phase 3)

When `context: 'dungeon'`, the init payload includes dungeon-specific geometry:

```typescript
interface DungeonCellGeometry {
  /** Interleaved grid size (e.g., 19 for a 10×10 octagon grid) */
  gridSize: number;

  /** Octagon cell size in world units (12.8m) */
  octagonSize: number;

  /** Connector diamond corridor width (3.6m) */
  connectorSize: number;

  /** Populated cells only — sparse, skip void positions */
  cells: DungeonCellEntry[];

  /** Per-face material assignments */
  faceMaterials?: DungeonFaceMaterial[];
}

interface DungeonCellEntry {
  col: number;
  row: number;
  cellType: string;                // From DM's 43-type catalog (string, not enum — DM owns the type list)
  isConnector: boolean;            // true = diamond (4 walls), false = octagon (8 walls)
  theme?: string;                  // CellTheme (e.g., 'ancient_stone', 'volcanic')
  floorConfig?: string;            // FloorConfig (e.g., 'flat', 'sunken_center')
}

interface DungeonFaceMaterial {
  col: number;
  row: number;
  surface: 'floor' | 'ceiling' | 'wall';
  wallIndex?: number;              // 0-7 for octagon walls, 0-3 for connectors (only when surface === 'wall')
  textureId: string;
}
```

**Phase 3 scope:** SplatPainter renders a flat UV-mapped rectangle per cell face instead of terrain topology. The Tier 1 brush tools work on this rectangle. Layer6Data output is per-cell-face splatmaps (smaller resolution, one per face type).

This is an appendix — not implemented in Phase 1 or Phase 2.

### 8. TerrainInfluenceConfig (Full Agreed Schema)

Included here for completeness — the schema agreed between World and Splatter (Comms.md item #8), now with all fields:

```typescript
interface TerrainInfluenceConfig {
  /** Influence radius in metres */
  radius: number;

  /** Distance falloff function */
  falloff: 'linear' | 'exponential' | 'step';

  /** Texture ID from shared TextureCatalog */
  textureId: string;

  /** Influence intensity (0.0–1.0) */
  intensity: number;

  /** How this influence blends with base terrain */
  blendMode: 'overlay' | 'replace' | 'multiply' | 'additive';

  /** Organic edge variation (0.0–1.0) */
  edgeNoise: number;

  /** Human-readable label for UI */
  displayName: string;

  /** Semantic category for filtering */
  category: string;

  /** Hex colour for UI previews */
  previewColor: string;

  /** Overlap resolution — higher priority wins (runtime, optional, default 0) */
  priority?: number;

  /** Whether intensity stacks with other influences or replaces (runtime, optional, default true) */
  stackable?: boolean;
}
```

### 9. Version Negotiation

Hosts specify a desired SplatPainter version in `SPLATPAINTER_INIT.splatPainterVersion`. The protocol:

1. If omitted → latest version loads
2. If specified and available → that version loads
3. If specified but unavailable → SplatPainter loads latest and reports in `SPLATPAINTER_READY.loadedVersion`
4. If the loaded version's protocol is incompatible with the init payload → `SPLATPAINTER_ERROR` with `VERSION_MISMATCH`

**Compatibility rule:** Protocol changes within a major version are backward-compatible. Breaking changes bump the major version. Hosts should pin to a major version (e.g., `"1.x"`) rather than exact versions.

### 10. Save Mode Behavior

| Mode | Auto-recovery stream | Checkpoint events | Default |
|------|---------------------|-------------------|---------|
| `auto` | Every stroke (debounced 1/sec) | None — auto-save IS the persistence | No |
| `explicit` | None | On Save button / Ctrl+S / close | No |
| `hybrid` | Every stroke (debounced 1/sec) | On Save button / Ctrl+S / close | **Yes** |

**Hybrid (default):**
- `SPLATPAINTER_SAVE` fires at most 1/sec during active painting → hosts store transiently for crash recovery
- `SPLATPAINTER_CHECKPOINT` fires on explicit user action → hosts persist durably
- On SplatPainter close with dirty state: automatic checkpoint before `SPLATPAINTER_CLOSE`

**Host responsibilities:**
- On `SPLATPAINTER_SAVE`: Store transiently (localStorage, memory). May discard on session end.
- On `SPLATPAINTER_CHECKPOINT`: Persist durably (database, file system). Must survive restarts.
- On `SPLATPAINTER_CLOSE`: Destroy iframe. If `wasDirty`, a checkpoint was already sent.
- On `beforeunload` / tab close: If the iframe is destroyed without a `SPLATPAINTER_CLOSE` (e.g., user navigates away, browser crash), the host should recover from the most recent `SPLATPAINTER_SAVE` data on next session. Recovery data with a newer timestamp takes precedence over persisted data.

### 11. Glitch Spawn Integration

The `SplatterGlitchPayload` fits inside Glitch's existing `glitch_spawn` message envelope:

```typescript
// Existing Glitch spawn protocol
interface GlitchSpawn {
  type: 'glitch_spawn';
  glitchType: 'terraformer' | 'landscaper' | 'scripter' | 'animator' | 'generic' | 'splatter';
  payload: SplatterGlitchPayload;  // when glitchType === 'splatter'
}

interface SplatterGlitchPayload {
  heightmap: string;               // URL to heightmap
  baseSplat: string;               // URL to baked Layers 1+2 splatmap
  layer6Overrides?: string;        // URL to Layer6Data rasterized splatmap (absent = unpainted terrain)
  textureArray: string;            // URL to shared texture array (PNG Phase 1, KTX2 Phase 2)
  channelLayout: SplatChannelLayout;
  pathDistanceField?: string;      // URL to pathSDF.bin (Phase 2)
  pathStyles?: PathStyle[];        // Path style assignments (Phase 2)
  spawnPosition?: { x: number; y: number; z: number };
}
```

No extension to Glitch's existing `glitch_spawn` protocol is needed — the `payload` field is already type-generic per `glitchType`.

---

## Module Boundaries

### SplatPainter Owns

| Module | Description |
|--------|-------------|
| **Tier 1 Brush Tools** | Paint, erase, smear, opacity — writes to Layer6Data splatmap |
| **Tier 2 Rule Composer** | Condition node editor — generates terrain texture rules |
| **Tier 3 Physics Painter** | TerrainInfluenceConfig visual editor |
| **PathStyleEditor** | Per-path material/effect assignment UI |
| **AI Proposals Panel** | Review/approve/reject terrain change proposals |
| **TextureCatalog Browser** | Searchable texture palette with previews |
| **Undo/Redo Stack** | Internal stroke history (opaque to hosts) |
| **Layer6Data Rasterizer** | Converts brush strokes to rasterized splatmap output |

### SplatPainter Does NOT Own

| Responsibility | Owner |
|---------------|-------|
| Runtime terrain compositor (7-layer evaluation) | World |
| Heightmap generation | Terraformer |
| Path geometry (spline curves, SDF baking) | Terraformer |
| Dungeon cell geometry | DungeonMaster |
| Script-triggered terrain influence | Scripter + World |
| Transient FX evaluation (Layer 7 runtime) | World |
| 3D preview rendering | Glitch |
| Texture asset creation/compression | Terraformer (format authority) |
| Texture catalog persistence/versioning | Splatter (registry), Terraformer (validation) |
| Permission derivation (role → booleans) | Each host independently |

### Shared Contracts (This ADR + Others)

| Contract | Defined In | Consumed By |
|----------|-----------|------------|
| `SplatChannelLayout` | This ADR | All teams |
| `Layer6Data` | This ADR | World, Glitch, SplatPainter |
| `PathStyleData` | This ADR | World, Glitch, SplatPainter |
| `TextureCatalogEntry` | This ADR | All teams |
| `TerrainInfluenceConfig` | ADR-001 + this ADR | World, Scripter, SplatPainter |
| `MakerPermissions` | This ADR | World, SplatPainter |
| SDF texture format (RG16F) | ADR-002 | Terraformer, World, Glitch |
| `SplineMetadata` / `SplineMeta` | ADR-002 | Terraformer, World, SplatPainter, Glitch |
| Dirty-flag tracking | ADR-005 | World |
| Event log schema | ADR-006 | World, Scripter |

---

## Lifecycle

```
Host                                    SplatPainter
  |                                          |
  |--- SPLATPAINTER_INIT ------------------>|
  |                                          |  (loads textures, builds UI)
  |<--- SPLATPAINTER_READY ----------------|
  |                                          |
  |         [user paints]                    |
  |                                          |
  |<--- SPLATPAINTER_DIRTY (true) ---------|
  |<--- SPLATPAINTER_SAVE (debounced) -----|  (auto-recovery, transient)
  |<--- SPLATPAINTER_SAVE ------------------|
  |                                          |
  |         [user hits Ctrl+S]               |
  |                                          |
  |<--- SPLATPAINTER_CHECKPOINT ------------|  (durable persistence)
  |<--- SPLATPAINTER_DIRTY (false) --------|
  |                                          |
  |--- SPLATPAINTER_UPDATE_INFLUENCES ----->|  (object moved in scene)
  |                                          |
  |         [user closes panel]              |
  |                                          |
  |<--- SPLATPAINTER_CHECKPOINT ------------|  (if dirty)
  |<--- SPLATPAINTER_CLOSE ----------------|
  |                                          |
  |  (host destroys iframe)                  |
```

---

## Security

1. **Origin validation:** SplatPainter validates `MessageEvent.origin` against a whitelist of known host origins. Messages from unknown origins are silently dropped.
2. **Sandboxed iframe:** SplatPainter runs in an iframe with `sandbox="allow-scripts allow-same-origin"`. No `allow-top-navigation`, no `allow-popups`.
3. **No direct DOM access:** SplatPainter never touches the host's DOM. All communication is via postMessage.
4. **Rate limiting:** SplatPainter self-limits `SPLATPAINTER_SAVE` to 1/sec. Hosts should also enforce server-side rate limits on persistence endpoints.
5. **Data validation:** Hosts must validate Layer6Data before persisting (resolution bounds, channel layout references valid catalog entries, splatmap data size matches declared resolution).
6. **URL protocols:** All URL fields (`heightmapUrl`, `baseSplat.url`, `sdfUrl`, texture URLs) accept `https:`, `blob:`, and `data:` protocols. `blob:` URLs are recommended for in-memory data (efficient, same-origin, auto-revoked). Hosts using `blob:` URLs must keep the source blob alive until the iframe is destroyed.

---

## Consequences

**Positive:**
- Clean separation between SplatPainter (UI/editing) and hosts (data/persistence)
- Single protocol serves three hosts today, extensible for future hosts
- Rasterized Layer6Data is zero-cost for shader consumption (single texture fetch)
- Hybrid save mode balances crash safety with host load
- Version negotiation prevents silent data corruption
- DungeonMaster context is future-proofed without Phase 1 implementation cost

**Costs:**
- Rasterized splatmap loses individual stroke data (mitigated by opaque `strokeLog` field)
- 4-material limit per splatmap (mitigated by multi-splatmap support in Phase 2)
- postMessage serialization overhead for large Layer6Data (mitigated by URL references instead of inline data for textures)
- Protocol surface area (10 message types) — acceptable for the complexity of the integration

---

## Review Checklist

- [x] **World team:** Confirm Layer6Data rasterized format works for compositor consumption — **Confirmed.** Single texture fetch, zero rasterization cost. `overlay`/`replace` blend modes mapped. `strokeLog` stored opaque in NEXUS.
- [x] **World team:** Confirm `SPLATPAINTER_INIT` payload has all fields needed for iframe hosting — **Confirmed.** All fields providable. `hostContext` added for instance association.
- [x] **Terraformer team:** Confirm `SplatChannelLayout` matches `TextureArrayBuilder` output — **Compatible.** N-Zone uses procedural height/slope evaluation (not baked RGBA splatmap), so we'll bake top-4 zones on-demand via offscreen render. Phase 2 multi-splatmap for >4 zones.
- [x] **Terraformer team:** Confirm `pathData` field in init payload matches ADR-002 contract — **Exact match.** `sdfUrl` → `pathSDF.bin`, `splineMetadata` → `splineMetadata.json`. Dual-keying (pathIndex + pathId) confirmed.
- [x] **DungeonMaster team:** Confirm `DungeonCellGeometry` captures what DM would send — **Approved with corrections.** Schema revised: 43 cell types (string, not enum), 8-wall octagons, sparse interleaved grid. Updated in ADR-003 §7.
- [x] **DungeonMaster team:** Confirm `TextureCatalogEntry` includes `surfaceType` + `occlusionAO` — **Confirmed.** Both fields present exactly as proposed.
- [x] **Glitch team:** Confirm `SplatterGlitchPayload` fits `glitch_spawn` envelope — **Confirmed and shipped.** `splatter` Glitch type live (`68706ce`), `TerrainPayload` maps to ADR-003 exactly. `layer6Overrides` made optional per Glitch+World feedback.
- [x] **Scripter team:** Confirm `TerrainInfluenceConfig` matches types in `world-object.ts` — **Exact match.** All 11 fields identical in type and optionality. Bridge layer `TerrainInfluenceConfigLike` uses structural typing (wider `string` for enums) — any ADR-003 value satisfies it.
- [x] **All teams:** Agree on `Layer6Data` rasterized format (vs. stroke-based alternative) — **Unanimous.** World, Glitch, Terraformer, Scripter, DM all confirmed rasterized splatmap.

---

*poqpoq · ADR-003 · SplatPainter postMessage API & Module Boundaries · March 2026*
*Author: Splatter Team (Splatter repo)*
